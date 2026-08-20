/* ============================================================
   Pulls GA4 sessions and the ecommerce funnel by day and stream.
   Writes data/ga4.json, appends data/ga4-history.jsonl.

   Local:  GA4_SERVICE_ACCOUNT='{"type":"service_account",...}' \
           node scripts/pull-ga4.mjs
   ============================================================ */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { runReport, toRows } from "./lib/ga4.mjs";
import { summariseGa4, envelope } from "./lib/shape.mjs";

const PROPERTY = process.env.GA4_PROPERTY_ID || "469222398";
const DAYS = Number(process.env.DAYS || 28);

/* App and web are separate properties measuring different journeys.
   Keeping them in separate files means the funnels can be compared
   rather than blurred into one average. */
const LABEL = process.env.GA4_LABEL || "app";
const OUT = `data/ga4-${LABEL}.json`;
const HIST = `data/ga4-${LABEL}-history.jsonl`;

const pct = (v) => v == null ? "—" : (100 * v).toFixed(2) + "%";
const num = (v) => v == null ? "—" : Math.round(v).toLocaleString("en-IN");
const inr = (v) => "₹" + Math.round(v || 0).toLocaleString("en-IN");
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const since = `${DAYS}daysAgo`, until = "yesterday";
  console.log(`GA4 pull · ${LABEL} · property ${PROPERTY} · last ${DAYS} days`);

  const METRICS = ["sessions", "activeUsers", "addToCarts", "checkouts", "ecommercePurchases", "purchaseRevenue"]
    .map((name) => ({ name }));

  const byStream = await runReport(PROPERTY, {
    dateRanges: [{ startDate: since, endDate: until }],
    dimensions: [{ name: "date" }, { name: "streamName" }],
    metrics: METRICS,
    limit: 100000,
  });
  const streamRows = toRows(byStream);
  console.log(`  rows: ${streamRows.length}`);
  if (!streamRows.length) {
    console.error("\nNo rows returned. Not writing — an empty file would read as zero traffic.");
    process.exit(1);
  }

  const byChannel = await runReport(PROPERTY, {
    dateRanges: [{ startDate: since, endDate: until }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: METRICS,
    limit: 100,
  });

  const s = summariseGa4(streamRows, toRows(byChannel));
  const t = s.totals;

  console.log(`\n  sessions ${num(t.sessions)} · users ${num(t.users)} · purchases ${num(t.purchases)} · revenue ${inr(t.revenue)}`);
  console.log(`  conversion rate ${pct(t.conversionRate)}   (purchases ÷ sessions)`);
  console.log(`  funnel: ${pct(t.cartRate)} add to cart → ${pct(t.cartToCheckout)} reach checkout → ${pct(t.checkoutToPurchase)} purchase`);

  console.log(`\n  by stream:`);
  for (const x of s.streams) {
    console.log(`    ${pad(x.stream.slice(0, 24), 26)} ${num(x.sessions).padStart(9)} sessions  CVR ${pct(x.conversionRate).padStart(7)}  AOV ${inr(x.aov)}`);
  }

  if (s.trend) {
    const { firstHalf: a, secondHalf: b, conversionChange, sessionChange } = s.trend;
    console.log(`\n  first half CVR ${pct(a.conversionRate)} → second half ${pct(b.conversionRate)}` +
      (conversionChange == null ? "" : `  (${conversionChange >= 0 ? "+" : ""}${(100 * conversionChange).toFixed(0)}%)`));
    if (conversionChange != null && conversionChange < -0.15 && sessionChange > -0.05) {
      console.log(`  ⚠ conversion fell while sessions held — traffic is arriving and not converting.`);
    }
  }

  console.log(`\n  by channel:`);
  for (const c of s.channels.slice(0, 8)) {
    console.log(`    ${pad(c.channel.slice(0, 24), 26)} ${num(c.sessions).padStart(9)} sessions  CVR ${pct(c.conversionRate)}`);
  }

  const payload = {
    ...envelope({
      source: "GA4 Data API",
      account: `${LABEL} — property ${PROPERTY}`,
      label: LABEL,
      range: `${DAYS} days to yesterday`,
      rows: streamRows,
      extra: {
        conversionRate: "purchases ÷ sessions, computed here so the definition is explicit rather than inherited from a GA4 metric.",
        retention: "Standard GA4 keeps event data 14 months maximum. Nothing can backfill beyond that.",
        note: "Appbrew's own dashboard has overstated revenue 16–18% against Shopify. Shopify remains authoritative for money.",
      },
    }),
    totals: t, daily: s.daily, streams: s.streams, channels: s.channels, trend: s.trend,
  };

  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT} (${s.daily.length} days, ${s.streams.length} streams)`);

  const lines = s.daily.map((d) => JSON.stringify({
    ts: payload.fetchedAt, date: d.date, sessions: d.sessions, users: d.users,
    addToCarts: d.addToCarts, checkouts: d.checkouts, purchases: d.purchases,
    revenue: Math.round(d.revenue),
    conversionRate: d.conversionRate == null ? null : Number(d.conversionRate.toFixed(5)),
  }));
  await appendFile(HIST, lines.join("\n") + "\n");
  console.log(`Appended ${lines.length} days to ${HIST}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
