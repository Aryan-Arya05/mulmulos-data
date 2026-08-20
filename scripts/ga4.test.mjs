/* node scripts/ga4.test.mjs — fixtures use GA4's real response shape. */
import { toRows } from "./lib/ga4.mjs";
import { summariseGa4 } from "./lib/shape.mjs";

let ok = true;
const t = (n, got, want) => { const p = JSON.stringify(got) === JSON.stringify(want);
  if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${n}: ${JSON.stringify(got)}${p ? "" : ` want ${JSON.stringify(want)}`}`); };
const near = (n, got, want, tol = 0.0005) => { const p = got != null && Math.abs(got - want) < tol;
  if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${n}: ${got?.toFixed?.(5) ?? got}${p ? "" : ` want ~${want}`}`); };

/* --- GA4's nested row shape flattens correctly --- */
const report = {
  dimensionHeaders: [{ name: "date" }, { name: "streamName" }],
  metricHeaders: [{ name: "sessions" }, { name: "ecommercePurchases" }, { name: "purchaseRevenue" }],
  rows: [{ dimensionValues: [{ value: "20260801" }, { value: "Android" }],
           metricValues: [{ value: "1000" }, { value: "9" }, { value: "180000" }] }],
};
const rows = toRows(report);
t("dimensions mapped", [rows[0].date, rows[0].streamName], ["20260801", "Android"]);
t("metrics numeric", rows[0].sessions, 1000);
t("empty report safe", toRows({}).length, 0);
t("missing metric becomes null", toRows({ metricHeaders: [{ name: "sessions" }],
  rows: [{ metricValues: [{ value: "" }] }] })[0].sessions, null);

/* --- the collapse this exists to detect --- */
const mk = (date, stream, sessions, purchases) => ({
  date, streamName: stream, sessions, activeUsers: Math.round(sessions * 0.8),
  addToCarts: Math.round(sessions * 0.09), checkouts: Math.round(sessions * 0.03),
  ecommercePurchases: purchases, purchaseRevenue: purchases * 18000,
});
const days = [];
for (let i = 1; i <= 10; i++) days.push(mk(`202606${String(i).padStart(2,"0")}`, "Android", 1000, 9)); // 0.90%
for (let i = 11; i <= 20; i++) days.push(mk(`202606${String(i).padStart(2,"0")}`, "Android", 1100, 5)); // 0.45%
const s = summariseGa4(days, []);

t("YYYYMMDD converted to ISO", s.daily[0].date, "2026-06-01");
t("all days kept", s.daily.length, 20);
near("blended conversion rate", s.totals.conversionRate, 140 / 21000);
near("first half CVR", s.trend.firstHalf.conversionRate, 0.009);
near("second half CVR", s.trend.secondHalf.conversionRate, 5 / 1100);
near("conversion change", s.trend.conversionChange, (5/1100 - 0.009) / 0.009, 0.001);
t("sessions rose while conversion fell", s.trend.sessionChange > 0, true);
console.log(`     CVR 0.90% → 0.45% detected as ${(100 * s.trend.conversionChange).toFixed(0)}% with sessions +${(100 * s.trend.sessionChange).toFixed(0)}%`);

/* --- three streams reported separately --- */
const multi = summariseGa4([
  mk("20260801", "Android", 2000, 18), mk("20260801", "iOS", 1000, 12), mk("20260801", "Web", 5000, 20),
], []);
t("three streams", multi.streams.map(x => x.stream), ["Web", "Android", "iOS"]);
near("iOS converts best", multi.streams.find(x => x.stream === "iOS").conversionRate, 0.012);
t("stream order is by sessions", multi.streams[0].sessions, 5000);

/* --- funnel rates --- */
const one = summariseGa4([{ date: "20260801", streamName: "Web", sessions: 1000, activeUsers: 800,
  addToCarts: 90, checkouts: 30, ecommercePurchases: 9, purchaseRevenue: 162000 }], []);
near("cart rate", one.totals.cartRate, 0.09);
near("cart to checkout", one.totals.cartToCheckout, 1/3);
near("checkout to purchase", one.totals.checkoutToPurchase, 0.3);
t("AOV", one.totals.aov, 18000);

/* --- channels --- */
const ch = summariseGa4([], [{ sessionDefaultChannelGroup: "Paid Social", sessions: 4000, ecommercePurchases: 20, purchaseRevenue: 1 },
                             { sessionDefaultChannelGroup: "Direct", sessions: 9000, ecommercePurchases: 90, purchaseRevenue: 1 }]);
t("channels sorted by sessions", ch.channels.map(c => c.channel), ["Direct", "Paid Social"]);
near("paid social CVR", ch.channels[1].conversionRate, 0.005);

/* --- degenerate input --- */
const empty = summariseGa4([], []);
t("no rows → null CVR, not NaN", empty.totals.conversionRate, null);
t("no rows → no trend", empty.trend, null);
t("zero sessions safe", summariseGa4([{ date: "20260801", streamName: "X", sessions: 0,
  ecommercePurchases: 0 }], []).totals.conversionRate, null);

console.log(ok ? "\nGA4 TESTS PASS" : "\nGA4 TESTS FAIL");
process.exit(ok ? 0 : 1);
