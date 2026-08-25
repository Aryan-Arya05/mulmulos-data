/* ============================================================
   Pure shaping logic. No network, no secrets — so it can be
   unit-tested and is the part you never have to debug live.

   The rule this file exists to enforce: a Google campaign whose
   name contains OMNI is optimising STORE VISITS. Its conversion
   value is a visit count, not rupees. Grading those on ROAS
   reported 3.61x against a real web figure of 5.61x on the
   18 Aug 2026 pull — a 55% understatement.
   ============================================================ */

/* ── Fake orders ──────────────────────────────────────────────────
   Tagged by the COD-fraud rules. Matching is case-insensitive and by
   substring, because staff and apps write these inconsistently —
   "Fake", "fake_order", "BLOCK_COD_METHOD" all count. */
const FAKE_TAGS = [/fake/i, /block_cod_method/i];

export const fakeTagsOn = (order) =>
  (order?.tags || []).filter((t) => FAKE_TAGS.some((re) => re.test(String(t))));

export const isFake = (order) => fakeTagsOn(order).length > 0;

/* UTMs sit behind protected customer data. Absent scope, the field comes
   back null and these read as "unknown" rather than silently empty. */
export function utmOf(order) {
  const u = order?.customerJourneySummary?.lastVisit?.utmParameters;
  return { campaign: u?.campaign || null, content: u?.content || null,
           source: u?.source || null, medium: u?.medium || null };
}

/* ── Revenue components ───────────────────────────────────────────
   Kept apart on purpose. Under GST-inclusive pricing a line item's
   original total already contains tax, so adding tax on top of it
   double-counts; keeping the pieces separate makes any mismatch with
   Shopify's own report visible instead of buried in one number. */
export function revenueParts(order) {
  const num = (v) => Number(v || 0);
  const lines = order?.lineItems?.nodes || [];
  const grossPreDiscount = lines.reduce(
    (a, li) => a + num(li?.originalTotalSet?.shopMoney?.amount), 0);
  const netAfterDiscount = lines.reduce(
    (a, li) => a + num(li?.discountedTotalSet?.shopMoney?.amount), 0);
  return {
    grossPreDiscount,
    netAfterDiscount,
    discounts: grossPreDiscount - netAfterDiscount,
    subtotal: num(order?.currentSubtotalPriceSet?.shopMoney?.amount),
    tax: num(order?.totalTaxSet?.shopMoney?.amount),
    shipping: num(order?.totalShippingPriceSet?.shopMoney?.amount),
    total: num(order?.currentTotalPriceSet?.shopMoney?.amount),
  };
}

export const isOmni = (name) => /omni/i.test(name || "");

/* Campaign type, inferred from the naming convention rather than a
   separate API field — the convention is consistent and this costs
   no extra request. OMNI is checked first because those are PMax
   campaigns buying store visits, which is a different thing again. */
export function campaignType(name = "") {
  const n = String(name);
  if (isOmni(n)) return "OMNI store visit";
  if (/performancemax|pmax/i.test(n)) return "Performance Max";
  if (/shopping/i.test(n)) return "Shopping";
  if (/search/i.test(n)) return "Search";
  if (/display|gdn/i.test(n)) return "Display";
  if (/video|youtube|yt/i.test(n)) return "Video";
  if (/demand.?gen|discovery/i.test(n)) return "Demand Gen";
  return "Other";
}

/* Where a creative layer actually exists. Shopping renders from the
   product feed and Performance Max only exposes asset groups, so
   there is nothing ad-level to fetch for either. */
