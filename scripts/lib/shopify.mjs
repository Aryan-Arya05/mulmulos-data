/* ============================================================
   Shopify Admin GraphQL client.

   CONFIRMED against the live store (Shop Mulmul, Aug 2026):
     · Shop: shopmulmul.myshopify.com · INR · Asia/Kolkata
     · The orders query below was validated against the schema.
       Required scopes, per Shopify's own validator:
         read_orders, read_customers, read_products
       (read_marketplace_orders and read_quick_sale are also
        listed; grant them if your orders span those surfaces.)

   Auth is a custom-app Admin API access token (shpat_*), sent as
   X-Shopify-Access-Token. Admin tokens are all-or-nothing per
   scope, so grant read-only scopes and nothing else.
   ============================================================ */

const SHOP = process.env.SHOPIFY_SHOP || "shopmulmul.myshopify.com";
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const ENDPOINT = () => `https://${SHOP}/admin/api/${VERSION}/graphql.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gql(query, variables = {}) {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is not set — add it as a GitHub Secret.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT(), {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    /* Shopify throttles on a leaky bucket; 429 means wait, not fail. */
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${res.status}) — ${text.slice(0, 200)}`);
    }

    /* Shopify is inconsistent here: GraphQL errors arrive as an
       array, but auth failures return errors as a bare STRING
       ("Invalid API key or access token"). Assuming an array
       crashes on exactly the case you most need to read. */
    /* Shopify returns data AND errors when one field is denied.
       Discarding good rows over a blocked field would be worse than
       proceeding without it. */
    if (body.errors && body.data) {
      const list = Array.isArray(body.errors) ? body.errors : [body.errors];
      if (!list.some((e) => e?.extensions?.code === "THROTTLED")) return body.data;
    }
    if (body.errors) {
      if (typeof body.errors === "string") {
        throw new Error(`Shopify (${res.status}): ${body.errors}`);
      }
      const list = Array.isArray(body.errors) ? body.errors : [body.errors];
      if (list.some((e) => e?.extensions?.code === "THROTTLED")) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const msg = list.map((e) => (typeof e === "string" ? e : e?.message || JSON.stringify(e))).join("; ");
      /* Name the likely cause rather than making you guess. */
      const hint = /access denied|not approved|scope/i.test(msg)
        ? " — the app is missing a required scope (read_orders, read_customers, read_products)."
        : "";
      throw new Error(`GraphQL: ${msg}${hint}`);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    return body.data;
  }
  throw new Error("Throttled by Shopify after 5 attempts.");
}

const ORDERS_QUERY = `
query Orders($q: String!, $after: String) {
  orders(first: 50, query: $q, after: $after, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      cancelledAt
      note
      tags
      app { name }
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount } }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      discountApplications(first: 5) { nodes { ... on DiscountCodeApplication { code } ... on ManualDiscountApplication { title description } } }
      customer { id displayName numberOfOrders }
      shippingAddress { name }
      lineItems(first: 50) {
        nodes {
          quantity
          title
          sku
          product { id productType }
          discountedTotalSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

/* Events are a second round trip, so they are fetched only for the
   orders that need them — drafts with no other marker. */
const EVENTS_QUERY = `
query Events($id: ID!) {
  order(id: $id) {
    id
    events(first: 20, sortKey: CREATED_AT) { nodes { __typename createdAt message } }
  }
}`;

/**
 * Every order created in the window, paginated.
 *
 * The page cap exists only to stop a runaway loop. It must never be the
 * thing that ends a pull: Shopify returns orders oldest-first, so a cap
 * hit silently drops the NEWEST days and the file still looks complete.
 * 60 pages was 3,000 orders — about five weeks at this volume — which is
 * why a 120-day pull appeared to stop in May.
 */
export async function fetchOrders({ startDate, endDate, maxPages = 4000, onProgress }) {
  const q = `created_at:>=${startDate} AND created_at:<=${endDate}`;
  const out = [];
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await gql(ORDERS_QUERY, { q, after });
    const conn = data.orders;
    out.push(...conn.nodes);
    if (onProgress && page % 10 === 9) onProgress(out.length);
    if (!conn.pageInfo.hasNextPage) return { orders: out, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  return { orders: out, truncated: true };
}

/**
 * Attach events to the given orders, in small batches with a pause,
 * because Shopify's leaky bucket will not take hundreds of calls at once.
 */
export async function attachEvents(orders, { batch = 5, pauseMs = 600, onProgress } = {}) {
  let done = 0;
  for (let i = 0; i < orders.length; i += batch) {
    const slice = orders.slice(i, i + batch);
    await Promise.all(
      slice.map(async (o) => {
        try {
          const d = await gql(EVENTS_QUERY, { id: o.id || o.admin_graphql_api_id || o.gid });
          o.events = d?.order?.events || { nodes: [] };
        } catch {
          /* An order whose events cannot be read stays unclassified
             rather than being guessed into a bucket. */
          o.events = { nodes: [] };
        }
      })
    );
    done += slice.length;
    if (onProgress) onProgress(done, orders.length);
    if (i + batch < orders.length) await sleep(pauseMs);
  }
  return orders;
}

export async function fetchShop() {
  const d = await gql(`query { shop { name myshopifyDomain currencyCode ianaTimezone } }`);
  return d.shop;
}
