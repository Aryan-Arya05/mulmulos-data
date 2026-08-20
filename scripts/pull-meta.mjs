/* ============================================================
   Pulls Meta Ads daily insights, separates website purchases from
   omni, writes data/meta.json and appends data/meta-history.jsonl.

   Local:  META_ACCESS_TOKEN=... node scripts/pull-meta.mjs
   ============================================================ */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { fetchInsights, fetchAccount } from "./lib/meta.mjs";
import { shapeMetaRow, summariseMeta, envelope } from "./lib/shape.mjs";

const ACCOUNT = process.env.META_ACCOUNT_ID || "277407879800547";
const DAYS = Number(process.env.DAYS || 7);

function window(days) {
  const end = new Date(Date.now() + 5.5 * 3600 * 1000);
  end.setUTCDate(end.getUTCDate() - 1);           // yesterday: today is partial
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const f = (d) => d.toISOString().slice(0, 10);
  return { since: f(start), until: f(end) };
}

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const { since, until } = window(DAYS);
  console.log(`Meta pull · act_${ACCOUNT} · ${since} → ${until}`);

  const acct = await fetchAccount(ACCOUNT);
  console.log(`  account: ${acct.name} · ${acct.currency} · ${acct.timezone_name}`);
  if (acct.account_status !== 1) {
    console.log(`  ⚠ account_status is ${acct.account_status} (1 = active). Delivery may be blocked.`);
  }

  const raw = await fetchInsights({ accountId: ACCOUNT, since, until });
  console.log(`  daily campaign rows: ${raw.length}`);
  if (!raw.length) {
    console.error("\nNo rows returned. Not writing — an empty file would read as zero spend.");
    process.exit(1);
  }

  const rows = raw.map(shapeMetaRow);
  const s = summariseMeta(rows);
  const t = s.totals;

  console.log("");
  console.log(`  spend            ${inr(t.spend)}`);
  console.log(`  website revenue  ${inr(t.webRevenue)}   ROAS ${t.webRoas?.toFixed(2) ?? "—"}x   (7-day click, pixel purchases)`);
  console.log(`  omni revenue     ${inr(t.omniRevenue)}   ROAS ${t.omniRoas?.toFixed(2) ?? "—"}x   (all surfaces)`);
  if (t.omniInflation != null) {
    console.log(`  omni reads ${(100 * t.omniInflation).toFixed(0)}% higher than the website slice`);
  }
  if (t.storeVisitSpend) console.log(`  store-visit spend ${inr(t.storeVisitSpend)} — excluded from ROAS`);

  console.log(`\n  funnel: ${t.addToCart} ATC → ${t.checkouts} checkout (${(100 * (t.cartToCheckout ?? 0)).toFixed(0)}%) → ${t.webPurchases} purchase (${(100 * (t.checkoutToPurchase ?? 0)).toFixed(0)}%)`);

  console.log(`\n  top campaigns:`);
  for (const c of s.campaigns.slice(0, 10)) {
    console.log(`    ${pad(c.name.slice(0, 38), 40)} ${inr(c.spend).padStart(11)}  web ${(c.webRoas ?? 0).toFixed(2)}x  omni ${(c.omniRoas ?? 0).toFixed(2)}x`);
  }

  const payload = {
    ...envelope({
      source: "Meta Marketing API",
      account: `act_${ACCOUNT} — ${acct.name}`,
      range: `${since} → ${until}`,
      rows,
      extra: {
        currency: acct.currency,
        accountStatus: acct.account_status,
        attribution: "7d_click requested explicitly. Meta's default unified setting folds in view-through and reads higher.",
        unverified: "The website slice below has NOT been checked against an Ads Manager export. Compare once before using it in a report.",
      },
    }),
    totals: t,
    campaigns: s.campaigns,
    daily: s.daily,
    storeVisitCampaigns: [...new Set(s.storeVisit.map((r) => r.name))],
    rows,                       // daily × campaign, so any range can be sliced
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/meta.json", JSON.stringify(payload, null, 2));
  console.log(`\nWrote data/meta.json (${rows.length} daily rows)`);

  /* One line per day — the trend spine, same shape as the others. */
  const lines = s.daily.map((d) => JSON.stringify({
    ts: payload.fetchedAt, date: d.date,
    spend: Math.round(d.spend),
    webRevenue: Math.round(d.webRevenue),
    omniRevenue: Math.round(d.omniRevenue),
    webRoas: Number((d.spend ? d.webRevenue / d.spend : 0).toFixed(3)),
  }));
  await appendFile("data/meta-history.jsonl", lines.join("\n") + "\n");
  console.log(`Appended ${lines.length} days to data/meta-history.jsonl`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
