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

   The rule this exists to enforce: Shopify's all-channel totals
   mix online, retail and draft orders. Zuri read as a digital
   winner on that view and was almost entirely retail. Every
   figure below is split by channel before it means anything.
   ============================================================ */

/* Retail orders originate from the POS app; drafts from the admin.
   Anything else is treated as online. */
export function channelOf(order) {
  const app = (order?.app?.name || "").toLowerCase();
  if (!app) return "unknown";
  if (app.includes("point of sale") || app.includes("pos")) return "retail";
  if (app.includes("draft")) return "draft";
  return "online";
}

const money = (o) => Number(o?.currentTotalPriceSet?.shopMoney?.amount || 0);

export function summariseOrders(orders = []) {
  const channels = {};
  const products = new Map();
  let newCustomers = 0;
  let returningCustomers = 0;

  for (const o of orders) {
    const ch = channelOf(o);
    const amount = money(o);
    const c = (channels[ch] ||= { channel: ch, revenue: 0, orders: 0 });
    c.revenue += amount;
    c.orders += 1;

    /* numberOfOrders counts the customer's lifetime orders, so 1
       means this order was their first. Guest orders have no
       customer object and are counted in neither bucket. */
    const n = o?.customer?.numberOfOrders;
    if (n != null) (Number(n) <= 1 ? newCustomers++ : returningCustomers++);

    for (const li of o?.lineItems?.nodes || []) {
      const key = li.title;
      const p = products.get(key) || { title: key, sku: li.sku || null, type: li.product?.productType || null, units: 0, revenue: 0, online: 0, retail: 0 };
      const lineRevenue = Number(li?.discountedTotalSet?.shopMoney?.amount || 0);
      p.units += Number(li.quantity || 0);
      p.revenue += lineRevenue;
      if (ch === "retail") p.retail += Number(li.quantity || 0);
      if (ch === "online") p.online += Number(li.quantity || 0);
      products.set(key, p);
    }
  }

  const totalRevenue = Object.values(channels).reduce((a, c) => a + c.revenue, 0);
  const totalOrders = Object.values(channels).reduce((a, c) => a + c.orders, 0);
  const online = channels.online || { revenue: 0, orders: 0 };

  const top = [...products.values()]
    .map((p) => ({ ...p, onlineShare: p.units ? p.online / p.units : null }))
    .sort((a, b) => b.units - a.units);

  return {
    channels: Object.values(channels)
      .map((c) => ({ ...c, share: totalRevenue ? c.revenue / totalRevenue : 0, aov: c.orders ? c.revenue / c.orders : null }))
      .sort((a, b) => b.revenue - a.revenue),
    totals: {
      revenue: totalRevenue,
      orders: totalOrders,
      aov: totalOrders ? totalRevenue / totalOrders : null,
      onlineRevenue: online.revenue,
      onlineOrders: online.orders,
      onlineAov: online.orders ? online.revenue / online.orders : null,
      newCustomers,
      returningCustomers,
      newCustomerShare: newCustomers + returningCustomers ? newCustomers / (newCustomers + returningCustomers) : null,
    },
    products: top,
    /* Products whose volume is mostly retail — the Zuri check. */
    retailDriven: top.filter((p) => p.units >= 5 && p.onlineShare != null && p.onlineShare < 0.35).map((p) => p.title),
  };
}
