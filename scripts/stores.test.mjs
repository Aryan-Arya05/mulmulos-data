/* node scripts/stores.test.mjs
   Variants below are real strings observed in order notes. */
import { normaliseStore, retailStoreOf, summariseOrders, buildRebookIndex } from "./lib/shape.mjs";

let ok = true;
const t = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${pass ? "" : ` want ${JSON.stringify(want)}`}`);
};
const store = (v) => normaliseStore(v)?.store;
const how = (v) => normaliseStore(v)?.matched;

/* --- the split that broke the league table --- */
t("CHHATARPUR (one T)", store("CHHATARPUR"), "CHHATTARPUR");
t("CHHATTARPUR (two T)", store("CHHATTARPUR"), "CHHATTARPUR");
t("CHHATARPUR STUDIO", store("CHHATARPUR STUDIO"), "CHHATTARPUR");
t("CHHATTARPUR STUDIO", store("CHHATTARPUR STUDIO"), "CHHATTARPUR");
t("all four converge", new Set(["CHHATARPUR", "CHHATTARPUR", "CHHATARPUR STUDIO", "CHHATTARPUR STUDIO"].map(store)).size, 1);

/* --- other real typos --- */
t("LUCKONW → LUCKNOW", store("LUCKONW"), "LUCKNOW");
t("LUCKNOWW", store("LUCKNOWW"), "LUCKNOW");
t("MALL OF INDIA", store("MALL OF INDIA"), "MALL OF INDIA");
t("KHAN MARKET STORE", store("KHAN MARKET STORE"), "KHAN MARKET");
t("lowercase juhu", store("juhu"), "JUHU");
t("trailing punctuation", store("GK,"), "GK");
t("extra whitespace", store("  SOUTH   EX  "), "SOUTH EX");
t("KALAGHODA", store("KALAGHODA"), "KALAGHODA");
t("KALA GHODA spaced", store("KALA GHODA"), "KALAGHODA");
t("CHANDIGARGH typo", store("CHANDIGARGH"), "CHANDIGARH");

/* --- short names must not collapse into each other --- */
t("GK stays GK", store("GK"), "GK");
t("JIO stays JIO", store("JIO"), "JIO");
t("GK is exact not fuzzy", how("GK"), "exact");

/* --- a store not on the roster is KEPT, never dropped --- */
const unknown = normaliseStore("NAGPUR");
t("unknown kept", unknown.store, "NAGPUR");
t("unknown flagged", unknown.matched, "unmatched");

/* --- end to end through the note parser --- */
t("note: CHHATARPUR", retailStoreOf({ note: "REC AT CHHATARPUR STORE 27900" }), "CHHATTARPUR");
t("note: CHHATTARPUR", retailStoreOf({ note: "REC AT CHHATTARPUR STUDIO 15900" }), "CHHATTARPUR");
t("note: LUCKONW COD", retailStoreOf({ note: "REC AT LUCKONW STORE COD ORDER " }), "LUCKNOW");

/* --- the two Chhatarpur rows must now merge into one --- */
const mk = (note, amt) => ({
  name: "#" + amt, createdAt: "2026-08-19T05:00:00Z", app: { name: "Draft Orders" },
  note, customer: { id: "c" + amt, displayName: "X", numberOfOrders: 1 },
  currentTotalPriceSet: { shopMoney: { amount: String(amt) } },
});
const s = summariseOrders([
  mk("REC AT CHHATARPUR STUDIO 378150", 378150),
  mk("REC AT CHHATTARPUR STUDIO 185100", 185100),
  mk("REC AT KALAGHODA STORE 533800", 533800),
], buildRebookIndex([], 3));

const rows = s.stores.map((x) => `${x.store}:${x.revenue}`);
t("Chhatarpur merged and now leads", rows, ["CHHATTARPUR:563250", "KALAGHODA:533800"]);
t("merge is auditable", s.stores[0].variants.sort(), ["CHHATARPUR STUDIO", "CHHATTARPUR STUDIO"]);
t("merge flagged", s.stores[0].merged, true);

/* --- gift gross = cash paid + value waived --- */
const gift = {
  name: "#ML236739", createdAt: "2026-08-18T11:01:00Z", app: { name: "Draft Orders" },
  customer: { id: "g1", displayName: "Mallaikaa Chheda (GIFT)", numberOfOrders: 17 },
  currentTotalPriceSet: { shopMoney: { amount: "7470" } },
  subtotalPriceSet: { shopMoney: { amount: "7470" } },   // already net of discount
  totalDiscountsSet: { shopMoney: { amount: "17430" } },
};
const g = summariseOrders([gift], buildRebookIndex([], 3));
t("gift cash", g.totals.giftCashReceived, 7470);
t("gift waived", g.totals.giftValueWaived, 17430);
t("gift gross = cash + waived", g.totals.giftGrossValue, 24900);
t("gross no longer equals cash", g.totals.giftGrossValue !== g.totals.giftCashReceived, true);

console.log(ok ? "\nSTORE + GIFT TESTS PASS" : "\nSTORE + GIFT TESTS FAIL");
process.exit(ok ? 0 : 1);
