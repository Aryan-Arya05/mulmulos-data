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
      name
      createdAt
      app { name }
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { numberOfOrders }
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

/** Every order created in the window, paginated. */
export async function fetchOrders({ startDate, endDate, maxPages = 40 }) {
  const q = `created_at:>=${startDate} AND created_at:<=${endDate}`;
  const out = [];
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await gql(ORDERS_QUERY, { q, after });
    const conn = data.orders;
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) return { orders: out, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  /* Say so rather than silently returning a partial window. */
  return { orders: out, truncated: true };
}

export async function fetchShop() {
  const d = await gql(`query { shop { name myshopifyDomain currencyCode ianaTimezone } }`);
  return d.shop;
}
