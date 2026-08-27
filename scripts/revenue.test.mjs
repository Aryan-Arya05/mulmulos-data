/**
 * node scripts/revenue.test.mjs
 *
 * Locks the actual-revenue formula against two real Shopify exports that
 * were reconciled by hand. This existed because the figure was wrong
 * three times in a row and each fix was verified only against invented
 * data — which is how a same-day cancellation ended up subtracted
 * without ever being added.
 *
 * The rule, as Shopify's own report presents it:
 *   actual = gross sales + taxes − same-day reversals
 * A same-day cancellation is booked and then reversed, netting to zero.
 * A cancellation from an earlier day is not touched at all.
 */
import { summariseOrders, buildRebookIndex } from "./lib/shape.mjs";

let ok = true;
const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} ${n}`); };

const order = ({ name, day, gross, tax, cancelledDay = null, cust = name }) => ({
  name, createdAt: `${day}T06:00:00Z`,
  cancelledAt: cancelledDay ? `${cancelledDay}T09:00:00Z` : null,
  tags: [], app: { name: "Online Store" },
  customer: { id: cust, displayName: "X", numberOfOrders: 1 },
  currentSubtotalPriceSet: { shopMoney: { amount: String(gross) } },
  totalDiscountsSet: { shopMoney: { amount: "0" } },
  totalTaxSet: { shopMoney: { amount: String(tax) } },
  totalShippingPriceSet: { shopMoney: { amount: "0" } },
  currentTotalPriceSet: { shopMoney: { amount: String(gross + tax) } },
  lineItems: { nodes: [{ quantity: 1, title: "T", product: { productType: "K" },
    discountedTotalSet: { shopMoney: { amount: String(gross) } },
    originalTotalSet: { shopMoney: { amount: String(gross) } } }] },
});

const run = (orders) => {
  const s = summariseOrders(orders, buildRebookIndex(orders, 3));
  return s.actualRevenue.online;
};

/* --- a clean day --- */
{
  const r = run([
    order({ name: "#1", day: "2026-08-25", gross: 10000, tax: 1800 }),
    order({ name: "#2", day: "2026-08-25", gross: 20000, tax: 3600 }),
  ]);
  t("clean orders: gross + tax", r.actual === 35400);
  t("clean orders: no reversals", r.reversals === 0);
}

/* --- the case that was wrong: same-day cancellation --- */
{
  const r = run([
    order({ name: "#1", day: "2026-08-25", gross: 10000, tax: 1800 }),
    order({ name: "#2", day: "2026-08-25", gross: 5000, tax: 900, cancelledDay: "2026-08-25" }),
  ]);
  t("same-day cancel nets to zero", r.actual === 11800);
  t("but is still visible as gross", r.grossSales === 15000);
  t("and as a reversal", r.reversals === 5900);
  t("counted once", r.reversalCount === 1);
}

/* --- a cancellation from an earlier day is left alone --- */
{
  const r = run([
    order({ name: "#1", day: "2026-08-25", gross: 10000, tax: 1800 }),
    order({ name: "#old", day: "2026-08-20", gross: 8000, tax: 1440, cancelledDay: "2026-08-25" }),
  ]);
  t("prior-day cancel does not reduce today", r.actual === 11800);
  t("it is surfaced separately", r.cancelledOtherDayCount === 1);
}

/* --- cancel and rebook is not lost revenue --- */
{
  const rebook = {
    ...order({ name: "#draft", day: "2026-08-25", gross: 5000, tax: 900, cust: "same" }),
    app: { name: "Draft Orders" },
    createdAt: "2026-08-25T10:00:00Z",
  };
  const orders = [
    order({ name: "#1", day: "2026-08-25", gross: 10000, tax: 1800 }),
    order({ name: "#2", day: "2026-08-25", gross: 5000, tax: 900, cancelledDay: "2026-08-25", cust: "same" }),
    rebook,
  ];
  const r = run(orders);
  t("rebooked cancel still nets out of online", r.actual === 11800);
  t("and is labelled, not silently dropped", r.rebookedCount === 1);
}

/* --- the two real exports, reconciled by hand --- */
{
  /* Yesterday: 33 clean orders, one same-day cancel of 20,116.16. */
  const clean = order({ name: "#c", day: "2026-08-24", gross: 527996.33, tax: 94952.67 });
  const sameDay = order({ name: "#s", day: "2026-08-24", gross: 20116.16, tax: 0, cancelledDay: "2026-08-24" });
  const r = run([clean, sameDay]);
  t("matches the 24 Aug export (622,949.00)", Math.abs(r.actual - 622949) < 0.01);
}
{
  /* Today: 128,923.57 gross across 8 clean orders plus two same-day
     cancels totalling 15,865.67, tax 20,592.10 on the clean ones. */
  const clean = order({ name: "#c", day: "2026-08-25", gross: 113057.90, tax: 20592.10 });
  const s1 = order({ name: "#s1", day: "2026-08-25", gross: 2482.95, tax: 0, cancelledDay: "2026-08-25" });
  const s2 = order({ name: "#s2", day: "2026-08-25", gross: 13382.72, tax: 0, cancelledDay: "2026-08-25" });
  const r = run([clean, s1, s2]);
  t("matches the 25 Aug export (133,650.00)", Math.abs(r.actual - 133650) < 0.01);
}

console.log(ok ? "\nREVENUE TESTS PASS" : "\nREVENUE TESTS FAIL");
process.exit(ok ? 0 : 1);
