/* node scripts/meta.test.mjs
   Fixtures use Meta's real insights response shape. */
import { shapeMetaRow, summariseMeta, isStoreVisit } from "./lib/shape.mjs";

let ok = true;
const t = (n, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${n}: ${JSON.stringify(got)}${pass ? "" : ` want ${JSON.stringify(want)}`}`);
};
const near = (n, got, want, tol = 0.01) => {
  const pass = Math.abs(got - want) < tol;
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${n}: ${got?.toFixed?.(3) ?? got}${pass ? "" : ` want ~${want}`}`);
};

/* A row where omni is much larger than the website slice — the whole
   reason this separation exists. */
const raw = {
  date_start: "2026-08-18", campaign_id: "1", campaign_name: "Classic_Rakhi_Launch",
  objective: "OUTCOME_SALES", spend: "112000", impressions: "840000", reach: "310000",
  frequency: "2.7", clicks: "9800", ctr: "1.17", cpc: "11.4", cpm: "133",
  actions: [
    { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "1240" },
    { action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: "420" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "26" },
    { action_type: "omni_purchase", value: "41" },
    { action_type: "landing_page_view", value: "7100" },
  ],
  action_values: [
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "418000" },
    { action_type: "omni_purchase", value: "664000" },
  ],
};
const r = shapeMetaRow(raw);

t("date", r.date, "2026-08-18");
t("spend numeric", r.spend, 112000);
t("website revenue picked", r.webRevenue, 418000);
t("omni revenue picked", r.omniRevenue, 664000);
t("website purchases", r.webPurchases, 26);
t("omni purchases", r.omniPurchases, 41);
near("website ROAS", r.webRoas, 3.732);
near("omni ROAS", r.omniRoas, 5.929);
t("web and omni differ", r.webRoas !== r.omniRoas, true);
t("ATC extracted", r.addToCart, 1240);
t("checkouts extracted", r.checkouts, 420);
t("unrelated action ignored", r.webPurchases !== 7100, true);

/* Missing action types must be zero, never undefined or NaN. */
const bare = shapeMetaRow({ date_start: "2026-08-18", campaign_name: "Awareness", spend: "5000" });
t("no actions → zero revenue", bare.webRevenue, 0);
t("no actions → zero ATC", bare.addToCart, 0);
t("zero revenue still gives a ROAS", bare.webRoas, 0);
const noSpend = shapeMetaRow({ date_start: "x", campaign_name: "y", spend: "0" });
t("zero spend → null ROAS, not Infinity", noSpend.webRoas, null);

/* Store-visit objectives are excluded from ROAS, same as Google OMNI. */
t("store visit by objective", isStoreVisit({ objective: "STORE_VISITS", name: "x" }), true);
t("store visit by name", isStoreVisit({ objective: "", name: "OMNI Store Traffic Delhi" }), true);
t("normal campaign not flagged", isStoreVisit({ objective: "OUTCOME_SALES", name: "Classic_Rakhi" }), false);

/* Totals across days and campaigns. */
const rows = [
  r,
  shapeMetaRow({ ...raw, date_start: "2026-08-17", spend: "90000",
    action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "300000" },
                    { action_type: "omni_purchase", value: "450000" }],
    actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "20" }] }),
  shapeMetaRow({ date_start: "2026-08-18", campaign_name: "Store Traffic Mumbai",
    objective: "STORE_VISITS", spend: "40000" }),
];
const s = summariseMeta(rows);

t("store-visit spend excluded from main spend", s.totals.spend, 202000);
t("store-visit spend reported separately", s.totals.storeVisitSpend, 40000);
t("web revenue summed", s.totals.webRevenue, 718000);
t("omni revenue summed", s.totals.omniRevenue, 1114000);
near("blended web ROAS", s.totals.webRoas, 3.554);
near("omni inflation", s.totals.omniInflation, 0.5515);
console.log(`     omni reads ${(100 * s.totals.omniInflation).toFixed(0)}% above the website slice`);

t("campaigns merged across days", s.campaigns.length, 1);
t("campaign spend merged", s.campaigns[0].spend, 202000);
t("daily rows kept", s.daily.map((d) => d.date), ["2026-08-17", "2026-08-18"]);
/* Row 2 overrides `actions`, so only row 1 contributes ATC. */
near("cart to checkout", s.totals.cartToCheckout, 420 / 1240);
near("checkout to purchase", s.totals.checkoutToPurchase, 46 / 420);

t("empty input safe", summariseMeta([]).totals.webRoas, null);

console.log(ok ? "\nMETA TESTS PASS" : "\nMETA TESTS FAIL");
process.exit(ok ? 0 : 1);