export const hasCreatives = (type) => type === "Search" || type === "Display" || type === "Demand Gen";

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

  const byType = new Map();
  for (const r of rows) {
    const type = campaignType(r.name);
    const t = byType.get(type) || { type, spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0, campaigns: 0, gradeable: !isOmni(r.name) };
    t.spend += Number(r.spend) || 0;
    t.revenue += Number(r.revenue) || 0;
    t.conversions += Number(r.conversions) || 0;
    t.clicks += Number(r.clicks) || 0;
    t.impressions += Number(r.impressions) || 0;
    t.campaigns += 1;
    byType.set(type, t);
  }

  return {
    types: [...byType.values()].map((t) => ({
      ...t,
      roas: t.gradeable && t.spend ? t.revenue / t.spend : null,
      ctr: t.impressions ? (100 * t.clicks) / t.impressions : null,
      cpc: t.clicks ? t.spend / t.clicks : null,
      costPerConversion: t.conversions ? t.spend / t.conversions : null,
      creativeLayer: hasCreatives(t.type),
    })).sort((a, b) => b.spend - a.spend),
    web: web
      .map((r) => ({ ...r, type: campaignType(r.name), roas: r.spend ? r.revenue / r.spend : null }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    omni: omni
      .map((r) => ({ ...r, type: campaignType(r.name), costPerVisit: r.conversions ? r.spend / r.conversions : null }))
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


/**
 * The mirror of buildRebookIndex: that one lets a draft find the order
 * it replaced; this one lets a cancelled order find the draft that
 * replaced it. Needed because a cancel-and-rebook is not lost revenue —
 * the sale still happened — so it must not count as a reversal.
 */
export function buildReplacementIndex(orders = [], windowDays = 3) {
  const byCustomer = new Map();
  for (const o of orders) {
    if (!isDraftApp(o) || o?.cancelledAt) continue;
    const id = o?.customer?.id;
    if (!id) continue;
    if (!byCustomer.has(id)) byCustomer.set(id, []);
    byCustomer.get(id).push(o);
  }
  return { byCustomer, windowMs: windowDays * 86400000 };
}

/** Was this cancelled order re-created as a draft shortly after? */
export function replacedByDraft(order, idx) {
  const id = order?.customer?.id;
  if (!id || !idx?.byCustomer?.has(id)) return null;
  const t = new Date(order.createdAt).getTime();
  for (const draft of idx.byCustomer.get(id)) {
    const gap = new Date(draft.createdAt).getTime() - t;
    if (gap <= 0 || gap > idx.windowMs) continue;
    return draft.name;
  }
  return null;
}

function blankRevenue() {
  return {
    orders: 0, grossSales: 0, discounts: 0, tax: 0, shipping: 0, netTotal: 0,
    reversals: 0, reversalCount: 0,
    rebookedNotReversed: 0, rebookedCount: 0,
    cancelledOtherDay: 0, cancelledOtherDayCount: 0,
  };
}

export function summariseOrders(orders = [], index = null) {
  /* Built here rather than passed in, so callers cannot forget it and
     silently turn every rebook into a reversal. */
  const replacementIndex = buildReplacementIndex(orders, 3);
  const fakeOrders = [];
  /* Actual revenue, online and app kept apart because they are
     separate P&Ls in practice. */
  const actualRevenue = {
    online: blankRevenue(), app: blankRevenue(),
  };
  const buckets = {};
  const stylists = new Map();
  const stores = new Map();
  const products = new Map();
  /* Flat rows keyed by date x product x bucket, so the dashboard can
     filter by any of the three without a second pull. */
  const grain = new Map();
  /* The same idea for channels, stylists and stores: without a date on
     each row the dashboard can only ever show the whole pull window. */
  const bucketGrain = new Map();
  const stylistGrain = new Map();
  const storeGrain = new Map();
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

    const day = String(o.createdAt || "").slice(0, 10);

    /* date x bucket */
    const bk = `${day}|${bucket}`;
    const bg = bucketGrain.get(bk) || { date: day, bucket, revenue: 0, orders: 0, newCustomers: 0, returningCustomers: 0, waived: 0 };
    bg.revenue += amount; bg.orders += 1;
    if (n != null) (Number(n) <= 1 ? bg.newCustomers++ : bg.returningCustomers++);
    if (bucket === "gift") bg.waived += Number(o?.totalDiscountsSet?.shopMoney?.amount || 0);
    bucketGrain.set(bk, bg);

    /* date x stylist */
    if (bucket === "stylist" && detail) {
      const sk = `${day}|${detail.toUpperCase()}`;
      const sg = stylistGrain.get(sk) || { date: day, stylist: detail, revenue: 0, orders: 0 };
      sg.revenue += amount; sg.orders += 1;
      stylistGrain.set(sk, sg);
    }

    /* date x store */
    if (bucket === "retail_assist" && detail) {
      const kk = `${day}|${detail}`;
      const kg = storeGrain.get(kk) || { date: day, store: detail, revenue: 0, orders: 0 };
      kg.revenue += amount; kg.orders += 1;
      storeGrain.set(kk, kg);
    }
    for (const li of o?.lineItems?.nodes || []) {
      const qty = Number(li.quantity || 0);
      const rev = Number(li?.discountedTotalSet?.shopMoney?.amount || 0);
      const category = li?.product?.productType || "Uncategorised";

      const p = products.get(li.title) || { title: li.title, category, units: 0, revenue: 0, byBucket: {} };
      p.category = p.category || category;
      p.units += qty;
      p.revenue += rev;
      p.byBucket[bucket] = (p.byBucket[bucket] || 0) + qty;
      products.set(li.title, p);

      const gk = `${day}|${li.title}|${bucket}`;
      const g = grain.get(gk) || { date: day, title: li.title, category, bucket, units: 0, revenue: 0 };
      g.units += qty; g.revenue += rev;
      grain.set(gk, g);
    }
  }

  const total = Object.values(buckets).reduce((a, b) => a + b.revenue, 0);
  const digital = (buckets.online?.revenue || 0) + (buckets.app?.revenue || 0);

  /* Both reports are about orders the revenue loop deliberately skips —
     cancelled ones — so they run in their own pass. Classifying here
     rather than reusing the loop keeps the two concerns apart. */
  for (const o of orders) {
    const { bucket } = classify(o, index);
    const parts = revenueParts(o);
    const day = String(o.createdAt || "").slice(0, 10);
    const cancelDay = o.cancelledAt ? String(o.cancelledAt).slice(0, 10) : null;

    if (isFake(o)) {
      const utm = utmOf(o);
      fakeOrders.push({
        name: o.name,
        bucket,
        orderedAt: day,
        cancelledAt: cancelDay,
        /* Full order value: on a cancelled COD order no money ever moved,
           so the reversal is the whole thing, not a refund. */
        reversal: o.cancelledAt ? parts.total : 0,
        value: parts.total,
        utmCampaign: utm.campaign,
        utmContent: utm.content,
        tags: fakeTagsOn(o),
      });
    }

    if (bucket === "online" || bucket === "app") {
      const r = actualRevenue[bucket];
      if (!o.cancelledAt) {
        r.orders += 1;
        r.grossSales += parts.grossPreDiscount;
        r.discounts += parts.discounts;
        r.tax += parts.tax;
        r.shipping += parts.shipping;
        r.netTotal += parts.total;
      } else if (cancelDay === day) {
        /* Cancelled the same day it was placed. A cancel-and-rebook is
           not lost revenue — the sale still happened as a draft — so
           only genuine cancellations count as reversals. */
        if (replacedByDraft(o, replacementIndex)) {
          r.rebookedNotReversed += parts.total;
          r.rebookedCount += 1;
        } else {
          r.reversals += parts.total;
          r.reversalCount += 1;
        }
      } else {
        /* Placed one day, cancelled another. Outside the same-day rule,
           so surfaced rather than netted off. */
        r.cancelledOtherDay += parts.total;
        r.cancelledOtherDayCount += 1;
      }
    }
  }

  /* The formula as specified: gross plus taxes, less same-day reversals. grossPlusTax is kept alongside so a mismatch against
     Shopify's own report can be traced to a component rather than
     guessed at. */
  for (const k of Object.keys(actualRevenue)) {
    const r = actualRevenue[k];
    r.grossPlusTax = r.grossSales + r.tax;
    r.actual = r.grossPlusTax - r.reversals;
  }

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
    fakeOrders,
    actualRevenue,
    /* date x product x bucket — the filterable grain */
    productDaily: [...grain.values()].sort((a, b) => b.units - a.units),
    bucketDaily: [...bucketGrain.values()].sort((a, b) => a.date.localeCompare(b.date)),
    stylistDaily: [...stylistGrain.values()].sort((a, b) => b.revenue - a.revenue),
    storeDaily: [...storeGrain.values()].sort((a, b) => b.revenue - a.revenue),
    categories: [...new Set([...products.values()].map((p) => p.category))].filter(Boolean).sort(),
    /* Volume that is NOT digital — the Zuri check, now precise. */
    nonDigital: top.filter((p) => p.units >= 5 && p.digitalShare != null && p.digitalShare < 0.35)
      .map((p) => ({ title: p.title, units: p.units, digitalShare: Number(p.digitalShare.toFixed(2)) })),
    unclassified,
  };
}

/* ============================================================
   Meta shaping.

   The long-standing rule: reports use 7-day-click WEBSITE purchases.
   Meta's default insights return omni purchases — web plus app plus
   offline plus store visits — which run materially higher.

   This separates them. `offsite_conversion.fb_pixel_purchase` is the
   website pixel; `omni_purchase` is everything. Both are reported so
   the gap is visible rather than assumed away.

   ⚠ The web slice below has NOT yet been checked against an Ads
   Manager export. Until it is, treat it as a candidate, not as the
   report figure.
   ============================================================ */

const WEB_PURCHASE = "offsite_conversion.fb_pixel_purchase";
const OMNI_PURCHASE = "omni_purchase";

const actionVal = (list, type) => {
  const hit = (list || []).find((a) => a.action_type === type);
  return hit ? Number(hit.value || 0) : 0;
};

/** One raw insights row → a flat, typed record. */
export function shapeMetaRow(r) {
  const spend = Number(r.spend || 0);
  const webRevenue = actionVal(r.action_values, WEB_PURCHASE);
  const omniRevenue = actionVal(r.action_values, OMNI_PURCHASE);
  const webPurchases = actionVal(r.actions, WEB_PURCHASE);
  const omniPurchases = actionVal(r.actions, OMNI_PURCHASE);
  return {
    date: r.date_start,
    campaignId: r.campaign_id,
    name: r.campaign_name,
    objective: r.objective || null,
    spend,
    impressions: Number(r.impressions || 0),
    reach: Number(r.reach || 0),
    frequency: r.frequency == null ? null : Number(r.frequency),
    clicks: Number(r.clicks || 0),
    ctr: r.ctr == null ? null : Number(r.ctr),
    cpc: r.cpc == null ? null : Number(r.cpc),
    cpm: r.cpm == null ? null : Number(r.cpm),
    addToCart: actionVal(r.actions, "offsite_conversion.fb_pixel_add_to_cart"),
    checkouts: actionVal(r.actions, "offsite_conversion.fb_pixel_initiate_checkout"),
    webPurchases, omniPurchases,
    webRevenue, omniRevenue,
    webRoas: spend ? webRevenue / spend : null,
    omniRoas: spend ? omniRevenue / spend : null,
  };
}

/* Store-visit objectives buy footfall, not online revenue — the same
   trap as Google's OMNI campaigns. */
export const isStoreVisit = (r) =>
  /store_visits|store traffic/i.test(`${r.objective || ""} ${r.name || ""}`);

export function summariseMeta(rows = []) {
  const web = rows.filter((r) => !isStoreVisit(r));
  const visits = rows.filter(isStoreVisit);
  const sum = (list, k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  const spend = sum(web, "spend");
  const webRevenue = sum(web, "webRevenue");
  const omniRevenue = sum(web, "omniRevenue");

  const byCampaign = new Map();
  for (const r of web) {
    const c = byCampaign.get(r.name) || { name: r.name, spend: 0, webRevenue: 0, omniRevenue: 0, clicks: 0, impressions: 0, reach: 0, webPurchases: 0, addToCart: 0, checkouts: 0 };
    for (const k of ["spend", "webRevenue", "omniRevenue", "clicks", "impressions", "reach", "webPurchases", "addToCart", "checkouts"]) c[k] += Number(r[k]) || 0;
    byCampaign.set(r.name, c);
  }

  const byDate = new Map();
  for (const r of web) {
    const d = byDate.get(r.date) || { date: r.date, spend: 0, webRevenue: 0, omniRevenue: 0 };
    d.spend += r.spend; d.webRevenue += r.webRevenue; d.omniRevenue += r.omniRevenue;
    byDate.set(r.date, d);
  }

  /* Rates are derived from summed impressions and clicks. Averaging
     the daily CTR/CPC/CPM figures would weight a ₹500 day the same as
     a ₹50,000 one and quietly produce the wrong number. */
  const impressions = sum(web, "impressions");
  const clicks = sum(web, "clicks");

  return {
    totals: {
      spend,
      impressions, clicks,
      reach: sum(web, "reach"),
      cpm: impressions ? (spend / impressions) * 1000 : null,
      ctr: impressions ? (100 * clicks) / impressions : null,
      cpc: clicks ? spend / clicks : null,
      cpa: sum(web, "webPurchases") ? spend / sum(web, "webPurchases") : null,
      webRevenue, omniRevenue,
      webRoas: spend ? webRevenue / spend : null,
      omniRoas: spend ? omniRevenue / spend : null,
      /* How much omni flatters the account. */
      omniInflation: webRevenue ? (omniRevenue - webRevenue) / webRevenue : null,
      webPurchases: sum(web, "webPurchases"),
      addToCart: sum(web, "addToCart"),
      checkouts: sum(web, "checkouts"),
      storeVisitSpend: sum(visits, "spend"),
      /* The cross-campaign leak flagged in earlier audits. */
      cartToCheckout: sum(web, "addToCart") ? sum(web, "checkouts") / sum(web, "addToCart") : null,
      checkoutToPurchase: sum(web, "checkouts") ? sum(web, "webPurchases") / sum(web, "checkouts") : null,
    },
    campaigns: [...byCampaign.values()]
      .map((c) => ({
        ...c,
        webRoas: c.spend ? c.webRevenue / c.spend : null,
        omniRoas: c.spend ? c.omniRevenue / c.spend : null,
        cpm: c.impressions ? (c.spend / c.impressions) * 1000 : null,
        ctr: c.impressions ? (100 * c.clicks) / c.impressions : null,
        cpc: c.clicks ? c.spend / c.clicks : null,
        cpa: c.webPurchases ? c.spend / c.webPurchases : null,
        /* Reach is deduplicated per day, so summing it across days
           overstates unique people. Frequency here is directional. */
        frequency: c.reach ? c.impressions / c.reach : null,
      }))
      .sort((a, b) => b.spend - a.spend),
    storeVisit: visits,
    daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ============================================================
   GA4 shaping.

   The question this exists to answer: app conversion rate fell from
   roughly 0.93% to 0.45% after mid-June while sessions hit highs.
   Nothing in the stack could see it, because GA4 was never wired.

   Conversion rate is computed here as purchases / sessions rather
   than read from a GA4 metric, so the definition is explicit and
   comparable across streams.
   ============================================================ */

export function summariseGa4(streamRows = [], channelRows = []) {
  const n = (v) => Number(v || 0);

  const byDate = new Map();
  const byStream = new Map();

  for (const r of streamRows) {
    const date = r.date && r.date.length === 8
      ? `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`  // GA4 returns YYYYMMDD
      : r.date;
    const stream = r.streamName || r.streamId || "unknown";

    const d = byDate.get(date) || { date, sessions: 0, users: 0, addToCarts: 0, checkouts: 0, purchases: 0, revenue: 0 };
    const s = byStream.get(stream) || { stream, sessions: 0, users: 0, addToCarts: 0, checkouts: 0, purchases: 0, revenue: 0 };
    for (const [k, m] of [["sessions", "sessions"], ["users", "activeUsers"], ["addToCarts", "addToCarts"],
                          ["checkouts", "checkouts"], ["purchases", "ecommercePurchases"], ["revenue", "purchaseRevenue"]]) {
      d[k] += n(r[m]); s[k] += n(r[m]);
    }
    byDate.set(date, d); byStream.set(stream, s);
  }

  const withRates = (o) => ({
    ...o,
    conversionRate: o.sessions ? o.purchases / o.sessions : null,
    cartRate: o.sessions ? o.addToCarts / o.sessions : null,
    cartToCheckout: o.addToCarts ? o.checkouts / o.addToCarts : null,
    checkoutToPurchase: o.checkouts ? o.purchases / o.checkouts : null,
    aov: o.purchases ? o.revenue / o.purchases : null,
  });

  const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(withRates);
  const streams = [...byStream.values()].sort((a, b) => b.sessions - a.sessions).map(withRates);

  const totals = withRates(daily.reduce((a, d) => {
    for (const k of ["sessions", "users", "addToCarts", "checkouts", "purchases", "revenue"]) a[k] += d[k];
    return a;
  }, { sessions: 0, users: 0, addToCarts: 0, checkouts: 0, purchases: 0, revenue: 0 }));

  const channels = channelRows.map((r) => ({
    channel: r.sessionDefaultChannelGroup || "Unassigned",
    sessions: n(r.sessions),
    purchases: n(r.ecommercePurchases),
    revenue: n(r.purchaseRevenue),
    conversionRate: n(r.sessions) ? n(r.ecommercePurchases) / n(r.sessions) : null,
  })).sort((a, b) => b.sessions - a.sessions);

  /* Split the window in half and compare — a collapse mid-window is
     invisible in a single averaged figure. */
  let trend = null;
  if (daily.length >= 4) {
    const mid = Math.floor(daily.length / 2);
    const half = (arr) => {
      const s = arr.reduce((a, d) => a + d.sessions, 0);
      const p = arr.reduce((a, d) => a + d.purchases, 0);
      return { sessions: s, purchases: p, conversionRate: s ? p / s : null };
    };
    const first = half(daily.slice(0, mid));
    const second = half(daily.slice(mid));
    trend = {
      firstHalf: first, secondHalf: second,
      conversionChange: first.conversionRate ? (second.conversionRate - first.conversionRate) / first.conversionRate : null,
      sessionChange: first.sessions ? (second.sessions - first.sessions) / first.sessions : null,
    };
  }

  return { totals, daily, streams, channels, trend };
}
