/* node scripts/classify.test.mjs
   Fixtures are real orders observed on the store, 18–19 Aug 2026. */
import { classify, buildRebookIndex, summariseOrders, retailStoreOf, giftSignal, stylistOf } from "./lib/shape.mjs";

let ok = true;
const t = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${pass ? "" : ` want ${JSON.stringify(want)}`}`);
};

const cust = (id, name, n = 1) => ({ id, displayName: name, numberOfOrders: n });
const price = (a) => ({ shopMoney: { amount: String(a) } });
const comment = (msg) => ({ events: { nodes: [{ __typename: "CommentEvent", message: msg }] } });

/* --- the real rebook: app order voided 18th, draft re-created 19th --- */
const voidedApp = {
  name: "#ML236843", createdAt: "2026-08-18T13:08:00Z",
  app: { name: "Mobile App Builder - Appbrew" }, displayFinancialStatus: "VOIDED",
  customer: cust("gid://c/8379532279859", "Lakshya Kishnani", 2),
  currentTotalPriceSet: price(0),
};
const draftRebook = {
  name: "#ML236923", createdAt: "2026-08-19T08:28:36Z",
  app: { name: "Draft Orders" }, tags: ["Appbrew"], displayFinancialStatus: "PENDING",
  customer: cust("gid://c/8379532279859", "Lakshya Kishnani", 2),
  currentTotalPriceSet: price(16850), ...comment("Anamika"),
};

const index = buildRebookIndex([voidedApp], 3);
t("app rebook detected", classify(draftRebook, index).bucket, "app_to_draft");
t("rebook names the original", classify(draftRebook, index).detail, "#ML236843");

/* An online original produces the other bucket. */
const voidedWeb = { ...voidedApp, name: "#ML1", app: { name: "Online Store" } };
t("online rebook", classify(draftRebook, buildRebookIndex([voidedWeb], 3)).bucket, "online_to_draft");

/* Outside the 3-day window it is not a rebook — it falls through to stylist. */
const old = { ...voidedApp, createdAt: "2026-08-10T13:08:00Z" };
t("outside window is not a rebook", classify(draftRebook, buildRebookIndex([old], 3)).bucket, "stylist");

/* A prior order that was NOT cancelled must not match. */
const paidPrior = { ...voidedApp, displayFinancialStatus: "PAID", cancelledAt: null };
t("uncancelled prior ignored", classify(draftRebook, buildRebookIndex([paidPrior], 3)).bucket, "stylist");

/* --- retail assist, real notes --- */
t("REC AT JUHU", retailStoreOf({ note: "REC AT JUHU STORE 16900" }), "JUHU");
t("REC AT MALL OF INDIA", retailStoreOf({ note: "REC AT MALL OF INDIA 11900" }), "MALL OF INDIA");
t("REC AT with COD, typo corrected", retailStoreOf({ note: "REC AT LUCKONW STORE COD ORDER " }), "LUCKNOW");
t("multiline note", retailStoreOf({ note: "REC AT KHAN MARKET STORE 18900\nBUST-29 WAIST-26" }), "KHAN MARKET");
t("no marker", retailStoreOf({ note: "Urgent order" }), null);

/* --- gift, both signals --- */
t("gift by name", giftSignal({ customer: cust("c1", "Mallaikaa Chheda (GIFT)") }), "customer-name");
t("gift by name, no space", giftSignal({ customer: cust("c1", "Gurleen Gambhir(GIFT)") }), "customer-name");
t("gift by name, mixed case", giftSignal({ customer: cust("c1", "Prerna stylefile ( Gift )") }), "customer-name");
t("gift by discount", giftSignal({ customer: cust("c1", "Someone"), discountApplications: { nodes: [{ title: "gift" }] } }), "discount-title");
t("gifted is not a gift signal on its own", giftSignal({ customer: cust("c1", "Gifty Sharma") }), null);

/* Gift outranks stylist — a gift order also carries a comment. */
const giftOrder = {
  name: "#ML236739", createdAt: "2026-08-18T11:01:00Z", app: { name: "Draft Orders" },
  customer: cust("c9", "Mallaikaa Chheda (GIFT)", 17),
  currentTotalPriceSet: price(7470), subtotalPriceSet: price(7470), totalDiscountsSet: price(17430), ...comment("Sagrika"),
};
t("gift beats stylist", classify(giftOrder, index).bucket, "gift");

/* --- stylist extraction --- */
t("stylist name", stylistOf(comment("Sagrika")), "Sagrika");
t("stylist trimmed", stylistOf(comment("  Anamika  ")), "Anamika");
t("sentence is not a stylist", stylistOf(comment("Please dispatch this urgently before Friday")), null);
t("number is not a stylist", stylistOf(comment("16900")), null);

/* --- totals: rebooks labelled, not subtracted --- */
const s = summariseOrders([
  draftRebook,                                                   // app_to_draft 16850
  giftOrder,                                                     // gift 7470 (gross 24900)
  { name: "#a", createdAt: "2026-08-19T01:00:00Z", app: { name: "Online Store" }, customer: cust("c2", "A", 1), currentTotalPriceSet: price(20000) },
  { name: "#b", createdAt: "2026-08-19T02:00:00Z", app: { name: "Draft Orders" }, note: "REC AT GK STORE 15900", customer: cust("c3", "B", 1), currentTotalPriceSet: price(15900) },
  { name: "#c", createdAt: "2026-08-19T03:00:00Z", app: { name: "Draft Orders" }, customer: cust("c4", "C", 2), currentTotalPriceSet: price(43900), ...comment("Sagrika") },
  voidedApp,                                                     // cancelled — excluded entirely
], index);

t("cancelled excluded from totals", s.totals.orders, 5);
t("total revenue", s.totals.revenue, 16850 + 7470 + 20000 + 15900 + 43900);
t("rebooks labelled not subtracted", s.totals.rebookValue, 16850);
t("revenue excluding rebooks", s.totals.revenueExcludingRebooks, 87270);
t("gift gross vs cash", [s.totals.giftGrossValue, s.totals.giftCashReceived], [24900, 7470]);
t("stylist attributed", s.stylists.map((x) => `${x.stylist}:${x.revenue}`), ["Sagrika:43900"]);
t("store attributed", s.stores.map((x) => `${x.store}:${x.revenue}`), ["GK:15900"]);
t("buckets present", s.buckets.map((b) => b.bucket).sort(), ["app_to_draft", "gift", "online", "retail_assist", "stylist"]);
t("nothing unclassified", s.unclassified.length, 0);

/* An unmarked draft is surfaced, never silently bucketed. */
const s2 = summariseOrders([{ name: "#x", createdAt: "2026-08-19T04:00:00Z", app: { name: "Draft Orders" }, customer: cust("c5", "X", 1), currentTotalPriceSet: price(999) }], index);
t("unclassified surfaced", s2.unclassified.map((u) => u.name), ["#x"]);

console.log(ok ? "\nCLASSIFY TESTS PASS" : "\nCLASSIFY TESTS FAIL");
process.exit(ok ? 0 : 1);
