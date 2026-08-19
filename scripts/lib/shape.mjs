/* ============================================================
   Pure shaping logic. No network, no secrets — so it can be
   unit-tested and is the part you never have to debug live.

   The rule this file exists to enforce: a Google campaign whose
   name contains OMNI is optimising STORE VISITS. Its conversion
   value is a visit count, not rupees. Grading those on ROAS
   reported 3.61x against a real web figure of 5.61x on the
   18 Aug 2026 pull — a 55% understatement.
   ============================================================ */

export const isOmni = (name) => /omni/i.test(name || "");

/** Split raw campaign rows into web (gradeable) and OMNI (not gradeable). */
export function splitChannels(rows = []) {
  const web = rows.filter((r) => !isOmni(r.name));
  const omni = rows.filter((r) => isOmni(r.name));

  const sum = (list, key) => list.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  const webSpend = sum(web, "spend");
  const webRevenue = sum(web, "revenue");
  const omniSpend = sum(omni, "spend");
  const omniVisits = sum(omni, "conversions");
  const totalSpend = webSpend + omniSpend;

  return {
    web: web
      .map((r) => ({ ...r, roas: r.spend ? r.revenue / r.spend : null }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    omni: omni
      .map((r) => ({ ...r, costPerVisit: r.conversions ? r.spend / r.conversions : null }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    totals: {
      webSpend,
      webRevenue,
      webRoas: webSpend ? webRevenue / webSpend : null,
      omniSpend,
      omniVisits,
      omniCostPerVisit: omniVisits ? omniSpend / omniVisits : null,
      totalSpend,
      omniShare: totalSpend ? omniSpend / totalSpend : 0,
      /* What an unfiltered pull would wrongly report — kept so the
         dashboard can show the gap rather than just the right number. */
      naiveBlendedRoas: totalSpend ? (webRevenue + omniVisits) / totalSpend : null,
    },
  };
}

/** Wrap a payload with provenance. Nothing ships without knowing where it came from. */
export function envelope({ source, account, range, rows, extra = {} }) {
  return {
    source,
    account,
    range,
    fetchedAt: new Date().toISOString(),
    rowCount: rows.length,
    ...extra,
  };
}

/* ============================================================
   Shopify shaping.

   Shopify's "Draft Orders" app is not a channel — it is four
   different things sharing a bucket, confirmed against the live
   store on 19 Aug 2026:

     · retail_assist  store staff booking an out-of-stock item
                      note reads "REC AT <STORE> ..."
     · stylist        backend sale; a CommentEvent carries the
                      stylist's name, posted seconds after creation
     · gift           influencer/celebrity seeding; customer name
                      contains GIFT, or a discount titled "gift"
     · rebook         an earlier order by the same customer was
                      cancelled or voided and re-created as a draft
                      (size or product change)

   Retail proper is NOT in Shopify at all — it lives in eRetail.
   retail_assist is only the endless-aisle slice.

   Rebooks are LABELLED, never subtracted, so these totals stay
   reconcilable against Shopify's own reports. The double-counted
   value is reported alongside instead.
   ============================================================ */

const norm = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
const money = (o) => Number(o?.currentTotalPriceSet?.shopMoney?.amount || 0);

export const isDraftApp = (o) => /draft/i.test(o?.app?.name || "");

/* The 26-store roster. Notes are typed by hand under time pressure,
   so a store is matched by closest fit rather than exact string —
   CHHATARPUR and CHHATTARPUR are one store, and counting them apart
   put the wrong store at the top of the league table. */
export const STORE_ROSTER = [
  "AHMEDABAD", "BANGALORE JP", "BANGALORE STAND ALONE", "SAKET", "PROMENADE",
  "CHHATTARPUR", "GURGAON", "HYDERABAD", "KOLKATA", "JIO", "JUHU", "KALAGHODA",
  "LOWER PAREL", "KEMPS CORNER", "MALL OF INDIA", "LUDHIANA", "CHENNAI",
  "LUCKNOW", "JAIPUR", "RAIPUR", "GK", "MOHALI", "SOUTH EX", "CHANDIGARH",
  "KHAN MARKET", "SUMMIT",
];

/* Words that describe the format, not the location. */
const STORE_NOISE = /\b(STORE|STUDIO|OUTLET|SHOP|MALL|BOUTIQUE)\b/g;

/* Damerau-Levenshtein (optimal string alignment) rather than plain
   edit distance: a swapped pair of letters is the commonest typing
   error, and LUCKONW → LUCKNOW should cost one, not two. */
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[m][n];
}

/**
 * Map a hand-typed store name onto the roster.
 * Returns { store, raw, matched } — an unrecognised name is KEPT under
 * its own raw value and flagged, never dropped, because a store we
 * cannot name is still revenue we must count.
 */
export function normaliseStore(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(STORE_NOISE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  if (STORE_ROSTER.includes(cleaned)) return { store: cleaned, raw, matched: "exact" };

  /* A roster name contained in the typed name, or vice versa. */
  for (const r of STORE_ROSTER) {
    if (cleaned.includes(r) || r.includes(cleaned)) return { store: r, raw, matched: "contains" };
  }

  /* Closest edit distance, tolerant in proportion to length: about
     one typo per five characters, capped at three. */
  let best = null, bestD = Infinity;
  for (const r of STORE_ROSTER) {
    const d = editDistance(cleaned, r);
    if (d < bestD) { bestD = d; best = r; }
  }
  const tolerance = Math.min(3, Math.max(1, Math.floor(Math.max(cleaned.length, best?.length || 0) / 5)));
  if (best && bestD <= tolerance) return { store: best, raw, matched: `fuzzy(${bestD})` };

  return { store: cleaned, raw, matched: "unmatched" };
}

/** "REC AT JUHU STORE 16900" → "JUHU". Store names are typed by hand,
    so this normalises rather than matching a fixed roster. */
export function retailStoreOf(order) {
  const m = /rec\s*at\s+(.+?)(?:\s+store)?\s*(?:\d|cod|$)/i.exec(order?.note || "");
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  const n = normaliseStore(raw);
  return n ? n.store : null;
}

/** Same match, but keeps the provenance so merges stay auditable. */
export function retailStoreDetail(order) {
  const m = /rec\s*at\s+(.+?)(?:\s+store)?\s*(?:\d|cod|$)/i.exec(order?.note || "");
  if (!m) return null;
  return normaliseStore(m[1].trim());
}

/** Gift shows up two independent ways and they do not always co-occur. */
export function giftSignal(order) {
  const name = norm(order?.customer?.displayName) + " " + norm(order?.shippingAddress?.name);
  if (/\bgift\b/.test(name)) return "customer-name";
  const codes = order?.discountApplications?.nodes || order?.discountApplications || [];
  for (const d of codes) {
    const title = norm(d?.title || d?.code || d?.description);
    if (/\bgift\b/.test(title)) return "discount-title";
  }
  return null;
}

/** The stylist's name is the entire body of a CommentEvent. */
export function stylistOf(order) {
  const events = order?.events?.nodes || [];
  for (const e of events) {
    if (e.__typename !== "CommentEvent") continue;
    const raw = String(e.message || "").replace(/<[^>]+>/g, "").trim();
    /* Names only: reject anything long or sentence-like, so an
       operational note never gets counted as a stylist. */
    if (!raw || raw.length > 40 || raw.split(/\s+/).length > 3) continue;
    if (/^\d+$/.test(raw)) continue;
    return raw.replace(/\s+/g, " ").trim();
  }
  return null;
}

const CANCELLED = (o) =>
  !!o?.cancelledAt || /voided|refunded|expired/i.test(o?.displayFinancialStatus || "");

/**
 * Index cancelled/voided orders by customer so a draft can be matched
 * back to the order it replaced. Window is in days.
 */
export function buildRebookIndex(orders = [], windowDays = 3) {
  const byCustomer = new Map();
  for (const o of orders) {
    if (!CANCELLED(o)) continue;
    const id = o?.customer?.id;
    if (!id) continue;
    (byCustomer.get(id) || byCustomer.set(id, []).get(id)).push(o);
  }
  return { byCustomer, windowMs: windowDays * 86400000 };
}

/** Returns the source channel of the replaced order, or null. */
export function rebookOf(order, index) {
  if (!isDraftApp(order)) return null;
  const id = order?.customer?.id;
  if (!id || !index?.byCustomer?.has(id)) return null;

  const t = new Date(order.createdAt).getTime();
  for (const prior of index.byCustomer.get(id)) {
    const pt = new Date(prior.createdAt).getTime();
    const gap = t - pt;
    /* Prior must genuinely precede it, within the window. */
    if (gap <= 0 || gap > index.windowMs) continue;
    const app = norm(prior?.app?.name);
    if (/appbrew|mobile app/.test(app)) return { from: "app", order: prior.name };
    if (/online store|web/.test(app)) return { from: "online", order: prior.name };
    return { from: "other", order: prior.name };
  }
  return null;
}

/** Order of checks matters: a gift order also carries a stylist comment. */
export function classify(order, index) {
  const gift = giftSignal(order);
  if (gift) return { bucket: "gift", detail: gift };

  const rebook = rebookOf(order, index);
  if (rebook) return { bucket: `${rebook.from}_to_draft`, detail: rebook.order, rebook: true };

  if (isDraftApp(order)) {
    const store = retailStoreOf(order);
    if (store) return { bucket: "retail_assist", detail: store };
    const stylist = stylistOf(order);
    if (stylist) return { bucket: "stylist", detail: stylist };
    return { bucket: "draft_unclassified", detail: null };
  }

  const app = norm(order?.app?.name);
  if (/appbrew|mobile app/.test(app)) return { bucket: "app", detail: null };
  if (/online store|web/.test(app)) return { bucket: "online", detail: null };
  return { bucket: "other", detail: order?.app?.name || null };
}

export function summariseOrders(orders = [], index = null) {
  const buckets = {};
  const stylists = new Map();
  const stores = new Map();
  const products = new Map();
  const unclassified = [];
  let newCustomers = 0, returningCustomers = 0;
  let rebookCount = 0, rebookValue = 0;
  let giftGross = 0, giftCash = 0, giftWaived = 0;

  for (const o of orders) {
    if (CANCELLED(o)) continue; // never count a cancelled order as revenue
    const { bucket, detail, rebook } = classify(o, index);
    const amount = money(o);

    const b = (buckets[bucket] ||= { bucket, revenue: 0, orders: 0 });
    b.revenue += amount;
    b.orders += 1;

    if (rebook) { rebookCount++; rebookValue += amount; }
    if (bucket === "draft_unclassified") unclassified.push({ name: o.name, amount, note: o.note || null });

    if (bucket === "gift") {
      /* subtotalPriceSet is already NET of the gift discount, so the
         value actually gifted is what was paid plus what was waived. */
      const waived = Number(o?.totalDiscountsSet?.shopMoney?.amount || 0);
      giftGross += amount + waived;
      giftCash += amount;
      giftWaived += waived;
    }
    if (bucket === "stylist" && detail) {
      const k = detail.toUpperCase();
      const st = stylists.get(k) || { stylist: detail, revenue: 0, orders: 0 };
      st.revenue += amount; st.orders += 1;
      stylists.set(k, st);
    }
    if (bucket === "retail_assist" && detail) {
      const rec = retailStoreDetail(o);
      const sv = stores.get(detail) || { store: detail, revenue: 0, orders: 0, variants: new Set(), matched: rec?.matched };
      sv.revenue += amount; sv.orders += 1;
      if (rec?.raw) sv.variants.add(String(rec.raw).toUpperCase().replace(/\s+/g, " ").trim());
      stores.set(detail, sv);
    }

    const n = o?.customer?.numberOfOrders;
    if (n != null) (Number(n) <= 1 ? newCustomers++ : returningCustomers++);

    for (const li of o?.lineItems?.nodes || []) {
      const p = products.get(li.title) || { title: li.title, units: 0, revenue: 0, byBucket: {} };
      p.units += Number(li.quantity || 0);
      p.revenue += Number(li?.discountedTotalSet?.shopMoney?.amount || 0);
      p.byBucket[bucket] = (p.byBucket[bucket] || 0) + Number(li.quantity || 0);
      products.set(li.title, p);
    }
  }

  const total = Object.values(buckets).reduce((a, b) => a + b.revenue, 0);
  const digital = (buckets.online?.revenue || 0) + (buckets.app?.revenue || 0);

  const top = [...products.values()].map((p) => {
    const d = (p.byBucket.online || 0) + (p.byBucket.app || 0);
    return { ...p, digitalUnits: d, digitalShare: p.units ? d / p.units : null };
  }).sort((a, b) => b.units - a.units);

  return {
    buckets: Object.values(buckets)
      .map((b) => ({ ...b, share: total ? b.revenue / total : 0, aov: b.orders ? b.revenue / b.orders : null }))
      .sort((a, b) => b.revenue - a.revenue),
    totals: {
      revenue: total,
      orders: Object.values(buckets).reduce((a, b) => a + b.orders, 0),
      digitalRevenue: digital,
      digitalShare: total ? digital / total : 0,
      newCustomers, returningCustomers,
      newCustomerShare: newCustomers + returningCustomers ? newCustomers / (newCustomers + returningCustomers) : null,
      /* Labelled, not subtracted — totals stay reconcilable. */
      rebookOrders: rebookCount,
      rebookValue,
      revenueExcludingRebooks: total - rebookValue,
      giftGrossValue: giftGross,
      giftCashReceived: giftCash,
      giftValueWaived: giftWaived,
    },
    stylists: [...stylists.values()].sort((a, b) => b.revenue - a.revenue),
    stores: [...stores.values()]
      .map((sv) => ({ ...sv, variants: [...sv.variants], merged: sv.variants.size > 1 }))
      .sort((a, b) => b.revenue - a.revenue),
    products: top,
    /* Volume that is NOT digital — the Zuri check, now precise. */
    nonDigital: top.filter((p) => p.units >= 5 && p.digitalShare != null && p.digitalShare < 0.35)
      .map((p) => ({ title: p.title, units: p.units, digitalShare: Number(p.digitalShare.toFixed(2)) })),
    unclassified,
  };
}
