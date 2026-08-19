/* ============================================================
   Pulls Shopify orders, splits by channel, writes
   data/shopify.json and appends data/shopify-history.jsonl.

   Local run:
     SHOPIFY_ACCESS_TOKEN=shpat_xxx node scripts/pull-shopify.mjs
   ============================================================ */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { fetchOrders, fetchShop } from "./lib/shopify.mjs";
import { summariseOrders, envelope } from "./lib/shape.mjs";

const DAYS = Number(process.env.DAYS || 7);

/* IST, because the store reports in Asia/Kolkata and a UTC window
   would clip the last five and a half hours of every Indian day. */
function istWindow(days) {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1); // yesterday: today is partial
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

async function main() {
  const { startDate, endDate } = istWindow(DAYS);
  console.log(`Shopify pull · ${startDate} → ${endDate} (IST)`);

  const shop = await fetchShop();
  console.log(`  store: ${shop.name} (${shop.myshopifyDomain}) · ${shop.currencyCode} · ${shop.ianaTimezone}`);

  const { orders, truncated } = await fetchOrders({ startDate, endDate });
  console.log(`  orders fetched: ${orders.length}${truncated ? " (TRUNCATED — hit the page cap)" : ""}`);

  if (!orders.length) {
    console.error("\nNo orders returned. Not writing data — an empty file would read as zero sales.");
    process.exit(1);
  }

  const s = summariseOrders(orders);

  for (const c of s.channels) {
    console.log(`  ${c.channel.padEnd(9)} ${inr(c.revenue).padStart(12)}  ${String(c.orders).padStart(4)} orders  ${(100 * c.share).toFixed(0)}%  AOV ${inr(c.aov)}`);
  }
  console.log(`  new/returning customers: ${s.totals.newCustomers} / ${s.totals.returningCustomers}`);
  if (s.retailDriven.length) {
    console.log(`\n⚠ Retail-driven despite high volume (do not read as digital winners):`);
    console.log(`  ${s.retailDriven.slice(0, 10).join(", ")}`);
  }

  const payload = {
    ...envelope({
      source: "Shopify Admin API",
      account: shop.myshopifyDomain,
      range: `${startDate} → ${endDate} IST`,
      rows: orders,
      extra: {
        currency: shop.currencyCode,
        truncated,
        rule: "All-channel totals mix online, retail and draft orders. Split before calling any product a digital winner.",
      },
    }),
    totals: s.totals,
    channels: s.channels,
    retailDriven: s.retailDriven,
    products: s.products.slice(0, 200),
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/shopify.json", JSON.stringify(payload, null, 2));
  console.log(`\nWrote data/shopify.json`);

  await appendFile(
    "data/shopify-history.jsonl",
    JSON.stringify({
      ts: payload.fetchedAt,
      range: `${startDate}→${endDate}`,
      revenue: Math.round(s.totals.revenue),
      orders: s.totals.orders,
      onlineRevenue: Math.round(s.totals.onlineRevenue),
      onlineOrders: s.totals.onlineOrders,
      aov: Math.round(s.totals.aov || 0),
      newCustomers: s.totals.newCustomers,
      returningCustomers: s.totals.returningCustomers,
    }) + "\n"
  );
  console.log("Appended data/shopify-history.jsonl");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
