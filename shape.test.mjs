/* node scripts/shape.test.mjs */
import { splitChannels, isOmni } from "./lib/shape.mjs";

let ok = true;
const t = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${pass ? "" : ` want ${JSON.stringify(want)}`}`);
};
const near = (name, got, want, tol = 0.01) => {
  const pass = Math.abs(got - want) < tol;
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${got?.toFixed?.(3) ?? got}${pass ? "" : ` want ~${want}`}`);
};

/* Real shape of the 18 Aug 2026 pull, Shop Mul Mul, last 7 days. */
const rows = [
  { name: "SHOP_2975_adyogi_Brand-Search_Engagenew", spend: 88154.2, conversions: 56.91, revenue: 1073333.57 },
  { name: "SHOP_2975_adyogi_Shopping_Rakhi", spend: 85059.65, conversions: 21.78, revenue: 424759.39 },
  { name: "SHOP_2975_adyogi_PerformanceMax_CapsulePrints", spend: 62440.23, conversions: 8, revenue: 156350 },
  { name: "SHOP_2975_adyogi_Shopping_Classic", spend: 58976.54, conversions: 8.55, revenue: 138036.65 },
  { name: "SHOP_2975_adyogi_PerformanceMax_rakhi", spend: 35594.64, conversions: 8, revenue: 154732.1 },
  { name: "SHOP_2975_adyogi_Shopping_Accessories", spend: 21804.98, conversions: 3, revenue: 26900 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Mumbai_Store", spend: 51129.04, conversions: 27, revenue: 27 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Delhi_Store", spend: 38520.53, conversions: 26, revenue: 26 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Bengaluru_Store", spend: 31300.62, conversions: 15, revenue: 15 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Jaipur_Store", spend: 20377.05, conversions: 29, revenue: 29 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Hyderabad_Store", spend: 14933.65, conversions: 6, revenue: 6 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Kolkata_Store", spend: 9747.46, conversions: 5, revenue: 5 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Mohali_Store", spend: 8554.73, conversions: 11, revenue: 11 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Ahmedabad_Store", spend: 7894.91, conversions: 6, revenue: 6 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Lucknow_Store", spend: 7207.78, conversions: 1, revenue: 1 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Chennai_Store", spend: 5034.69, conversions: 8, revenue: 8 },
  { name: "SHOP_2975_adyogi_PerformanceMax_OMNI_StoreVisit_Ludhiana_store", spend: 479.53, conversions: 1, revenue: 1 },
];

const s = splitChannels(rows);

t("web campaigns", s.web.length, 6);
t("omni campaigns", s.omni.length, 11);
near("web spend", s.totals.webSpend, 352030.24, 1);
near("web revenue", s.totals.webRevenue, 1974111.71, 1);
near("web ROAS", s.totals.webRoas, 5.607);
near("omni spend", s.totals.omniSpend, 195180, 1);
t("omni visits", s.totals.omniVisits, 135);
near("omni cost per visit", s.totals.omniCostPerVisit, 1445.8, 1);
near("omni share of spend", s.totals.omniShare, 0.3567);

/* The whole reason this file exists. */
near("naive blend (what an unfiltered pull reports)", s.totals.naiveBlendedRoas, 3.608);
const understatement = 1 - s.totals.naiveBlendedRoas / s.totals.webRoas;
near("understatement if OMNI is graded in", understatement, 0.3565);
console.log(`     web 5.61x vs naive 3.61x — grading OMNI in understates by ${(100 * understatement).toFixed(0)}%`);

/* Naming edge cases — the split must not be fooled by case or position. */
t("lowercase omni", isOmni("pmax_omni_storevisit"), true);
t("mixed case", isOmni("PMax_Omni_Delhi"), true);
t("omni absent", isOmni("Shopping_Rakhi"), false);
t("substring guard — 'omnibus' still matches", isOmni("omnibus"), true);
t("null safe", isOmni(null), false);

/* Zero-spend must not divide by zero. */
const z = splitChannels([{ name: "Dead", spend: 0, conversions: 0, revenue: 0 }]);
t("zero spend yields null ROAS", z.web[0].roas, null);
t("empty input safe", splitChannels([]).totals.webRoas, null);

/* Sorted heaviest first, so the dashboard never has to re-sort. */
t("web sorted by spend", s.web[0].name.includes("Brand-Search"), true);
t("omni sorted by spend", s.omni[0].name.includes("Mumbai"), true);

console.log(ok ? "\nSHAPE TESTS PASS" : "\nSHAPE TESTS FAIL");
process.exit(ok ? 0 : 1);
