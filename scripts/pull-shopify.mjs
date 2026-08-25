/* ============================================================
   Pulls Shopify orders, classifies the draft bucket into its four
   real components, writes data/shopify.json and appends history.

   Local:  SHOPIFY_ACCESS_TOKEN=shpat_xxx node scripts/pull-shopify.mjs
   ============================================================ */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { fetchOrders, attachEvents, fetchShop } from "./lib/shopify.mjs";
import { summariseOrders, buildRebookIndex, isDraftApp, retailStoreOf, giftSignal, envelope } from "./lib/shape.mjs";

const DAYS = Number(process.env.DAYS || 7);
const REBOOK_WINDOW = Number(process.env.REBOOK_DAYS || 3);

/* IST: the store reports in Asia/Kolkata, and a UTC window would clip
   five and a half hours off the end of every Indian day. */
/* INCLUDE_TODAY makes the window end today rather than yesterday.
   Shopify orders are real-time, so today's revenue and order count are
   accurate the moment they land — unlike ad attribution, which lags. */
const INCLUDE_TODAY = process.env.INCLUDE_TODAY === "1";

/* An explicit range wins over DAYS, so the dashboard can ask for exactly
   the window on screen instead of a rolling count of days. */
const REQ_FROM = process.env.START_DATE || null;
const REQ_TO = process.env.END_DATE || null;

function istWindow(days, extraLookback = 0) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (REQ_FROM && REQ_TO) {
    const start = new Date(REQ_FROM + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - extraLookback);
    return { startDate: fmt(start), endDate: REQ_TO };
  }
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const end = new Date(now);
  if (!INCLUDE_TODAY) end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1 + extraLookback));
  return { startDate: fmt(start), endDate: fmt(end) };
}

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  /* Fetch a few days earlier than the reporting window so a rebook at
     the window edge can still find the order it replaced. */
  const report = istWindow(DAYS);
  const fetchWin = istWindow(DAYS, REBOOK_WINDOW);
  console.log(`Shopify pull · report ${report.startDate} → ${report.endDate} (IST) · fetch from ${fetchWin.startDate} for rebook lookback`);

  const shop = await fetchShop();
  console.log(`  store: ${shop.name} (${shop.myshopifyDomain}) · ${shop.currencyCode}`);

  const { orders, truncated } = await fetchOrders({
    ...fetchWin,
    onProgress: (count) => console.log(`    ${count} orders…`),
  });
  console.log(`  orders fetched: ${orders.length}`);
  if (!orders.length) {
    console.error("\nNo orders returned. Not writing — an empty file would read as zero sales.");
    process.exit(1);
  }
  /* A truncated pull drops the newest days while still looking whole, so
     it must fail rather than write. */
  if (truncated) {
    console.error("\nHit the page cap — the newest orders are missing. Not writing. Shorten the window or raise maxPages.");
    process.exit(1);
  }

  /* Prove the window actually reaches the requested end. */
  const days = [...new Set(orders.map((o) => String(o.createdAt || "").slice(0, 10)))].sort();
  const covered = `${days[0]} → ${days[days.length - 1]}`;
  console.log(`  covered: ${covered}${days[days.length - 1] < report.endDate ? "  ⚠ ENDS EARLY" : ""}`);

  /* Events are only needed for drafts with no other marker. */
  const allNeedEvents = orders.filter(
    (o) => isDraftApp(o) && !o.cancelledAt && !retailStoreOf(o) && !giftSignal(o)
  );
  /* One request per order, so a long window can mean thousands. Cap it
     and say plainly which orders went unattributed rather than letting
     the job time out halfway. */
  /* The timeline fetch is one request per draft and dominates runtime,
     so a fast refresh skips it. Those orders land in draft_unclassified
     until the next full pull, which is stated rather than hidden. */
  const SKIP_EVENTS = process.env.SKIP_EVENTS === "1";
  const EVENT_CAP = SKIP_EVENTS ? 0 : Number(process.env.EVENT_CAP || 3000);
  const needEvents = allNeedEvents.slice(-EVENT_CAP);   // newest first matters most
  if (allNeedEvents.length > EVENT_CAP) {
    console.log(`  ⚠ ${allNeedEvents.length} drafts need timelines; fetching the ${EVENT_CAP} most recent. Older ones will land in draft_unclassified.`);
  }
  if (SKIP_EVENTS) {
    console.log(`  ⚠ skipping timelines (fast refresh) — ${allNeedEvents.length} drafts stay unattributed until the next full pull.`);
  } else {
    console.log(`  fetching timeline for ${needEvents.length} unmarked drafts (stylist attribution)…`);
  }
  await attachEvents(needEvents, {
    onProgress: (d, t) => { if (d % 50 === 0 || d === t) console.log(`    ${d}/${t}`); },
  });

  const index = buildRebookIndex(orders, REBOOK_WINDOW);

  /* Report only on the requested window; the lookback was context. */
  const inWindow = orders.filter((o) => o.createdAt.slice(0, 10) >= report.startDate);
  const s = summariseOrders(inWindow, index);

  console.log("");
  for (const b of s.buckets) {
    console.log(`  ${pad(b.bucket, 17)} ${inr(b.revenue).padStart(13)}  ${String(b.orders).padStart(4)} orders  ${(100 * b.share).toFixed(0).padStart(3)}%  AOV ${inr(b.aov)}`);
  }
  console.log(`\n  digital (online + app): ${inr(s.totals.digitalRevenue)} — ${(100 * s.totals.digitalShare).toFixed(0)}% of revenue`);
  console.log(`  new / returning customers: ${s.totals.newCustomers} / ${s.totals.returningCustomers}`);

  if (s.totals.rebookOrders) {
    console.log(`\n  re-books: ${s.totals.rebookOrders} orders, ${inr(s.totals.rebookValue)} — labelled, not subtracted.`);
    console.log(`  revenue excluding re-books would be ${inr(s.totals.revenueExcludingRebooks)}.`);
  }
  if (s.totals.giftGrossValue) {
    console.log(`  gifts: ${inr(s.totals.giftGrossValue)} gifted at retail, ${inr(s.totals.giftValueWaived)} waived, ${inr(s.totals.giftCashReceived)} cash received.`);
  }
  if (s.stylists.length) {
    console.log(`\n  top stylists:`);
    for (const st of s.stylists.slice(0, 8)) console.log(`    ${pad(st.stylist, 16)} ${inr(st.revenue).padStart(12)}  ${st.orders} orders`);
  }
  if (s.stores.length) {
    console.log(`\n  retail-assist by store:`);
    for (const sv of s.stores.slice(0, 12)) {
      const note = sv.merged ? `  ← merged from ${sv.variants.join(" / ")}` : sv.matched === "unmatched" ? "  ← not on the roster" : "";
      console.log(`    ${pad(sv.store, 16)} ${inr(sv.revenue).padStart(12)}  ${String(sv.orders).padStart(3)} orders${note}`);
    }
  }
  if (s.unclassified.length) {
    console.log(`\n  ⚠ ${s.unclassified.length} drafts matched no rule — listed in the JSON, not guessed into a bucket.`);
  }
  if (s.nonDigital.length) {
    console.log(`\n  ⚠ high volume but under 35% digital (do not read as digital winners):`);
    console.log(`    ${s.nonDigital.slice(0, 8).map((p) => `${p.title} (${Math.round(100 * p.digitalShare)}%)`).join(", ")}`);
  }

  const payload = {
    ...envelope({
      source: "Shopify Admin API",
      account: shop.myshopifyDomain,
      range: `${report.startDate} → ${report.endDate} IST`,
      rows: inWindow,
      extra: {
        currency: shop.currencyCode,
        truncated,
        rebookWindowDays: REBOOK_WINDOW,
        includesToday: INCLUDE_TODAY,
        stylistAttribution: process.env.SKIP_EVENTS === "1" ? "skipped on this run" : "complete",
        rules: {
          retail_assist: "note matches REC AT <store> — endless aisle, not full retail",
          stylist: "timeline CommentEvent carrying the stylist's name",
          gift: "customer name contains GIFT, or a discount titled gift",
          rebook: "an earlier cancelled or voided order by the same customer within the window",
          note: "Retail proper is not in Shopify — it lives in eRetail. Re-books are labelled, never subtracted, so totals reconcile against Shopify's own reports.",
        },
      },
    }),
    totals: s.totals,
    buckets: s.buckets,
    stylists: s.stylists,
    stores: s.stores,
    nonDigital: s.nonDigital,
    unclassified: s.unclassified,
    fakeOrders: s.fakeOrders,
    actualRevenue: s.actualRevenue,
    products: s.products.slice(0, 200),
    categories: s.categories,
    /* Capped so the committed file stays small; covers the busiest
       lines, which is what anyone actually filters on. */
    productDaily: s.productDaily.slice(0, 4000),
    bucketDaily: s.bucketDaily,
    stylistDaily: s.stylistDaily,
    storeDaily: s.storeDaily,
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/shopify.json", JSON.stringify(payload, null, 2));
  /* Both reports printed in the log too, so a failed pull is obvious
     without opening the dashboard. */
  const fk = s.fakeOrders;
  console.log(`\n  fake / blocked-COD: ${fk.length} orders, ${inr(fk.reduce((a, f) => a + f.reversal, 0))} reversed`);
  if (fk.length) {
    const noUtm = fk.filter((f) => !f.utmCampaign).length;
    if (noUtm) console.log(`    ⚠ ${noUtm} have no UTM — needs the protected customer data scope`);
    const byCampaign = new Map();
    for (const f of fk) {
      const k = f.utmCampaign || "(none)";
      byCampaign.set(k, (byCampaign.get(k) || 0) + 1);
    }
    for (const [k, v] of [...byCampaign].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`    ${String(k).slice(0, 44).padEnd(46)} ${v}`);
    }
  }

  for (const k of ["online", "app"]) {
    const r = s.actualRevenue[k];
    console.log(`\n  ${k}: gross ${inr(r.grossSales)} + tax ${inr(r.tax)} − reversals ${inr(r.reversals)} = ${inr(r.actual)}`);
    if (r.rebookedCount) console.log(`    ${r.rebookedCount} same-day cancels were rebooked as drafts — not counted as reversals`);
    if (r.cancelledOtherDayCount) console.log(`    ${r.cancelledOtherDayCount} cancelled on a different day (${inr(r.cancelledOtherDay)}) — outside the same-day rule`);
  }

  console.log(`\nWrote data/shopify.json · ${s.categories.length} categories · ${Math.min(s.productDaily.length, 4000)} product-day rows · ${s.bucketDaily.length} bucket-days`);

  await appendFile("data/shopify-history.jsonl", JSON.stringify({
    ts: payload.fetchedAt,
    range: `${report.startDate}→${report.endDate}`,
    revenue: Math.round(s.totals.revenue),
    orders: s.totals.orders,
    digitalRevenue: Math.round(s.totals.digitalRevenue),
    digitalShare: Number(s.totals.digitalShare.toFixed(3)),
    rebookOrders: s.totals.rebookOrders,
    rebookValue: Math.round(s.totals.rebookValue),
    giftGross: Math.round(s.totals.giftGrossValue),
    newCustomers: s.totals.newCustomers,
    returningCustomers: s.totals.returningCustomers,
    ...Object.fromEntries(s.buckets.map((b) => [b.bucket, Math.round(b.revenue)])),
  }) + "\n");
  console.log("Appended data/shopify-history.jsonl");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
