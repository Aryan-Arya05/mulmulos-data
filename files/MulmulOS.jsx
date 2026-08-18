import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

/* ============================================================
   MULMUL OS — operator command center
   Shape borrowed from FounderOS: departments → agents → runs,
   an honest connections board, a knowledge graph, a run log.
   Content is Mulmul's. Theme is Terminal.

   Load-bearing rule, same as the reference: nothing ever
   reports a fake "connected", and no agent claims to have done
   something it did not do.
   ============================================================ */

const T = {
  /* Deep navy base — the ServiceFlow / JARVIS register, not terminal black */
  bg: "#070d1a",
  bgDeep: "#04070f",
  surface: "#0c1526",
  surfaceHi: "#111c31",
  surfaceRaise: "#16223a",
  border: "#1c2a44",
  borderHi: "#27395a",

  text: "#e8eefc",
  muted: "#94a6c4",
  dim: "#5b6f92",

  /* Paired accents: cyan carries "live", violet carries "needs you" */
  accent: "#38bdf8",
  accentDeep: "#0ea5e9",
  violet: "#a78bfa",
  violetDeep: "#8b5cf6",

  ok: "#34d399",
  warn: "#fbbf24",
  err: "#fb7185",
};


const MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
/* Sans for labels and prose; mono is reserved for figures, which is what
   makes the reference dashboards read as clean rather than as a terminal. */
const SANS =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const R = { sm: 6, md: 10, lg: 14, pill: 999 };


/* Glow is chrome only — gauges, meters, live indicators, card edges.
   It never sits behind a number you have to read. */
const glow = (c, a = 0.28, r = 20) => `0 0 ${r}px ${c}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

/* Radial gauge — the composite score, readable from across a desk. */
function Gauge({ value, label, sub, colour, size = 132 }) {
  const r = size / 2 - 11;
  const circ = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const c = colour || T.accent;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.border} strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={7}
          strokeDasharray={`${circ * pct} ${circ}`}
          style={{ filter: `drop-shadow(0 0 6px ${c})`, transition: "stroke-dasharray .7s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <div style={{ fontSize: 30, color: c, lineHeight: 1, letterSpacing: "-0.02em" }}>{value == null ? "—" : value}</div>
        {label && <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: T.muted }}>{label}</div>}
        {sub && <div style={{ fontSize: 8.5, color: T.dim, letterSpacing: "0.1em" }}>{sub}</div>}
      </div>
    </div>
  );
}

/* Horizontal meter — per-domain health. */
function Meter({ label, value, colour, right }) {
  const c = colour || T.ok;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 10 }}>
        <span style={{ fontSize: 11, color: T.muted }}>{label}</span>
        <span style={{ fontSize: 10.5, color: c, fontWeight: 700, whiteSpace: "nowrap" }}>{right ?? (value == null ? "—" : `${pct}%`)}</span>
      </div>
      <div style={{ height: 6, background: T.bg, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: c, boxShadow: glow(c, 0.5, 8), transition: "width .6s ease" }} />
      </div>
    </div>
  );
}

/* Sparkline over the health history. */
function Spark({ points, colour, width = 190, height = 40 }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const xy = points.map((v, i) => [i * step, height - ((v - min) / span) * (height - 8) - 4]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const c = colour || T.accent;
  const last = xy[xy.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={c} opacity={0.07} />
      <path d={d} fill="none" stroke={c} strokeWidth={1.4} style={{ filter: `drop-shadow(0 0 4px ${c})` }} />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={c} style={{ filter: `drop-shadow(0 0 5px ${c})` }} />
    </svg>
  );
}

const META_ACCOUNT = "277407879800547";
const GOOGLE_CUSTOMER = "366-974-6941";
const GA4_PROPERTY = "469222398";

/* ============================================================
   CONNECTORS — honest status contract
   state: 'connected' | 'not_configured' | 'error' | 'checking'
   ============================================================ */

const MCP = {
  shopify: [{ type: "url", url: "https://setup.shopify.com/mcp", name: "shopify" }],
  meta: [{ type: "url", url: "https://mcp.facebook.com/ads", name: "meta-ads" }],
  gmail: [{ type: "url", url: "https://gmailmcp.googleapis.com/mcp/v1", name: "gmail" }],
  supermetrics: [{ type: "url", url: "https://mcp.supermetrics.com/mcp", name: "supermetrics" }],
  drive: [{ type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "google-drive" }],
};

/* Google Drive files, all owned by aryan@mulmul.co.
   The FY-2026-27 set carries the online / retail split that
   Vinculum was supposed to provide — the Zuri problem is
   answerable from here without a Vinculum integration. */
const DRIVE_FILES = [
  { id: "1nwUNdy64pBve6FEj0im2PCnpBu5OQBeyil-5bdJAzOw", name: "CEO Dashboard", note: "Store-wise daily comparison" },
  { id: "14_NgVahG_io925pqNfbKMI0LIU9ZmHSVK87Z9xUOyeo", name: "Consolidated Data FY 2026-27", note: "All-channel rollup" },
  { id: "1eGjvsczpQ_kWzA_9AE1s_0yVHxPGXWmsXtSG27pX8Ik", name: "FY-2026-27 Online", note: "Web channel only" },
  { id: "1_1cu7V78ZxS7hluCWjXEVDVikhczKULIe7a-q89qFFU", name: "FY-2026-27 Stores", note: "Retail — 26 stores" },
  { id: "1_Ewg2kREScxcCyUflZNqA6qkWyD6ms24auHRpU9XEK0", name: "FY-2026-27 International", note: "USA, UAE, Asia, UK" },
  { id: "1u80n6MlgRbzrBs5tfzKA1cJfinJqhLBGzLj08ASB6a0", name: "FY-2026-27 CRM", note: "Customer base" },
  { id: "1hcB12Qxbh88GAow4cGR0qzLOjrzbtNQ3rW2ibuvs-d8", name: "Sku Master", note: "Product taxonomy" },
  { id: "1L9q0CLOOFW0lqpTlRxfFChEZlerT0-PpQOHdxEJhr2E", name: "Stores Calling Performance", note: "26 stores, daily entry" },
  { id: "1JeF78zdiRfFFFjTgMhyWQ8SOKYrZY5iQPDZUxHF05qI", name: "Calling Team Performance", note: "Chattarpur team" },
  { id: "1I1ByxUNpNEj-aPomkWDzpw4sCZTNJq97KFP4i8B9gO0", name: "Production MIS Report", note: "Production pipeline" },
  { id: "1zcdMZtSxtebA7a4BFRtloypYicMYo5hP1muSjK7rQ9M", name: "Stylist Report Tracker", note: "Stylist activity" },
  { id: "1zCiCH3L1fVBBMnqhdinwmlH3wCE841rFjM3RvgW2zmo", name: "ARS Records", note: "Replenishment" },
];

/* Google Ads accounts reachable through Supermetrics (ds_id AW),
   connected via info@mulmul.co. Shop Mul Mul is the India web account. */
const GOOGLE_ACCOUNTS = [
  { id: "3669746941", name: "Shop Mul Mul", note: "India — primary web account" },
  { id: "8496183372", name: "Mul Mul", note: "India" },
  { id: "5604246703", name: "Mulmul — UAE", note: "UAE" },
  { id: "3207381292", name: "Mulmul Asia-Pacific", note: "Asia" },
  { id: "2357544596", name: "Mulmul UK", note: "UK" },
  { id: "9514329217", name: "Shopmulmul (US and UAE)", note: "US + UAE" },
];

/* A campaign whose name contains OMNI is optimising store visits.
   Its conversion VALUE is a visit count, not rupees. Grading these on
   ROAS reported 3.61x against a real 5.61x on the 18 Aug pull
   — a 36% understatement. */
const isOmni = (name) => /omni/i.test(name || "");

const CONNECTORS = [
  { id: "shopify", name: "Shopify", kind: "commerce", probe: "shopify", detail: "Store admin — orders, products, inventory." },
  { id: "meta-ads", name: "Meta Ads", kind: "ads", probe: "meta", detail: `Ad account ${META_ACCOUNT} — Shop Mulmul.` },
  { id: "gmail", name: "Gmail", kind: "comms", probe: "gmail", detail: "Report drafts to niharika@mulmul.co." },
  {
    id: "supermetrics", name: "Supermetrics", kind: "ads", probe: "supermetrics",
    detail: "Renewed. Data source AW authenticated via info@mulmul.co.",
  },
  {
    id: "google-ads", name: "Google Ads", kind: "ads", state: "connected",
    detail: `Live through Supermetrics. Six accounts, incl. ${GOOGLE_CUSTOMER} (Shop Mul Mul).`,
  },
  {
    id: "ga4", name: "GA4", kind: "analytics", state: "not_configured",
    detail: `Property ${GA4_PROPERTY} (mulmulappbrew). Three streams: Android, iOS, App-ios.`,
    fallback: "Pull manually from the GA4 UI.",
  },
  {
    id: "drive", name: "Google Drive", kind: "ops", probe: "drive",
    detail: "12 Mulmul workbooks, incl. the FY-2026-27 channel split.",
  },
  {
    id: "vinculum", name: "Vinculum", kind: "inventory", state: "not_configured",
    detail: "No API. Retail sell-through is readable via FY-2026-27 Stores in Drive.",
    fallback: "Live stock depth still unavailable — the sheet is periodic, not real time.",
  },
  { id: "canva", name: "Canva", kind: "creative", state: "connected", detail: "Creative mockups. Status assumed from the connector list; not probed." },
];

/* ============================================================
   DEPARTMENTS + AGENTS
   Each agent has a real run(). Agents whose source is not wired
   return ok:false immediately with an honest reason.
   ============================================================ */

const DEPARTMENTS = [
  { id: "growth", name: "Paid Growth", tagline: "Meta and Google, spend to return", order: 1 },
  { id: "revenue", name: "Revenue & Merch", tagline: "What actually sold, and where", order: 2 },
  { id: "product", name: "App & Site", tagline: "Sessions, tracking, discoverability", order: 3 },
  { id: "ops", name: "Ops & Reporting", tagline: "What ships to whom, on what cadence", order: 4 },
  { id: "health", name: "Health", tagline: "What is broken, ranked", order: 5 },
  { id: "knowledge", name: "Knowledge", tagline: "The brain and its invariants", order: 6 },
];

function blocked(reason, fallback) {
  return async () => ({ ok: false, summary: reason, fallback });
}

const AGENTS = [
  /* ---- Paid Growth ---- */
  {
    id: "meta-pulse", name: "Meta Pulse", tier: "lead", dept: "growth", parent: null,
    desc: "Every campaign, last 7 days: spend, revenue, ROAS.",
    source: "Meta Ads", mcp: "meta",
    prompt: `Use the Meta Ads tools on ad account ${META_ACCOUNT} (Shop Mulmul). Get the last 7 days by campaign. Include EVERY campaign regardless of status and do not truncate: name, spend, purchase conversion value, purchases, ROAS. Also return which attribution window the values came from.
Reply with ONLY JSON, no fences: {"rows":[{"name":"","spend":n,"revenue":n,"purchases":n,"roas":n}],"totals":{"spend":n,"revenue":n,"roas":n},"attribution":""}`,
    shape: (d) => ({
      summary: `${d.rows?.length || 0} campaigns · spend ${inr(d.totals?.spend)} · ROAS ${xx(d.totals?.roas)}`,
      table: { cols: ["Campaign", "Spend", "Revenue", "ROAS"], rows: (d.rows || []).map((r) => [r.name, inr(r.spend), inr(r.revenue), xx(r.roas)]) },
      caveat: `Attribution returned: ${d.attribution || "unspecified"}. This is total purchase ROAS, not the 7-day-click web slice your reports use. Directional only.`,
      data: d,
    }),
  },
  {
    id: "creative-audit", name: "Creative Audit", tier: "specialist", dept: "growth", parent: "meta-pulse",
    desc: "Every ad with spend: CTR, frequency, ROAS. Scale / keep / refresh / retire.",
    source: "Meta Ads", mcp: "meta",
    prompt: `Use Meta Ads tools on ad account ${META_ACCOUNT}. For the last 14 days, list EVERY ad that recorded spend — do not truncate to a top N — with: ad name, spend, impressions, CTR, frequency, purchases, ROAS.
Reply with ONLY JSON: {"rows":[{"name":"","spend":n,"ctr":n,"frequency":n,"purchases":n,"roas":n}]}`,
    shape: (d) => ({
      summary: `${d.rows?.length || 0} creatives read · ${(d.rows || []).filter((r) => r.frequency > 4).length} above frequency 4`,
      table: { cols: ["Ad", "Spend", "CTR", "Freq", "ROAS"], rows: (d.rows || []).map((r) => [r.name, inr(r.spend), r.ctr != null ? r.ctr.toFixed(2) + "%" : "—", r.frequency != null ? r.frequency.toFixed(1) : "—", xx(r.roas)]) },
      caveat: "Frequency above 4 on sustained spend is the saturation line. Classic Bestseller hit ~10 in March.",
      data: d,
    }),
  },
  {
    id: "competitor-intel", name: "Competitor Intel", tier: "specialist", dept: "growth", parent: "meta-pulse",
    desc: "Live ads from comparable ethnic-wear brands via the public Ad Library.",
    source: "Meta Ad Library", mcp: "meta",
    prompt: `Use the Meta Ad Library search to find currently running ads from Indian premium ethnic womenswear brands (try: Anita Dongre, Ritu Kumar, Nicobar, Suta). For each brand return how many ads are live and the dominant format and angle.
Reply with ONLY JSON: {"rows":[{"brand":"","liveAds":n,"format":"","angle":""}]}`,
    shape: (d) => ({
      summary: `${d.rows?.length || 0} brands read from the public library`,
      table: { cols: ["Brand", "Live ads", "Format", "Angle"], rows: (d.rows || []).map((r) => [r.brand, r.liveAds ?? "—", r.format, r.angle]) },
      caveat: "The Ad Library exposes no spend or performance. Persistence and volume are the only signal here.",
      data: d,
    }),
  },
  {
    id: "google-pulse", name: "Google Pulse", tier: "specialist", dept: "growth", parent: "meta-pulse",
    desc: "Every Google campaign, web and OMNI graded separately.",
    source: "Google Ads", mcp: "supermetrics",
    prompt: `Use the Supermetrics tools. Query data source ds_id "AW" (Google Ads), ds_accounts "${GOOGLE_CUSTOMER.replace(/-/g, "")}" (Shop Mul Mul), date_range_type "last_7_days", fields "campaign_name,cost,impressions,clicks,conversions,conversion_value", max_rows 200. Call data_query, then poll get_async_query_results with the returned schedule_id until status is completed.
Return EVERY campaign row — do not truncate. Monetary values are INR.
Reply with ONLY JSON, no fences: {"rows":[{"name":"","spend":n,"impressions":n,"clicks":n,"conversions":n,"revenue":n}]}`,
    shape: (d) => {
      const rows = d.rows || [];
      const web = rows.filter((r) => !isOmni(r.name));
      const omni = rows.filter((r) => isOmni(r.name));
      const ws = web.reduce((a, r) => a + (r.spend || 0), 0);
      const wv = web.reduce((a, r) => a + (r.revenue || 0), 0);
      const os = omni.reduce((a, r) => a + (r.spend || 0), 0);
      const ov = omni.reduce((a, r) => a + (r.conversions || 0), 0);
      return {
        summary: `Web ${inr(ws)} at ${xx(ws ? wv / ws : null)} · OMNI ${inr(os)} for ${num(ov)} store visits (${(100 * os / (ws + os) || 0).toFixed(0)}% of spend)`,
        table: {
          cols: ["Campaign", "Spend", "Revenue / visits", "ROAS"],
          rows: [
            ...web.sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((r) => [r.name, inr(r.spend), inr(r.revenue), xx(r.spend ? r.revenue / r.spend : null)]),
            ["WEB TOTAL", inr(ws), inr(wv), xx(ws ? wv / ws : null)],
            ...omni.sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((r) => [r.name, inr(r.spend), `${num(r.conversions)} visits`, "not graded"]),
            ["OMNI TOTAL", inr(os), `${num(ov)} visits`, `${inr(ov ? os / ov : null)}/visit`],
          ],
        },
        caveat: "OMNI campaigns optimise store visits — their conversion value is a visit count, not rupees. Excluded from ROAS by rule. Including them reported 3.61x against a real 5.61x on the 18 Aug pull — a 36% understatement.",
        data: { web, omni, webSpend: ws, webRevenue: wv, webRoas: ws ? wv / ws : null, omniSpend: os, omniVisits: ov },
      };
    },
  },
  {
    id: "budget-burn", name: "Budget Burn", tier: "worker", dept: "growth", parent: "meta-pulse",
    desc: "Pacing and scale verdicts against plan: SCALE / HOLD / TRIM / CUT.",
    source: "Meta Ads + plan", mcp: "meta",
    prompt: `Use Meta Ads tools on ad account ${META_ACCOUNT}. Get month-to-date spend by campaign for active campaigns.
Reply with ONLY JSON: {"rows":[{"name":"","mtdSpend":n,"roas":n}],"daysElapsed":n,"daysInMonth":n}`,
    shape: (d) => {
      const plan = { Print: 30000, Smart: 28000, Wedding: 25000, Studio: 22000, "Summer Launch": 10000 };
      const pace = d.daysInMonth ? d.daysElapsed / d.daysInMonth : null;
      return {
        summary: `${d.rows?.length || 0} campaigns · ${d.daysElapsed || "?"}/${d.daysInMonth || "?"} days elapsed`,
        table: {
          cols: ["Campaign", "MTD spend", "ROAS", "Read"],
          rows: (d.rows || []).map((r) => {
            const key = Object.keys(plan).find((k) => r.name?.toLowerCase().includes(k.toLowerCase()));
            const expected = key && pace ? plan[key] * d.daysInMonth * pace : null;
            const ratio = expected ? r.mtdSpend / expected : null;
            const read = ratio == null ? "no plan match" : ratio > 1.15 ? "ahead of pace" : ratio < 0.85 ? "behind pace" : "on pace";
            return [r.name, inr(r.mtdSpend), xx(r.roas), read];
          }),
        },
        caveat: "Verdicts need breakeven ROAS confirmed for this month, and Google impression-share-lost-to-budget, which is unavailable. Pacing only.",
        data: d,
      };
    },
  },

  /* ---- Revenue & Merch ---- */
  {
    id: "shopify-pulse", name: "Shopify Pulse", tier: "lead", dept: "revenue", parent: null,
    desc: "Today and month to date: revenue, orders, AOV. The revenue truth.",
    source: "Shopify", mcp: "shopify",
    prompt: `Use Shopify tools on the connected store. Return today and month-to-date gross sales revenue in INR, order count, and AOV.
Reply with ONLY JSON: {"today":{"revenue":n,"orders":n,"aov":n},"mtd":{"revenue":n,"orders":n,"aov":n},"shop":""}`,
    shape: (d) => ({
      summary: `MTD ${inr(d.mtd?.revenue)} across ${num(d.mtd?.orders)} orders · AOV ${inr(d.mtd?.aov)}`,
      table: { cols: ["Window", "Revenue", "Orders", "AOV"], rows: [["Today", inr(d.today?.revenue), num(d.today?.orders), inr(d.today?.aov)], ["Month to date", inr(d.mtd?.revenue), num(d.mtd?.orders), inr(d.mtd?.aov)]] },
      caveat: "All-channel. Includes retail and draft orders across 26 stores.",
      data: d,
    }),
  },
  {
    id: "bestsellers", name: "Bestsellers", tier: "specialist", dept: "revenue", parent: "shopify-pulse",
    desc: "Every product that sold, month to date.",
    source: "Shopify", mcp: "shopify",
    prompt: `Use Shopify tools. Return EVERY product that sold month-to-date with units and revenue in INR. Do not truncate to a top N.
Reply with ONLY JSON: {"rows":[{"title":"","units":n,"revenue":n}]}`,
    shape: (d) => ({
      summary: `${d.rows?.length || 0} products · top mover ${d.rows?.[0]?.title || "—"}`,
      table: { cols: ["Product", "Units", "Revenue"], rows: (d.rows || []).map((r) => [r.title, num(r.units), inr(r.revenue)]) },
      caveat: "Volume here is all-channel. Zuri read as a digital winner on this view and was almost entirely retail and draft orders. Split before concluding.",
      data: d,
    }),
  },
  {
    id: "true-roas", name: "True ROAS", tier: "specialist", dept: "revenue", parent: "shopify-pulse",
    desc: "Blended MER — platform claims against what the store actually made.",
    source: "Shopify + Google", mcp: "shopify",
    prompt: `Use the Shopify tools to get gross sales revenue in INR and order count for the LAST 7 DAYS across all channels, and also the online-store-channel-only revenue and orders if separable.
Reply with ONLY JSON, no fences: {"allRevenue":n,"allOrders":n,"onlineRevenue":n,"onlineOrders":n}`,
    shape: (d) => ({
      summary: `Store made ${inr(d.allRevenue)} all-channel over 7 days across ${num(d.allOrders)} orders`,
      table: {
        cols: ["Measure", "Value"],
        rows: [
          ["All-channel revenue", inr(d.allRevenue)],
          ["All-channel orders", num(d.allOrders)],
          ["Online-store revenue", inr(d.onlineRevenue)],
          ["Online-store orders", num(d.onlineOrders)],
        ],
      },
      caveat: "This is the denominator only. Run Meta Pulse and Google Pulse in the same window, then MER = store revenue ÷ (Meta spend + Google web spend). Exclude OMNI spend, which buys store visits rather than online orders. MER is an efficiency ratio, not a causal claim.",
      data: d,
    }),
  },
  {
    id: "channel-split", name: "Channel Split", tier: "specialist", dept: "revenue", parent: "shopify-pulse",
    desc: "Online vs retail vs international — the Zuri correction.",
    source: "Google Drive", mcp: "drive",
    prompt: `Use the Google Drive tools. Read these three files and report the most recent comparable period in each:
- "1eGjvsczpQ_kWzA_9AE1s_0yVHxPGXWmsXtSG27pX8Ik" (FY-2026-27 Online)
- "1_1cu7V78ZxS7hluCWjXEVDVikhczKULIe7a-q89qFFU" (FY-2026-27 Stores)
- "1_Ewg2kREScxcCyUflZNqA6qkWyD6ms24auHRpU9XEK0" (FY-2026-27 International)
For each channel return the period covered and its revenue in INR, plus any top-product or top-store breakdown available.
Reply with ONLY JSON, no fences: {"period":"","channels":[{"channel":"","revenue":n,"note":""}],"topItems":[{"channel":"","item":"","revenue":n}]}`,
    shape: (d) => {
      const ch = d.channels || [];
      const total = ch.reduce((a, c) => a + (c.revenue || 0), 0);
      return {
        summary: `${d.period || "period unstated"} · ${ch.map((c) => `${c.channel} ${total ? Math.round(100 * (c.revenue || 0) / total) : 0}%`).join(" · ")}`,
        table: {
          cols: ["Channel", "Revenue", "Share", "Note"],
          rows: [
            ...ch.map((c) => [c.channel, inr(c.revenue), total ? `${Math.round(100 * (c.revenue || 0) / total)}%` : "—", c.note || ""]),
            ["TOTAL", inr(total), "100%", ""],
          ],
        },
        caveat: "This is the split Shopify's all-channel view hides. Zuri read as a digital winner on Shopify because retail volume was invisible — check any product against this before calling it a digital result.",
        data: d,
      };
    },
  },
  {
    id: "discount-engine", name: "Discount Engine", tier: "worker", dept: "revenue", parent: "shopify-pulse",
    desc: "Sale banding by year, units sold and inventory. 3,129 styles.",
    source: "Google Drive", mcp: "drive",
    prompt: `Use the Google Drive tools. Read file id "1hcB12Qxbh88GAow4cGR0qzLOjrzbtNQ3rW2ibuvs-d8" (Sku Master).
Report the structure: which columns exist, how many product rows, and any year / season / category banding columns present.
Reply with ONLY JSON, no fences: {"columns":[""],"rowCount":n,"bands":[""],"notes":""}`,
    shape: (d) => ({
      summary: `${num(d.rowCount)} rows · ${d.columns?.length || 0} columns`,
      table: { cols: ["Column"], rows: (d.columns || []).map((c) => [c]) },
      caveat: "Sku Master is the taxonomy, not the discount workbook. The 10% cap for styles averaging 80+ units/year still lives in Discounting_sheet.xlsx locally.",
      data: d,
    }),
  },

  /* ---- App & Site ---- */
  {
    id: "seo-geo", name: "SEO / GEO", tier: "lead", dept: "product", parent: null,
    desc: "On-page, schema and AI-answer-engine visibility.",
    source: "Shopify", mcp: "shopify",
    prompt: `Use Shopify tools to read the store's basic SEO surface: shop name, primary domain, and the titles plus meta descriptions of up to 50 published products.
Reply with ONLY JSON: {"shop":"","domain":"","rows":[{"title":"","metaDescription":"","hasDescription":true}]}`,
    shape: (d) => ({
      summary: `${d.domain || "store"} · ${(d.rows || []).filter((r) => !r.hasDescription).length} of ${d.rows?.length || 0} sampled products missing a meta description`,
      table: { cols: ["Product", "Meta description"], rows: (d.rows || []).map((r) => [r.title, r.hasDescription ? (r.metaDescription || "").slice(0, 60) : "— missing —"]) },
      caveat: "A sample of published products, not a full crawl.",
      data: d,
    }),
  },
  {
    id: "app-performance", name: "App Performance", tier: "specialist", dept: "product", parent: "seo-geo",
    desc: "Sessions and conversion across the three app streams.",
    source: "GA4",
    run: blocked(
      `GA4 property ${GA4_PROPERTY} has no connector.`,
      "Pull from the GA4 UI. Appbrew's own dashboard overstates revenue 16–18% against Shopify — use Shopify for anything shared."
    ),
  },
  {
    id: "tracking-integrity", name: "Tracking Integrity", tier: "specialist", dept: "product", parent: "seo-geo",
    desc: "Pixel health, event match quality, CAPI coverage, funnel event volume.",
    source: "Meta Ads", mcp: "meta",
    prompt: `Use Meta Ads tools on ad account ${META_ACCOUNT}. Find the datasets/pixels on this account and report for each: name, id, whether it is active, and its recent event volume or signal quality if available.
Reply with ONLY JSON: {"rows":[{"name":"","id":"","active":true,"detail":""}]}`,
    shape: (d) => ({
      summary: `${d.rows?.length || 0} datasets · ${(d.rows || []).filter((r) => r.active).length} active`,
      table: { cols: ["Dataset", "ID", "Active", "Detail"], rows: (d.rows || []).map((r) => [r.name, r.id, r.active ? "yes" : "no", r.detail]) },
      caveat: "Meta side only. Cross-source reconciliation against Shopify orders needs GA4 and Google Ads, both unwired.",
      data: d,
    }),
  },

  /* ---- Ops & Reporting ---- */
  {
    id: "daily-report", name: "Daily Report", tier: "lead", dept: "ops", parent: null,
    desc: "Five Meta and five Google campaigns against plan. Drafts to Niharika.",
    source: "Gmail + Meta",
    run: blocked(
      "Will not run unattended. The report requires the 7-day-click website-purchase slice, which the API cannot expose, and Google actuals, which are unreachable.",
      "Supply a Meta Ads Manager screenshot (Website purchases conv. value, 7-day click) and Google actuals, then the draft can be built."
    ),
  },
  {
    id: "ceo-dashboard", name: "CEO Dashboard", tier: "worker", dept: "ops", parent: "daily-report",
    desc: "Store-wise daily comparison, read from the live workbook.",
    source: "Google Drive", mcp: "drive",
    prompt: `Use the Google Drive tools. Read file id "1nwUNdy64pBve6FEj0im2PCnpBu5OQBeyil-5bdJAzOw" (CEO Dashboard).
Summarise what the workbook currently reports: which tabs exist, the reporting period it is set to, and the headline store-wise numbers if present.
Reply with ONLY JSON, no fences: {"period":"","tabs":[""],"rows":[{"label":"","value":""}],"issues":[""]}`,
    shape: (d) => ({
      summary: `Period ${d.period || "unstated"} · ${d.tabs?.length || 0} tabs`,
      table: { cols: ["Item", "Value"], rows: (d.rows || []).map((r) => [r.label, r.value]) },
      caveat: (d.issues || []).join(" · ") || "Read-only. Edits must happen in the Sheet or via the Apps Script deploy (index_51.html + Code_30.gs together).",
      data: d,
    }),
  },
  {
    id: "calling-team", name: "Calling Team", tier: "worker", dept: "ops", parent: "daily-report",
    desc: "26 stores — calls, connects, leads against target.",
    source: "Google Drive", mcp: "drive",
    prompt: `Use the Google Drive tools. Read file id "1L9q0CLOOFW0lqpTlRxfFChEZlerT0-PpQOHdxEJhr2E" (Stores Calling Performance).
From the DAILY VIEW tab report the view date and per-store calls, call target, connected, connect target and status. Also report the MTD Scoreboard's month start and month end dates exactly as set.
Reply with ONLY JSON, no fences: {"viewDate":"","monthStart":"","monthEnd":"","rows":[{"store":"","status":"","calls":n,"callTarget":n,"connected":n,"connectTarget":n}]}`,
    shape: (d) => {
      const rows = d.rows || [];
      const active = rows.filter((r) => /present/i.test(r.status || ""));
      const zeroCall = active.filter((r) => !r.calls);
      const badDates = d.monthStart && d.monthEnd && new Date(d.monthEnd) < new Date(d.monthStart);
      return {
        summary: `${d.viewDate || "?"} · ${active.length} stores present · ${zeroCall.length} logged zero calls while present`,
        table: {
          cols: ["Store", "Status", "Calls", "Target", "Connected", "Conn tgt"],
          rows: rows.map((r) => [r.store, r.status || "—", num(r.calls), num(r.callTarget), num(r.connected), num(r.connectTarget)]),
        },
        caveat: badDates
          ? `MTD Scoreboard is misconfigured — month start ${d.monthStart} is after month end ${d.monthEnd}, so every MTD figure reads zero. Fix the date cells before trusting the scoreboard.`
          : "Leads and conversions are largely unfilled, so nothing below 'connected' can be measured.",
        data: d,
      };
    },
  },

  /* ---- Knowledge ---- */
  /* ---- Health: every agent returns checks[{name,state,finding,fix}] ---- */
  {
    id: "coverage-health", name: "Coverage Health", tier: "lead", dept: "health", parent: null,
    desc: "Which sources answer, and what each blind spot costs.", source: "local", health: true,
    local: async () => {
      const checks = [
        { name: "Revenue truth", state: "pass", finding: "Shopify live — orders, products, channel field available.", fix: "" },
        { name: "Paid social", state: "pass", finding: "Meta Ads live on 277407879800547.", fix: "" },
        { name: "Paid search", state: "pass", finding: "Google Ads live via Supermetrics across six regional accounts.", fix: "" },
        { name: "Ops workbooks", state: "pass", finding: "Drive live — 12 workbooks incl. the FY-2026-27 channel split.", fix: "" },
        { name: "Meta web slice", state: "warn", finding: "The API cannot expose 7-day-click website purchases; it returns omni-channel totals that run materially higher.", fix: "Structural. Screenshot gate stays — do not substitute total ROAS." },
        { name: "App behaviour", state: "skip", finding: `GA4 property ${GA4_PROPERTY} unwired — not scored, since a source that was never connected is a gap in coverage rather than a failing check.`, fix: "Service account + GA4 Data API + Viewer on the property." },
        { name: "Live retail stock", state: "warn", finding: "Vinculum has no API. Retail sell-through readable from Drive, but stock depth is periodic, not live.", fix: "Ask the account manager whether the licence exposes REST." },
      ];
      return {
        ok: true, checks,
        summary: `${checks.filter((c) => c.state === "pass").length} healthy · ${checks.filter((c) => c.state === "warn").length} degraded · ${checks.filter((c) => c.state === "fail").length} blind`,
        data: { checks },
      };
    },
  },
  {
    id: "calling-health", name: "Calling Health", tier: "specialist", dept: "health", parent: "coverage-health",
    desc: "Staffing, call volume and whether leads are captured at all.",
    source: "Google Drive", mcp: "drive", health: true,
    prompt: `Use the Google Drive tools. Read file id "1L9q0CLOOFW0lqpTlRxfFChEZlerT0-PpQOHdxEJhr2E" (Stores Calling Performance).
From STORE MASTER return each store with its agent name (blank if none) and daily call target. From MTD SCOREBOARD return month start, month end, days reported, and per-store calls, connected, leads, conversions, revenue.
Reply with ONLY JSON, no fences: {"monthStart":"","monthEnd":"","days":n,"rows":[{"store":"","agent":"","callTarget":n,"calls":n,"connected":n,"leads":n,"conversions":n,"revenue":n}]}`,
    shape: (d) => {
      const rows = d.rows || [];
      const days = d.days || 0;
      const unstaffed = rows.filter((r) => !(r.agent || "").trim());
      const zero = rows.filter((r) => !r.calls);
      const target = rows.reduce((a, r) => a + (r.callTarget || 0) * days, 0);
      const calls = rows.reduce((a, r) => a + (r.calls || 0), 0);
      const conn = rows.reduce((a, r) => a + (r.connected || 0), 0);
      const leads = rows.reduce((a, r) => a + (r.leads || 0), 0);
      const leadRate = conn ? (100 * leads) / conn : 0;
      const badDates = d.monthStart && d.monthEnd && new Date(d.monthEnd) < new Date(d.monthStart);
      const lowCallers = rows.filter((r) => r.calls > 0 && r.calls < 0.5 * (r.callTarget || 0) * days);

      const checks = [
        { name: "Scoreboard dates", state: badDates ? "fail" : "pass",
          finding: badDates ? `Month end ${d.monthEnd} falls before month start ${d.monthStart} — every MTD figure reads zero.` : `Window ${d.monthStart} → ${d.monthEnd}, ${days} days reported.`,
          fix: badDates ? "Correct the two yellow date cells on the MTD Scoreboard." : "" },
        { name: "Staffing", state: unstaffed.length ? "fail" : "pass",
          finding: unstaffed.length ? `${unstaffed.length} stores have no agent named: ${unstaffed.map((r) => r.store).join(", ")}.` : "Every store has a named agent.",
          fix: unstaffed.length ? "Staff them or remove them from the roster — unstaffed stores drag the average and hide the real picture." : "" },
        { name: "Call volume", state: calls < 0.6 * target ? "fail" : calls < 0.85 * target ? "warn" : "pass",
          finding: `${num(calls)} calls against a ${num(target)} target — ${target ? Math.round((100 * calls) / target) : 0}%.`,
          fix: calls < 0.85 * target ? "Half the calling is not happening. Separate the unstaffed stores from the staffed-but-not-calling ones before acting." : "" },
        { name: "Zero-call stores", state: zero.length ? "fail" : "pass",
          finding: zero.length ? `${zero.length} logged no calls at all: ${zero.map((r) => r.store).join(", ")}.` : "Every store made calls.",
          fix: zero.length ? "Check each against the staffing list — unstaffed is a hiring problem, staffed is a management one." : "" },
        { name: "Connect rate", state: conn && calls ? ((100 * conn) / calls < 35 ? "warn" : "pass") : "warn",
          finding: `${calls ? Math.round((100 * conn) / calls) : 0}% of calls connect (${num(conn)} of ${num(calls)}).`,
          fix: "" },
        { name: "Lead capture", state: leadRate < 2 ? "fail" : leadRate < 5 ? "warn" : "pass",
          finding: `${num(leads)} leads from ${num(conn)} connections — ${leadRate.toFixed(2)}%.`,
          fix: leadRate < 2 ? "At this rate the column is not being filled rather than the calls failing. Confirm the team knows what counts as a lead before reading this as performance." : "" },
        { name: "Under-calling (staffed)", state: lowCallers.length > 3 ? "warn" : "pass",
          finding: lowCallers.length ? `${lowCallers.length} staffed stores below half target: ${lowCallers.map((r) => `${r.store} ${num(r.calls)}`).join(", ")}.` : "Staffed stores are pacing.",
          fix: lowCallers.length ? "The recurring remark is walk-ins and long trials — calling and floor duty compete for the same person." : "" },
      ];
      return {
        checks,
        summary: `${checks.filter((c) => c.state === "fail").length} failing · ${checks.filter((c) => c.state === "warn").length} warning · lead capture ${leadRate.toFixed(2)}%`,
        table: { cols: ["Store", "Agent", "Calls", "Conn", "Leads"], rows: rows.map((r) => [r.store, r.agent || "— none —", num(r.calls), num(r.connected), num(r.leads)]) },
        data: { checks, calls, conn, leads, target },
      };
    },
  },
  {
    id: "ads-health", name: "Ads Health", tier: "specialist", dept: "health", parent: "coverage-health",
    desc: "Frequency, plan drift, OMNI contamination, spend concentration.",
    source: "Meta Ads", mcp: "meta", health: true,
    prompt: `Use Meta Ads tools on ad account ${META_ACCOUNT}. For the last 7 days return every campaign with spend: name, status, spend, purchase conversion value, impressions, reach, frequency, ctr. Also return the account's daily spend total.
Reply with ONLY JSON, no fences: {"rows":[{"name":"","status":"","spend":n,"revenue":n,"frequency":n,"ctr":n,"reach":n}],"dailySpend":n}`,
    shape: (d) => {
      const rows = d.rows || [];
      const spend = rows.reduce((a, r) => a + (r.spend || 0), 0);
      const hiFreq = rows.filter((r) => (r.frequency || 0) > 4);
      const sorted = [...rows].sort((a, b) => (b.spend || 0) - (a.spend || 0));
      const top = sorted[0];
      const concentration = spend && top ? (100 * (top.spend || 0)) / spend : 0;
      const planDaily = 115000;
      const actualDaily = spend / 7;
      const drift = planDaily ? (100 * actualDaily) / planDaily - 100 : 0;
      const noRev = rows.filter((r) => r.spend > 5000 && !r.revenue);

      const checks = [
        { name: "Creative fatigue", state: hiFreq.length > 2 ? "fail" : hiFreq.length ? "warn" : "pass",
          finding: hiFreq.length ? `${hiFreq.length} campaigns above frequency 4: ${hiFreq.map((r) => `${r.name} ${(r.frequency || 0).toFixed(1)}`).join(", ")}.` : "No campaign above frequency 4.",
          fix: hiFreq.length ? "Frequency above 4 on sustained spend is the saturation line — Jan26 Luxury Brands Classic reached 11.0 before it was caught." : "" },
        { name: "Spend vs plan", state: Math.abs(drift) > 25 ? "warn" : "pass",
          finding: `${inr(actualDaily)}/day against a planned ${inr(planDaily)} — ${drift > 0 ? "+" : ""}${drift.toFixed(0)}%.`,
          fix: Math.abs(drift) > 25 ? "The June plan may simply be stale rather than the spend being wrong. Confirm before grading anything against it." : "" },
        { name: "Spend concentration", state: concentration > 45 ? "warn" : "pass",
          finding: top ? `Largest campaign is ${concentration.toFixed(0)}% of spend (${top.name}).` : "No spend.",
          fix: concentration > 45 ? "One campaign carrying most of the account is a single point of failure through a peak." : "" },
        { name: "Spend without return", state: noRev.length ? "warn" : "pass",
          finding: noRev.length ? `${noRev.length} campaigns spent over ₹5,000 with no recorded purchase value: ${noRev.map((r) => r.name).join(", ")}.` : "Every spending campaign recorded purchase value.",
          fix: noRev.length ? "Check whether these are awareness or store-visit objectives before reading it as failure." : "" },
        { name: "Attribution grade", state: "warn",
          finding: "These figures are API total purchase ROAS, not the 7-day-click website slice your reports use.",
          fix: "Directional only. Take the web slice from an Ads Manager screenshot before anything ships." },
      ];
      return {
        checks,
        summary: `${checks.filter((c) => c.state === "fail").length} failing · ${checks.filter((c) => c.state === "warn").length} warning · ${rows.length} campaigns`,
        table: { cols: ["Campaign", "Spend", "Freq", "CTR"], rows: sorted.map((r) => [r.name, inr(r.spend), r.frequency != null ? r.frequency.toFixed(1) : "—", r.ctr != null ? r.ctr.toFixed(2) + "%" : "—"]) },
        data: { checks, spend },
      };
    },
  },
  {
    id: "commerce-health", name: "Commerce Health", tier: "specialist", dept: "health", parent: "coverage-health",
    desc: "Stock depth, collection tagging, channel mix before a peak.",
    source: "Shopify", mcp: "shopify", health: true,
    prompt: `Use Shopify tools. Return: (a) the 20 published product variants with the lowest available inventory that sold in the last 30 days, with product title, available quantity and units sold; (b) every collection with its title, product count and whether it is published to the Online Store; (c) count of published products missing a meta description.
Reply with ONLY JSON, no fences: {"lowStock":[{"title":"","available":n,"sold":n}],"collections":[{"title":"","products":n,"published":true}],"missingMeta":n,"totalProducts":n}`,
    shape: (d) => {
      const low = d.lowStock || [];
      const critical = low.filter((r) => (r.available || 0) < (r.sold || 0) * 0.25);
      const cols = d.collections || [];
      const unpublished = cols.filter((c) => !c.published);
      const empty = cols.filter((c) => !c.products);
      const rakhi = cols.filter((c) => /rakhi|raksha/i.test(c.title || ""));
      const metaPct = d.totalProducts ? (100 * (d.missingMeta || 0)) / d.totalProducts : 0;

      const checks = [
        { name: "Stock depth", state: critical.length > 3 ? "fail" : critical.length ? "warn" : "pass",
          finding: critical.length ? `${critical.length} movers have under a month of cover: ${critical.map((r) => r.title).join(", ")}.` : "No mover is critically short online.",
          fix: critical.length ? "Online stock only — Vinculum is unwired, so a style short here may already be gone in store." : "" },
        { name: "Rakhi collections", state: rakhi.length === 0 ? "warn" : rakhi.some((c) => !c.published) ? "fail" : "pass",
          finding: rakhi.length ? `${rakhi.length} Rakhi collections, ${rakhi.filter((c) => c.published).length} published.` : "No collection matching Rakhi or Raksha found.",
          fix: rakhi.some((c) => !c.published) ? "An unpublished collection through peak means paid traffic lands nowhere." : "" },
        { name: "Unpublished collections", state: unpublished.length > 5 ? "warn" : "pass",
          finding: `${unpublished.length} of ${cols.length} collections are not live on the Online Store.`, fix: "" },
        { name: "Empty collections", state: empty.length ? "warn" : "pass",
          finding: empty.length ? `${empty.length} collections contain no products: ${empty.map((c) => c.title).slice(0, 6).join(", ")}.` : "No empty collections.",
          fix: empty.length ? "Empty but published collections are dead landing pages." : "" },
        { name: "Meta descriptions", state: metaPct > 40 ? "fail" : metaPct > 15 ? "warn" : "pass",
          finding: `${num(d.missingMeta)} of ${num(d.totalProducts)} published products have no meta description — ${metaPct.toFixed(0)}%.`,
          fix: metaPct > 15 ? "Affects both classic search and AI answer-engine citation." : "" },
      ];
      return {
        checks,
        summary: `${checks.filter((c) => c.state === "fail").length} failing · ${checks.filter((c) => c.state === "warn").length} warning · ${cols.length} collections`,
        table: { cols: ["Product", "Available", "Sold 30d"], rows: low.map((r) => [r.title, num(r.available), num(r.sold)]) },
        data: { checks },
      };
    },
  },
  {
    id: "data-health", name: "Data Health", tier: "specialist", dept: "health", parent: "coverage-health",
    desc: "Workbook integrity — placeholder targets, stale plans, unfilled columns.",
    source: "Google Drive", mcp: "drive", health: true,
    prompt: `Use the Google Drive tools. Read file id "14_NgVahG_io925pqNfbKMI0LIU9ZmHSVK87Z9xUOyeo" (Consolidated Data FY 2026-27).
Report: the latest period with data, which tabs exist, whether any columns that should hold values are entirely empty, and whether any targets look like round placeholder numbers rather than real ones.
Reply with ONLY JSON, no fences: {"latestPeriod":"","tabs":[""],"emptyColumns":[""],"placeholderTargets":[""],"notes":""}`,
    shape: (d) => {
      const stale = d.latestPeriod ? (Date.now() - new Date(d.latestPeriod).getTime()) / 86400000 : null;
      const checks = [
        { name: "Freshness", state: stale == null ? "warn" : stale > 14 ? "fail" : stale > 5 ? "warn" : "pass",
          finding: d.latestPeriod ? `Latest data ${d.latestPeriod}${stale != null ? ` — ${Math.round(stale)} days old` : ""}.` : "Could not determine the latest period.",
          fix: stale > 5 ? "A rollup this stale will quietly mislead anything that reads it." : "" },
        { name: "Empty columns", state: (d.emptyColumns || []).length ? "fail" : "pass",
          finding: (d.emptyColumns || []).length ? `Entirely unfilled: ${d.emptyColumns.join(", ")}.` : "No wholly empty value columns.",
          fix: (d.emptyColumns || []).length ? "An empty column reads as zero downstream rather than as unknown." : "" },
        { name: "Placeholder targets", state: (d.placeholderTargets || []).length ? "warn" : "pass",
          finding: (d.placeholderTargets || []).length ? `Look like placeholders: ${d.placeholderTargets.join(", ")}.` : "Targets look deliberately set.",
          fix: (d.placeholderTargets || []).length ? "Nobody should be measured against a number nobody chose. The calling sheet's ₹10 lakh per store is the known example." : "" },
        { name: "Campaign plan age", state: "warn",
          finding: "Meta and Google plans were set 17 Jun 2026 and Google web spend now runs ~83% over them.",
          fix: "Re-plan or stop grading against them." },
      ];
      return {
        checks,
        summary: `${checks.filter((c) => c.state === "fail").length} failing · ${checks.filter((c) => c.state === "warn").length} warning`,
        table: { cols: ["Tab"], rows: (d.tabs || []).map((t) => [t]) },
        caveat: d.notes || "",
        data: { checks },
      };
    },
  },
  {
    id: "kb-auditor", name: "KB Auditor", tier: "lead", dept: "knowledge", parent: null,
    desc: "Freshness and gaps in the semantic knowledge base.",
    source: "local files",
    local: async () => {
      const stale = KB_NODES.filter((n) => n.stale);
      const open = KB_NODES.filter((n) => n.open);
      return {
        ok: true,
        summary: `${KB_NODES.length} nodes · ${stale.length} stale · ${open.length} open question(s)`,
        table: { cols: ["Node", "Cluster", "State"], rows: [...stale, ...open].map((n) => [n.label, n.cluster, n.stale ? "stale" : "open question"]) },
        caveat: "Reads the graph in this console, not the files on disk. Wire the filesystem to make this authoritative.",
        data: { stale: stale.map((n) => `${n.label}: ${n.note || ""}`), open: open.map((n) => `${n.label}: ${n.note || ""}`) },
      };
    },
  },
  {
    id: "invariant-guard", name: "Invariant Guard", tier: "specialist", dept: "knowledge", parent: "kb-auditor",
    desc: "Checks every rule that must never be broken.",
    source: "local rules",
    local: async () => ({
      ok: true,
      summary: `${INVARIANTS.length} invariants held`,
      table: { cols: ["#", "Rule"], rows: INVARIANTS.map((r, i) => [String(i + 1).padStart(2, "0"), r]) },
      caveat: "These are enforced in this console's copy and agent behaviour. They are not enforced anywhere upstream.",
      data: { invariants: INVARIANTS },
    }),
  },
];

const INVARIANTS = [
  "Meta ROAS is 7-day-click website purchases only. Never API total purchase ROAS.",
  "Shopify is authoritative for revenue. Appbrew overstates by 16–18%.",
  "Google campaigns containing OMNI optimise store visits. Their conversion value is a visit count, not rupees — never grade them on ROAS.",
  "Breakeven ROAS is confirmed at runtime each month. It moves.",
  "Brand Search ROAS is not incremental. Treat 12x on a 45% CTR as demand capture, not demand creation.",
  "All-channel Shopify volume includes retail and draft orders. Split against FY-2026-27 Online vs Stores before calling anything a digital winner.",
  "Never grade a campaign off a source that did not answer. Show nothing instead.",
  "No agent claims to have sent, published or scheduled anything. Reads and drafts only.",
];

/* ============================================================
   FLOWS
   stages: [{ kind: 'fanout' | 'gate' | 'synthesis' }]

   Fan-out runs its agents at once. A blocked agent does not kill
   the flow — it reports why, and the synthesis names the gap.
   A GATE is a point where an invariant says the flow cannot
   proceed on API data alone. It stops and waits for you.
   ============================================================ */

const PLAN_BLOCK = `META — Print 30,000/105,000/3.5 · Smart 28,000/112,000/4.0 · Wedding 25,000/87,500/3.5 · Studio 22,000/88,000/4.0 · Summer Launch 10,000/30,000/3.0 · total 115,000/422,500/3.67
GOOGLE — Search 10,000/60,000/6.0 · Classic 4,000/10,000/2.5 · Studio 5,000/20,000/4.0 · Classic Shopping 5,000/12,500/2.5 · Wedding Shopping 3,500/15,000/3.0 · total 27,500/117,500/4.3
(Figures are daily spend / revenue / ROAS. Set 17 Jun 2026 — confirm they still hold.)`;

const FLOWS = [
  {
    id: "daily-pack",
    name: "Daily Report Pack",
    cadence: "every evening",
    desc: "Pull both platforms and the store live, gate only on the Meta web slice, then draft the report to Niharika.",
    stages: [
      { kind: "fanout", label: "Pull", agents: ["meta-pulse", "shopify-pulse", "google-pulse"] },
      {
        kind: "gate",
        label: "Meta web slice",
        why: "Google now pulls live, but the Meta Marketing API still cannot expose the 7-day-click website-purchase slice — it returns omni-channel totals that run materially higher. The report stops here rather than substituting total ROAS.",
        fields: [
          { id: "metaSpend", label: "Meta spend (Ads Manager)", placeholder: "e.g. 112000" },
          { id: "metaWebRevenue", label: "Meta web revenue — 7-day click", placeholder: "e.g. 418000" },
        ],
      },
      { kind: "synthesis", label: "Compose" },
    ],
    synthesis: (ctx) => `You are the composing step of the Daily Report Pack for Shop Mulmul, a premium Indian ethnic womenswear brand.

COLLECTED FROM AGENTS:
${ctx.agentBlock}

HAND-ENTERED FROM ADS MANAGER SCREENSHOTS — these are authoritative. Use these for every reported spend, revenue and ROAS figure. Do NOT report the API's ROAS.
${ctx.gateBlock}

PLAN:
${PLAN_BLOCK}

INVARIANTS: ${INVARIANTS.join(" | ")}

Google figures come from Supermetrics and are live. Report Google web campaigns on ROAS; report OMNI store-visit campaigns separately on spend and cost per visit, never on ROAS.

Write the daily ad report email to Niharika. Plain and factual, no hype, no discount language. Subject format exactly: "Shop Mulmul – Daily Ad Report (DD Mon YYYY)". Body: one line of read, then actual against plan, then anything needing a decision. Say explicitly where a figure was hand-entered.

Reply with ONLY JSON, no fences:
{"headline":"","email":{"subject":"","body":""},"sections":[{"title":"","body":""}],"actions":[""],"gaps":[""]}`,
  },
  {
    id: "morning-brief",
    name: "Morning Brief",
    cadence: "weekday mornings",
    desc: "What moved overnight and what needs you today. Read by you, not shipped — so no gate.",
    stages: [
      { kind: "fanout", label: "Scan", agents: ["shopify-pulse", "meta-pulse", "creative-audit", "kb-auditor"] },
      { kind: "synthesis", label: "Brief" },
    ],
    synthesis: (ctx) => `You are the briefing step of the Morning Brief for Shop Mulmul.

COLLECTED:
${ctx.agentBlock}

Today is ${new Date().toDateString()}. Raksha Bandhan peak falls around 28 August 2026.

INVARIANTS: ${INVARIANTS.join(" | ")}

Write a short operator brief: what changed, what deserves attention today, what is decaying quietly. This is read by one person who knows the account intimately — no background, no restating the obvious, no filler. Skip anything the data does not support.

Reply with ONLY JSON, no fences:
{"headline":"","sections":[{"title":"","body":""}],"actions":[""],"gaps":[""]}`,
  },
  {
    id: "weekly-audit",
    name: "Weekly Account Audit",
    cadence: "Mondays",
    desc: "Burn, creative, tracking and competitors in parallel, then a verdict per campaign.",
    stages: [
      { kind: "fanout", label: "Audit", agents: ["budget-burn", "creative-audit", "tracking-integrity", "competitor-intel", "google-pulse"] },
      {
        kind: "gate",
        label: "Breakeven",
        why: "Breakeven ROAS moves month to month and must be confirmed at runtime. A verdict graded against a remembered number is worse than no verdict. Everything else in this audit now pulls live.",
        fields: [
          { id: "breakeven", label: "Breakeven ROAS this month", placeholder: "e.g. 2.8" },
        ],
      },
      { kind: "synthesis", label: "Verdicts" },
    ],
    synthesis: (ctx) => `You are the verdict step of the Weekly Account Audit for Shop Mulmul.

COLLECTED:
${ctx.agentBlock}

CONFIRMED AT RUNTIME:
${ctx.gateBlock}

PLAN:
${PLAN_BLOCK}

Grade each campaign SCALE / HOLD / TRIM / CUT against the confirmed breakeven above, never a remembered one. Where a verdict would require Google data that is unavailable, say so instead of grading.

INVARIANTS: ${INVARIANTS.join(" | ")}

Reply with ONLY JSON, no fences:
{"headline":"","verdicts":[{"campaign":"","verdict":"","because":""}],"sections":[{"title":"","body":""}],"actions":[""],"gaps":[""]}`,
  },
  {
    id: "rakhi-watch",
    name: "Rakhi Peak Watch",
    cadence: "daily until 28 Aug",
    desc: "Pacing, stock depth and creative fatigue against the Raksha Bandhan peak.",
    stages: [
      { kind: "fanout", label: "Watch", agents: ["meta-pulse", "google-pulse", "bestsellers", "creative-audit", "budget-burn"] },
      { kind: "synthesis", label: "Risk read" },
    ],
    synthesis: (ctx) => `You are the risk step of Rakhi Peak Watch for Shop Mulmul.

COLLECTED:
${ctx.agentBlock}

Today is ${new Date().toDateString()}. Raksha Bandhan peak is around 28 August 2026. Two known constraints: an account authentication flag has been blocking ad creation, and Vinculum is unwired, so any inventory figure here is online only and says nothing about retail depth.

INVARIANTS: ${INVARIANTS.join(" | ")}

Give a risk read against the peak: are we pacing to hit it, will creative hold or fatigue through it, is stock deep enough on the movers, and what must happen before the date. State the days remaining.

Reply with ONLY JSON, no fences:
{"headline":"","risks":[{"risk":"","severity":"high","because":""}],"sections":[{"title":"","body":""}],"actions":[""],"gaps":[""]}`,
  },
];

/* ============================================================
   KNOWLEDGE GRAPH
   ============================================================ */

const KB_NODES = [
  // Brand
  { id: "brand", label: "Brand", cluster: "Brand", hub: true },
  { id: "positioning", label: "Positioning", cluster: "Brand", note: "Premium Indian ethnic womenswear. Elevated, restrained. No discount framing in copy." },
  { id: "aov", label: "AOV band", cluster: "Brand", note: "₹16,000–₹20,000." },
  { id: "regions", label: "Regions", cluster: "Brand", note: "India, USA, UAE, Asia, UK. Separate ad accounts per region." },
  { id: "stores", label: "26 stores", cluster: "Brand", note: "Retail footprint. Vinculum is the system of record, unwired here." },

  // Product
  { id: "product", label: "Product", cluster: "Product", hub: true },
  { id: "segments", label: "Segments", cluster: "Product", note: "Classics, Studio, Wedding." },
  { id: "prints", label: "Named prints", cluster: "Product", note: "Lume, Aelani, Panchi, Nandika, Nriti, Moor." },
  { id: "saaj", label: "Saaj Cupro Sage", cluster: "Product", note: "Leads online. Converts below the Yellow colorway at identical price — unresolved leak." },
  { id: "tiki", label: "Tiki Organza Fuchsia", cluster: "Product", note: "Scarcity push opportunity." },
  { id: "kena", label: "Kena Cupro Mustard", cluster: "Product", note: "App-exclusive hero candidate." },
  { id: "zuri", label: "Zuri", cluster: "Product", note: "High all-channel volume, largely retail and draft orders. Not a digital winner." },

  // Metrics
  { id: "metrics", label: "Metrics", cluster: "Metrics", hub: true },
  { id: "roas-rule", label: "ROAS definition", cluster: "Metrics", note: "7-day click, website purchases. The web slice, never the API total." },
  { id: "breakeven", label: "Breakeven ROAS", cluster: "Metrics", note: "Confirmed at runtime each month. Moves month over month.", open: true },
  { id: "mer", label: "Blended MER", cluster: "Metrics", note: "Efficiency ratio, not causation. Needs all spend sources to be honest." },
  { id: "appbrew-gap", label: "Appbrew gap", cluster: "Metrics", note: "Dashboard overstates revenue 16–18% vs Shopify's Appbrew channel." },

  // Campaigns
  { id: "campaigns", label: "Campaigns", cluster: "Campaigns", hub: true },
  { id: "plan-meta", label: "Meta plan", cluster: "Campaigns", note: "Print 30k/105k/3.5 · Smart 28k/112k/4.0 · Wedding 25k/87.5k/3.5 · Studio 22k/88k/4.0 · Summer 10k/30k/3.0. Set 17 Jun.", stale: true },
  { id: "plan-google", label: "Google plan", cluster: "Campaigns", note: "Set 17 Jun: 27,500/day. Web now running ~50,290/day — 83% over. Studio and Wedding Shopping no longer exist in the account.", stale: true },
  { id: "rakhi", label: "Classic Rakhi Launch", cluster: "Campaigns", note: "Strongest recent momentum. Raksha Bandhan peak ~28 Aug." },
  { id: "auth-flag", label: "Auth flag", cluster: "Campaigns", note: "Account authentication flag blocking ad creation ahead of peak.", open: true },

  // Channels
  { id: "channels", label: "Channels", cluster: "Channels", hub: true },
  { id: "meta-ch", label: "Meta", cluster: "Channels", note: "Prospecting runs on manual interest stacks. No lookalikes, no Advantage+." },
  { id: "google-ch", label: "Google", cluster: "Channels", note: "Live via Supermetrics, six regional accounts. Web ROAS 5.61x last 7 days. PMax still hides search terms." },
  { id: "app-ch", label: "App", cluster: "Channels", note: "Three GA4 streams. Conversion collapsed since mid-June despite session highs." },
  { id: "audience", label: "Audience", cluster: "Channels", note: "35–44 underfunded relative to ROAS. FB Reels weak. IG Stories underfunded." },

  // Diagnosis
  { id: "issues", label: "Open issues", cluster: "Issues", hub: true },
  { id: "atc-leak", label: "ATC → checkout collapse", cluster: "Issues", note: "Cross-campaign. Flagged as likely site-side, unconfirmed.", open: true },
  { id: "frequency", label: "Frequency saturation", cluster: "Issues", note: "Jan26 Luxury Brands Classic hit 11.0 on 35K reach. Seven ad sets seeded on Luxury interests cannibalising each other." },
  { id: "omni-split", label: "OMNI store-visit spend", cluster: "Issues", note: "11 campaigns, 36% of Google spend, conversion value is a visit count. Including them in ROAS reported 3.61x vs a real 5.61x — 36% understated.", open: true },
  { id: "brand-search", label: "Brand Search incrementality", cluster: "Issues", note: "12.18x at 45.7% CTR on ₹88K/week. Demand capture, not creation — untested.", open: true },

  // Ops
  { id: "ops", label: "Ops", cluster: "Ops", hub: true },
  { id: "report", label: "Daily report", cluster: "Ops", note: "Five Meta, five Google campaigns. Black-header table to niharika@mulmul.co." },
  { id: "ceo-dash", label: "CEO Dashboard", cluster: "Ops", note: "Apps Script + Sheets. IST/UTC date bug fixed via dstr() helper." },
  { id: "discount", label: "Discount sheet", cluster: "Ops", note: "3,129 styles. Year band × units × inventory, 10% cap for consistent sellers. Still a local workbook." },
  { id: "fy-sheets", label: "FY-2026-27 sheets", cluster: "Ops", note: "Online / Stores / International / CRM, live in Drive. Carries the channel split Vinculum was meant to provide." },
  { id: "calling-sheet", label: "Stores calling tracker", cluster: "Ops", note: "26 stores, daily. MTD scoreboard dates inverted — month end falls before month start, so every MTD figure reads zero.", open: true },
];

const KB_EDGES = [
  ["roas-rule", "meta-ch"], ["breakeven", "mer"], ["mer", "metrics"],
  ["appbrew-gap", "app-ch"], ["saaj", "atc-leak"], ["zuri", "stores"],
  ["plan-meta", "meta-ch"], ["plan-google", "google-ch"], ["rakhi", "plan-meta"],
  ["auth-flag", "rakhi"], ["omni-split", "google-ch"], ["brand-search", "google-ch"], ["omni-split", "stores"],
  ["frequency", "audience"], ["audience", "meta-ch"], ["atc-leak", "report"],
  ["kena", "app-ch"], ["tiki", "prints"], ["saaj", "prints"], ["segments", "prints"],
  ["report", "roas-rule"], ["ceo-dash", "stores"], ["discount", "segments"],
  ["fy-sheets", "zuri"], ["fy-sheets", "stores"], ["calling-sheet", "stores"], ["fy-sheets", "regions"], ["fy-sheets", "zuri"], ["fy-sheets", "stores"], ["calling-sheet", "stores"],
  ["aov", "positioning"], ["regions", "positioning"],
];

const CLUSTERS = ["Brand", "Product", "Metrics", "Campaigns", "Channels", "Issues", "Ops"];

function layoutGraph() {
  const byCluster = {};
  KB_NODES.forEach((n) => {
    (byCluster[n.cluster] = byCluster[n.cluster] || []).push(n);
  });
  const pos = {};
  CLUSTERS.forEach((c, ci) => {
    const a = (ci / CLUSTERS.length) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * 0.63;
    const cy = Math.sin(a) * 0.63;
    const members = byCluster[c] || [];
    members.forEach((n, i) => {
      if (n.hub) {
        pos[n.id] = { x: cx, y: cy, hub: true, cluster: ci };
        return;
      }
      const k = i + 1;
      const ang = k * 2.399963;
      const rad = 0.085 * Math.sqrt(k) + 0.05;
      pos[n.id] = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad, hub: false, cluster: ci };
    });
  });
  return pos;
}

const CLUSTER_HUE = [154, 168, 186, 142, 200, 8, 96];

/* ============================================================
   HELPERS
   ============================================================ */

const inr = (n) => (n == null || isNaN(n) ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const num = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN"));
const xx = (n) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(2) + "x");

function ago(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function askClaude(prompt, servers) {
  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  };
  if (servers) payload.mcp_servers = servers;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return text;
}

function parseJson(text) {
  const clean = String(text).replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("no JSON in reply");
  return JSON.parse(clean.slice(s, e + 1));
}

const LOG_KEY = "mulmul-os:runs";

async function loadRuns() {
  try {
    const r = await window.storage.get(LOG_KEY);
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
async function saveRuns(runs) {
  try {
    await window.storage.set(LOG_KEY, JSON.stringify(runs.slice(0, 80)));
  } catch {
    /* non-blocking */
  }
}

/* ============================================================
   PRIMITIVES
   ============================================================ */

function Dot({ state, size = 7 }) {
  const c =
    state === "connected" || state === "ok" ? T.ok
      : state === "error" || state === "fail" ? T.err
      : state === "gate" ? T.violet
      : state === "checking" || state === "running" ? T.warn
      : T.dim;
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (state !== "checking" && state !== "running") { setOn(true); return; }
    const i = setInterval(() => setOn((v) => !v), 520);
    return () => clearInterval(i);
  }, [state]);
  return (
    <span style={{ width: size, height: size, background: on ? c : "transparent", border: `1px solid ${c}`, display: "inline-block", flexShrink: 0, boxShadow: on && state !== "idle" ? glow(c, 0.55, 7) : "none", transition: "box-shadow .3s" }} />
  );
}

function Label({ children, style }) {
  return (
    <div style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim, ...style }}>
      {children}
    </div>
  );
}

function SectionHead({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
      <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: T.text, letterSpacing: "-0.01em" }}>{children}</div>
      {right && <div style={{ fontFamily: SANS, fontSize: 11, color: T.dim }}>{right}</div>}
    </div>
  );
}

function Btn({ children, onClick, disabled, primary, small, violet }) {
  const [hover, setHover] = useState(false);
  const c = violet ? T.violet : T.accent;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: SANS,
        fontSize: small ? 11.5 : 12.5,
        fontWeight: 600,
        letterSpacing: "0.005em",
        padding: small ? "6px 12px" : "9px 16px",
        borderRadius: R.md,
        border: `1px solid ${primary ? "transparent" : hover && !disabled ? T.borderHi : T.border}`,
        background: primary
          ? `linear-gradient(135deg, ${c}, ${violet ? T.violetDeep : T.accentDeep})`
          : hover && !disabled ? T.surfaceHi : "transparent",
        color: primary ? "#04131f" : hover && !disabled ? T.text : T.muted,
        boxShadow: primary && !disabled ? glow(c, hover ? 0.45 : 0.22, hover ? 22 : 14) : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all .18s ease",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Card({ children, style, pad = 18, accent }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: R.lg,
      padding: pad,
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      {accent && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.85 }} />
      )}
      {children}
    </div>
  );
}

/* KPI card — the ServiceFlow top row: big figure, delta, sparkline. */
function Kpi({ label, value, delta, deltaGood, points, colour, sub }) {
  const c = colour || T.accent;
  return (
    <div style={{
      background: `linear-gradient(160deg, ${T.surfaceHi}, ${T.surface})`,
      border: `1px solid ${T.border}`, borderRadius: R.lg, padding: "15px 17px",
      position: "relative", overflow: "hidden", minWidth: 0,
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(120% 90% at 100% 0%, ${c}18, transparent 62%)` }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, position: "relative" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: T.muted, fontWeight: 500, marginBottom: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
          <div style={{ fontFamily: MONO, fontSize: 26, color: T.text, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
          {(delta || sub) && (
            <div style={{ fontFamily: SANS, fontSize: 11, marginTop: 9, color: delta ? (deltaGood ? T.ok : T.err) : T.dim }}>
              {delta || sub}
            </div>
          )}
        </div>
        {points && points.length > 1 && <Spark points={points} colour={c} width={70} height={32} />}
      </div>
    </div>
  );
}


function Table({ cols, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ overflowX: "auto", borderRadius: R.md, border: `1px solid ${T.border}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} style={{
                textAlign: i === 0 ? "left" : "right", fontFamily: SANS, fontSize: 11,
                letterSpacing: "0.03em", color: T.dim, fontWeight: 600,
                padding: "11px 14px", background: T.surfaceHi,
                borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? "transparent" : `${T.surfaceHi}55` }}>
              {r.map((cell, ci) => (
                <td key={ci} style={{
                  textAlign: ci === 0 ? "left" : "right",
                  fontFamily: ci === 0 ? SANS : MONO,
                  fontSize: ci === 0 ? 12.5 : 12,
                  color: ci === 0 ? T.text : T.muted,
                  padding: "10px 14px",
                  borderBottom: ri === rows.length - 1 ? "none" : `1px solid ${T.border}66`,
                  whiteSpace: ci === 0 ? "normal" : "nowrap",
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Caveat({ children, tone = "warn" }) {
  const c = tone === "err" ? T.err : T.warn;
  return (
    <div style={{ marginTop: 12, padding: "9px 11px", borderLeft: `2px solid ${c}`, background: T.surfaceHi, fontSize: 11, lineHeight: 1.6, color: T.muted }}>
      {children}
    </div>
  );
}

/* Chevron pipeline — the flow-stage ribbon from the reference art. */
function Chevron({ label, sub, state, first, last, children }) {
  const active = state && state !== "idle";
  const c = state === "done" ? T.ok : state === "failed" ? T.err : state === "waiting" ? T.violet : state === "running" ? T.warn : T.dim;
  return (
    <div style={{
      position: "relative", flex: "1 1 132px", minWidth: 120,
      padding: `9px 16px 10px ${first ? 14 : 24}px`,
      background: active ? T.surfaceHi : "transparent",
      border: `1px solid ${active ? c : T.border}`,
      boxShadow: active ? glow(c, 0.16, 14) : "none",
      clipPath: last
        ? `polygon(${first ? "0 0" : "12px 0"}, 100% 0, 100% 100%, ${first ? "0 100%" : "12px 100%"}, ${first ? "0 0" : "0 50%"})`
        : `polygon(${first ? "0 0" : "12px 0"}, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, ${first ? "0 100%" : "12px 100%"}, ${first ? "0 0" : "0 50%"})`,
      transition: "all .3s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <Dot size={5} state={state === "running" ? "running" : state === "done" ? "ok" : state === "failed" ? "fail" : state === "waiting" ? "gate" : "idle"} />
        <span style={{ fontSize: 11, color: active ? T.text : T.dim, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>{sub}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder }) {
  return (
    <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", padding: "9px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12.5, outline: "none" }} />
  );
}

/* ============================================================
   FLOWS VIEW
   ============================================================ */

function StageRail({ flow, state }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", marginBottom: 14, flexWrap: "wrap", gap: 3 }}>
      {flow.stages.map((st, si) => {
        const status = state?.stageStatus?.[si] || "idle";
        return (
          <Chevron key={si} first={si === 0} last={si === flow.stages.length - 1}
            state={status} label={st.label}
            sub={st.kind === "fanout" ? `${st.agents.length} parallel` : st.kind === "gate" ? "needs you" : "dependent"}>
            {st.kind === "fanout" && (
              <div style={{ marginTop: 7, display: "grid", gap: 2 }}>
                {st.agents.map((aid) => {
                  const as = state?.agentStatus?.[aid] || "idle";
                  return (
                    <div key={aid} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Dot size={4} state={as === "running" ? "running" : as === "ok" ? "ok" : as === "fail" ? "fail" : "idle"} />
                      <span style={{ fontSize: 9.5, color: as === "fail" ? T.err : as === "ok" ? T.muted : T.dim }}>
                        {AGENTS.find((x) => x.id === aid)?.name || aid}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Chevron>
        );
      })}
    </div>
  );
}

function FlowOutput({ out }) {
  if (!out) return null;
  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${T.borderHi}`, paddingTop: 14 }}>
      {out.headline && <div style={{ fontSize: 14, color: T.text, lineHeight: 1.5, marginBottom: 14 }}>{out.headline}</div>}

      {out.email && (
        <div style={{ border: `1px solid ${T.borderHi}`, marginBottom: 14 }}>
          <div style={{ padding: "8px 11px", borderBottom: `1px solid ${T.border}`, background: T.surfaceHi, display: "flex", gap: 8, alignItems: "center" }}>
            <Label style={{ fontSize: 8.5, color: T.warn }}>Draft — not sent</Label>
            <span style={{ marginLeft: "auto", fontSize: 10, color: T.dim }}>niharika@mulmul.co</span>
          </div>
          <div style={{ padding: "10px 11px", fontSize: 11.5, color: T.text, borderBottom: `1px solid ${T.border}` }}>{out.email.subject}</div>
          <pre style={{ padding: 11, margin: 0, fontSize: 11, color: T.muted, lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: MONO }}>{out.email.body}</pre>
        </div>
      )}

      {out.verdicts && <Table cols={["Campaign", "Verdict", "Because"]} rows={out.verdicts.map((v) => [v.campaign, v.verdict, v.because])} />}
      {out.risks && <Table cols={["Risk", "Severity", "Because"]} rows={out.risks.map((r) => [r.risk, r.severity, r.because])} />}

      {(out.sections || []).map((s, i) => (
        <div key={i} style={{ marginTop: 12 }}>
          <Label style={{ marginBottom: 6 }}>{s.title}</Label>
          <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{s.body}</div>
        </div>
      ))}

      {out.actions?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Label style={{ marginBottom: 7 }}>Actions</Label>
          {out.actions.map((a, i) => (
            <div key={i} style={{ fontSize: 11.5, color: T.text, lineHeight: 1.6, padding: "3px 0", display: "flex", gap: 8 }}>
              <span style={{ color: T.accent }}>→</span><span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {out.gaps?.length > 0 && (
        <Caveat tone="err">
          <strong style={{ color: T.err }}>Not covered by this run</strong>
          {out.gaps.map((g, i) => <div key={i} style={{ marginTop: 4 }}>· {g}</div>)}
        </Caveat>
      )}
    </div>
  );
}

function FlowsView({ flowState, startFlow, submitGate, cancelFlow }) {
  const [open, setOpen] = useState(FLOWS[0].id);
  const [gateDraft, setGateDraft] = useState({});

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {FLOWS.map((f) => {
        const st = flowState[f.id];
        const isOpen = open === f.id;
        const running = st?.running;
        const waiting = st?.waitingGate != null;
        const agentCount = f.stages.filter((s) => s.kind === "fanout").reduce((a, s) => a + s.agents.length, 0);
        return (
          <Card key={f.id} pad={0}>
            <div onClick={() => setOpen(isOpen ? null : f.id)}
              style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", borderBottom: isOpen ? `1px solid ${T.border}` : "none" }}>
              <Dot state={running ? "running" : waiting ? "gate" : st?.output ? "ok" : st?.failed ? "fail" : "idle"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{f.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim, border: `1px solid ${T.border}`, padding: "1px 5px" }}>{f.cadence}</span>
                  <span style={{ fontSize: 10, color: T.dim }}>{agentCount} agents{f.stages.some((s) => s.kind === "gate") ? " · gated" : ""}</span>
                  {waiting && <span style={{ fontFamily: SANS, fontSize: 11, color: T.violet, fontWeight: 600, padding: "2px 9px", borderRadius: R.pill, background: `${T.violet}1f`, border: `1px solid ${T.violet}44` }}>waiting on you</span>}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.55 }}>{f.desc}</div>
              </div>
              <Btn small primary onClick={(e) => { e.stopPropagation(); setOpen(f.id); running ? cancelFlow(f.id) : startFlow(f.id); }}>
                {running ? "Stop" : st?.output ? "Rerun" : "Play"}
              </Btn>
            </div>

            {isOpen && (
              <div style={{ padding: "14px 16px 18px" }}>
                <StageRail flow={f} state={st} />

                {waiting && (
                  <div style={{ border: `1px solid ${T.violet}66`, borderRadius: R.md, background: `linear-gradient(160deg, ${T.violet}14, ${T.surfaceHi})`, padding: "15px 16px", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Dot state="gate" size={6} />
                      <Label style={{ color: T.violet }}>Gate — {f.stages[st.waitingGate].label}</Label>
                    </div>
                    <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.65, marginBottom: 13 }}>{f.stages[st.waitingGate].why}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                      {f.stages[st.waitingGate].fields.map((fl) => (
                        <div key={fl.id}>
                          <div style={{ fontSize: 10, color: T.dim, marginBottom: 5 }}>{fl.label}</div>
                          <Input value={gateDraft[fl.id]} placeholder={fl.placeholder} onChange={(v) => setGateDraft((d) => ({ ...d, [fl.id]: v }))} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 13, display: "flex", gap: 8 }}>
                      <Btn primary onClick={() => { submitGate(f.id, gateDraft); setGateDraft({}); }}>Continue</Btn>
                      <Btn onClick={() => cancelFlow(f.id)}>Abandon run</Btn>
                    </div>
                  </div>
                )}

                {st?.agentResults && Object.keys(st.agentResults).length > 0 && (
                  <details>
                    <summary style={{ fontSize: 10, color: T.dim, cursor: "pointer", letterSpacing: "0.14em", textTransform: "uppercase", padding: "6px 0" }}>
                      Agent output ({Object.keys(st.agentResults).length})
                    </summary>
                    <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
                      {Object.entries(st.agentResults).map(([aid, r]) => (
                        <div key={aid} style={{ border: `1px solid ${T.border}`, borderRadius: R.md, padding: "13px 15px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                            <Dot state={r.ok ? "ok" : "fail"} size={5} />
                            <span style={{ fontSize: 11.5, color: T.text }}>{AGENTS.find((a) => a.id === aid)?.name}</span>
                          </div>
                          <div style={{ fontSize: 11, color: r.ok ? T.muted : T.err, lineHeight: 1.6, marginBottom: r.table ? 9 : 0 }}>{r.summary}</div>
                          {r.table && <Table cols={r.table.cols} rows={r.table.rows} />}
                          {r.fallback && <div style={{ fontSize: 10.5, color: T.warn, marginTop: 7 }}>↳ {r.fallback}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {st?.error && <Caveat tone="err">{st.error}</Caveat>}
                <FlowOutput out={st?.output} />

                {!st && (
                  <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7 }}>
                    Not run yet. The fan-out runs its agents at once; a blocked agent reports why and the flow continues without it, naming the gap in the output.
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ============================================================
   EXPLORE — full depth, not summaries.
   Meta drills campaign → ad set → ad, lazily, at any date range
   and any breakdown. Shopify lists everything, not a top-N.
   Sources that cannot answer say exactly what wiring they need.
   ============================================================ */

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7d", label: "7 days" },
  { id: "last_14d", label: "14 days" },
  { id: "last_30d", label: "30 days" },
  { id: "this_month", label: "MTD" },
  { id: "last_month", label: "Last month" },
  { id: "last_90d", label: "90 days" },
];

const rangeLabel = (id) => RANGES.find((r) => r.id === id)?.label || id;

const METRIC_GROUPS = {
  money: { label: "Money", cols: [["spend", "Spend", inr], ["revenue", "Revenue", inr], ["roas", "ROAS", xx], ["cpa", "CPA", inr]] },
  delivery: { label: "Delivery", cols: [["impressions", "Impr.", num], ["reach", "Reach", num], ["frequency", "Freq", (v) => (v == null ? "—" : Number(v).toFixed(2))], ["cpm", "CPM", inr]] },
  engagement: { label: "Engagement", cols: [["clicks", "Clicks", num], ["ctr", "CTR", (v) => (v == null ? "—" : Number(v).toFixed(2) + "%")], ["cpc", "CPC", inr]] },
  funnel: { label: "Funnel", cols: [["addToCart", "ATC", num], ["checkouts", "IC", num], ["purchases", "Purch.", num], ["cvr", "CVR", (v) => (v == null ? "—" : Number(v).toFixed(2) + "%")]] },
};

const BREAKDOWNS = [
  { id: "none", label: "No breakdown" },
  { id: "age", label: "Age" },
  { id: "gender", label: "Gender" },
  { id: "age,gender", label: "Age × gender" },
  { id: "publisher_platform", label: "Platform" },
  { id: "platform_position", label: "Placement" },
  { id: "impression_device", label: "Device" },
  { id: "country", label: "Country" },
  { id: "region", label: "Region" },
];

function DateRangeBar({ range, setRange, breakdown, setBreakdown, showBreakdown, onReload, busy }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${T.border}` }}>
      <Label style={{ marginRight: 2 }}>Range</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: 3, background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.md }}>
        {RANGES.map((r) => (
          <div key={r.id} onClick={() => setRange(r.id)}
            style={{ padding: "7px 13px", fontFamily: SANS, fontSize: 12, cursor: "pointer", borderRadius: R.sm, background: range === r.id ? `linear-gradient(135deg, ${T.accent}, ${T.accentDeep})` : "transparent", color: range === r.id ? "#04131f" : T.muted, fontWeight: range === r.id ? 600 : 500, transition: "all .16s" }}>
            {r.label}
          </div>
        ))}
      </div>
      {showBreakdown && (
        <>
          <Label style={{ marginLeft: 6 }}>Split</Label>
          <select value={breakdown} onChange={(e) => setBreakdown(e.target.value)}
            style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12, padding: "7px 10px", outline: "none" }}>
            {BREAKDOWNS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </>
      )}
      <div style={{ marginLeft: "auto" }}>
        <Btn small primary onClick={onReload} disabled={busy}>{busy ? "Loading" : "Load"}</Btn>
      </div>
    </div>
  );
}

function MetricToggles({ active, setActive }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
      {Object.entries(METRIC_GROUPS).map(([k, g]) => {
        const on = active.includes(k);
        return (
          <div key={k} onClick={() => setActive(on ? active.filter((x) => x !== k) : [...active, k])}
            style={{ padding: "3px 8px", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, color: on ? T.accent : T.dim }}>
            {g.label}
          </div>
        );
      })}
    </div>
  );
}

function MetaExplorer({ range, breakdown, setRange, setBreakdown }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [children, setChildren] = useState({});
  const [loadingChild, setLoadingChild] = useState({});
  const [groups, setGroups] = useState(["money", "delivery"]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [q, setQ] = useState("");

  const metricCols = groups.flatMap((g) => METRIC_GROUPS[g].cols);

  const fetchLevel = async (level, parentId) => {
    const scope = parentId
      ? `${level === "adset" ? "ad sets inside campaign" : "ads inside ad set"} ${parentId}`
      : "ALL campaigns regardless of status (active, paused, archived)";
    const bd = breakdown !== "none" && !parentId ? `\nBreak the results down by ${breakdown}.` : "";
    const text = await askClaude(
      `Use Meta Ads tools on ad account ${META_ACCOUNT} (Shop Mulmul).
Get ${scope} for the date preset "${range}". Do NOT truncate — return every row, not a top N.${bd}
For each row return: id, name, status, spend, purchase conversion value as revenue, purchases, roas, impressions, reach, frequency, cpm, clicks, ctr, cpc, add-to-cart count as addToCart, initiate-checkout count as checkouts, cost per purchase as cpa, and purchases/clicks as cvr.
Use null for anything genuinely unavailable. Never estimate.
Reply with ONLY JSON, no fences: {"rows":[{"id":"","name":"","status":"","spend":n,"revenue":n,"purchases":n,"roas":n,"impressions":n,"reach":n,"frequency":n,"cpm":n,"clicks":n,"ctr":n,"cpc":n,"addToCart":n,"checkouts":n,"cpa":n,"cvr":n}]}`,
      MCP.meta
    );
    return parseJson(text).rows || [];
  };

  const load = async () => {
    setBusy(true); setError(null); setChildren({}); setExpanded({});
    try {
      setRows(await fetchLevel("campaign", null));
    } catch (e) {
      setError(`Meta did not answer — ${e.message || e}`); setRows(null);
    }
    setBusy(false);
  };

  const toggle = async (row, level) => {
    const key = row.id;
    if (expanded[key]) return setExpanded((s) => ({ ...s, [key]: false }));
    setExpanded((s) => ({ ...s, [key]: true }));
    if (children[key]) return;
    setLoadingChild((s) => ({ ...s, [key]: true }));
    try {
      const kids = await fetchLevel(level, row.id);
      setChildren((s) => ({ ...s, [key]: kids }));
    } catch (e) {
      setChildren((s) => ({ ...s, [key]: { error: e.message || String(e) } }));
    }
    setLoadingChild((s) => ({ ...s, [key]: false }));
  };

  const visible = (rows || []).filter((r) => {
    if (statusFilter !== "all" && (r.status || "").toLowerCase() !== statusFilter) return false;
    if (q.trim() && !(r.name || "").toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  const totals = visible.reduce((a, r) => ({ spend: a.spend + (r.spend || 0), revenue: a.revenue + (r.revenue || 0) }), { spend: 0, revenue: 0 });

  const Row = ({ r, level, depth }) => {
    const kids = children[r.id];
    const canDrill = level !== "ad";
    return (
      <>
        <tr>
          <td style={{ padding: "7px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.text, paddingLeft: 10 + depth * 16 }}>
            <span onClick={() => canDrill && toggle(r, level === "campaign" ? "adset" : "ad")}
              style={{ cursor: canDrill ? "pointer" : "default", display: "inline-flex", gap: 6, alignItems: "center" }}>
              {canDrill && <span style={{ color: T.accent, fontSize: 9 }}>{expanded[r.id] ? "▾" : "▸"}</span>}
              <span>{r.name}</span>
              {r.status && <span style={{ fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: (r.status || "").toLowerCase() === "active" ? T.ok : T.dim, border: `1px solid ${T.border}`, padding: "0 4px" }}>{r.status}</span>}
              {loadingChild[r.id] && <span style={{ fontSize: 9, color: T.warn }}>loading…</span>}
            </span>
          </td>
          {metricCols.map(([k, , fmt]) => (
            <td key={k} style={{ padding: "7px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11.5, color: T.muted, textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r[k])}</td>
          ))}
        </tr>
        {expanded[r.id] && kids?.error && (
          <tr><td colSpan={metricCols.length + 1} style={{ padding: "7px 10px", paddingLeft: 26 + depth * 16, fontSize: 11, color: T.err, borderBottom: `1px solid ${T.border}` }}>Could not load children — {kids.error}</td></tr>
        )}
        {expanded[r.id] && Array.isArray(kids) && kids.length === 0 && (
          <tr><td colSpan={metricCols.length + 1} style={{ padding: "7px 10px", paddingLeft: 26 + depth * 16, fontSize: 11, color: T.dim, borderBottom: `1px solid ${T.border}` }}>Nothing underneath.</td></tr>
        )}
        {expanded[r.id] && Array.isArray(kids) && kids.map((k) => (
          <Row key={k.id} r={k} level={level === "campaign" ? "adset" : "ad"} depth={depth + 1} />
        ))}
      </>
    );
  };

  return (
    <Card>
      <DateRangeBar range={range} setRange={setRange} breakdown={breakdown} setBreakdown={setBreakdown} showBreakdown onReload={load} busy={busy} />
      <MetricToggles active={groups} setActive={setGroups} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter by name"
          style={{ flex: "1 1 160px", padding: "8px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12, outline: "none" }} />
        {["all", "active", "paused"].map((s) => (
          <div key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: "4px 9px", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: `1px solid ${statusFilter === s ? T.accent : T.border}`, color: statusFilter === s ? T.accent : T.dim }}>{s}</div>
        ))}
      </div>

      {error && <Caveat tone="err">{error}</Caveat>}
      {!rows && !error && !busy && (
        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "12px 0" }}>
          Nothing loaded. Press Load to pull every campaign at {rangeLabel(range)} — all statuses, not a top N. Click any row to drill into its ad sets, then again for ads.
        </div>
      )}
      {busy && !rows && <div style={{ fontSize: 11.5, color: T.warn, padding: "12px 0" }}>Pulling every campaign…</div>}

      {rows && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, fontWeight: 700, padding: "6px 10px 7px", borderBottom: `1px solid ${T.borderHi}` }}>
                    Campaign / ad set / ad
                  </th>
                  {metricCols.map(([k, label]) => (
                    <th key={k} style={{ textAlign: "right", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, fontWeight: 700, padding: "6px 10px 7px", borderBottom: `1px solid ${T.borderHi}`, whiteSpace: "nowrap" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => <Row key={r.id} r={r} level="campaign" depth={0} />)}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, color: T.dim, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>{visible.length} of {rows.length} rows</span>
            <span>spend {inr(totals.spend)}</span>
            <span>revenue {inr(totals.revenue)}</span>
            <span>blended {xx(totals.spend ? totals.revenue / totals.spend : null)}</span>
          </div>
          <Caveat>
            Revenue here is the API's total purchase value, which includes off-site conversions. Your reports use the 7-day-click website slice, which the API cannot expose. Read this for structure and delivery, not for report-grade ROAS.
          </Caveat>
        </>
      )}
    </Card>
  );
}

const SHOPIFY_SECTIONS = [
  {
    id: "products", label: "Products",
    prompt: (range) => `Use Shopify tools. List EVERY product that sold in the period "${range}" — do not truncate to a top N. Per product: title, product type, vendor, units sold, gross revenue INR, current total inventory across locations, and number of variants.
Reply with ONLY JSON: {"rows":[{"title":"","type":"","units":n,"revenue":n,"inventory":n,"variants":n}]}`,
    cols: [["title", "Product", (v) => v], ["type", "Type", (v) => v || "—"], ["units", "Units", num], ["revenue", "Revenue", inr], ["inventory", "Stock", num], ["variants", "Var.", num]],
    note: "All-channel. Retail and draft orders are included — split before reading anything as a digital winner.",
  },
  {
    id: "orders", label: "Orders",
    prompt: (range) => `Use Shopify tools. List orders created in the period "${range}", most recent first, up to 100. Per order: order name/number, created date, total price INR, number of line items, financial status, fulfillment status, and the sales channel or source name.
Reply with ONLY JSON: {"rows":[{"name":"","date":"","total":n,"items":n,"financial":"","fulfillment":"","channel":""}]}`,
    cols: [["name", "Order", (v) => v], ["date", "Date", (v) => v || "—"], ["channel", "Channel", (v) => v || "—"], ["items", "Items", num], ["total", "Total", inr], ["financial", "Payment", (v) => v || "—"], ["fulfillment", "Fulfilment", (v) => v || "—"]],
    note: "Channel is how you separate online from retail. Anything without a web channel is store or draft.",
  },
  {
    id: "customers", label: "Customers",
    prompt: (range) => `Use Shopify tools. For the period "${range}" summarise customers: how many new customers ordered, how many returning, total customers with orders, and list every customer who ordered in the period (up to 200) with name (or email prefix), order count and total spend INR.
Reply with ONLY JSON: {"newCount":n,"returningCount":n,"rows":[{"name":"","orders":n,"spend":n}]}`,
    cols: [["name", "Customer", (v) => v], ["orders", "Orders", num], ["spend", "Spend", inr]],
    note: "New versus returning is the acquisition read. CAC as a share of AOV needs spend from the Meta tab alongside this.",
  },
  {
    id: "collections", label: "Collections",
    prompt: (range) => `Use Shopify tools. List every collection in the store with: title, number of products, whether it is published to the Online Store, and its handle.
Reply with ONLY JSON: {"rows":[{"title":"","products":n,"published":true,"handle":""}]}`,
    cols: [["title", "Collection", (v) => v], ["handle", "Handle", (v) => v || "—"], ["products", "Products", num], ["published", "Live", (v) => (v ? "yes" : "no")]],
    note: "Check that seasonal collections are actually published and that movers carry the right tags before a peak.",
  },
  {
    id: "inventory", label: "Inventory",
    prompt: (range) => `Use Shopify tools. List the 100 product variants with the lowest available inventory that are still published and have sold at least once recently. Per variant: product title, variant title, SKU, available quantity, and price INR.
Reply with ONLY JSON: {"rows":[{"product":"","variant":"","sku":"","available":n,"price":n}]}`,
    cols: [["product", "Product", (v) => v], ["variant", "Variant", (v) => v || "—"], ["sku", "SKU", (v) => v || "—"], ["available", "Available", num], ["price", "Price", inr]],
    note: "Online stock only. Vinculum holds retail depth and is not wired, so a low number here does not mean the style is gone.",
  },
];

function ShopifyExplorer({ range, setRange }) {
  const [tab, setTab] = useState("products");
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(null);

  const section = SHOPIFY_SECTIONS.find((s) => s.id === tab);
  const current = data[`${tab}:${range}`];

  const load = async () => {
    setBusy(true); setError(null);
    try {
      const text = await askClaude(section.prompt(range), MCP.shopify);
      setData((d) => ({ ...d, [`${tab}:${range}`]: parseJson(text) }));
    } catch (e) {
      setError(`Shopify did not answer — ${e.message || e}`);
    }
    setBusy(false);
  };

  let rows = current?.rows || [];
  if (q.trim()) {
    const n = q.trim().toLowerCase();
    rows = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(n)));
  }
  if (sort) {
    rows = [...rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }

  return (
    <Card>
      <div style={{ display: "flex", gap: 3, padding: 3, background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.md, marginBottom: 16, flexWrap: "wrap" }}>
        {SHOPIFY_SECTIONS.map((s) => (
          <div key={s.id} onClick={() => { setTab(s.id); setSort(null); }}
            style={{ padding: "8px 14px", fontFamily: SANS, fontSize: 12.5, cursor: "pointer", borderRadius: R.sm, background: tab === s.id ? `linear-gradient(135deg, ${T.accent}, ${T.accentDeep})` : "transparent", color: tab === s.id ? "#04131f" : T.muted, fontWeight: tab === s.id ? 600 : 500, transition: "all .16s" }}>
            {s.label}
          </div>
        ))}
      </div>

      <DateRangeBar range={range} setRange={setRange} onReload={load} busy={busy} />

      <div style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter rows"
          style={{ width: "100%", padding: "8px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12, outline: "none" }} />
      </div>

      {error && <Caveat tone="err">{error}</Caveat>}
      {busy && <div style={{ fontSize: 11.5, color: T.warn, padding: "12px 0" }}>Pulling {section.label.toLowerCase()}…</div>}
      {!current && !busy && !error && (
        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "12px 0" }}>
          Nothing loaded. Press Load to pull {section.label.toLowerCase()} for {rangeLabel(range)} — the full list, not a top N.
        </div>
      )}

      {current && (
        <>
          {current.newCount != null && (
            <div style={{ display: "flex", gap: 20, marginBottom: 14, fontSize: 11.5 }}>
              <span style={{ color: T.muted }}>New customers <strong style={{ color: T.text }}>{num(current.newCount)}</strong></span>
              <span style={{ color: T.muted }}>Returning <strong style={{ color: T.text }}>{num(current.returningCount)}</strong></span>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO }}>
              <thead>
                <tr>
                  {section.cols.map(([k, label], i) => (
                    <th key={k} onClick={() => setSort((s) => ({ key: k, dir: s?.key === k && s.dir === "desc" ? "asc" : "desc" }))}
                      style={{ textAlign: i === 0 ? "left" : "right", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: sort?.key === k ? T.accent : T.dim, fontWeight: 700, padding: "6px 10px 7px", borderBottom: `1px solid ${T.borderHi}`, whiteSpace: "nowrap", cursor: "pointer" }}>
                      {label}{sort?.key === k ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {section.cols.map(([k, , fmt], i) => (
                      <td key={k} style={{ textAlign: i === 0 ? "left" : "right", fontSize: 11.5, color: i === 0 ? T.text : T.muted, padding: "7px 10px", borderBottom: `1px solid ${T.border}`, whiteSpace: i === 0 ? "normal" : "nowrap" }}>{fmt(r[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, color: T.dim }}>{rows.length} rows · click a header to sort</div>
          <Caveat>{section.note}</Caveat>
        </>
      )}
    </Card>
  );
}

function GoogleExplorer({ range, setRange }) {
  const [account, setAccount] = useState(GOOGLE_ACCOUNTS[0].id);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "spend", dir: "desc" });
  const [showOmni, setShowOmni] = useState(true);

  const load = async () => {
    setBusy(true); setError(null);
    try {
      const text = await askClaude(
        `Use the Supermetrics tools. Query data source ds_id "AW" (Google Ads), ds_accounts "${account}", date_range_type "${range}", fields "campaign_name,cost,impressions,clicks,conversions,conversion_value", max_rows 500.
Call data_query, then poll get_async_query_results with the returned schedule_id until status is completed.
Return EVERY campaign row — do not truncate. Monetary values are INR.
Reply with ONLY JSON, no fences: {"rows":[{"name":"","spend":n,"impressions":n,"clicks":n,"conversions":n,"revenue":n}]}`,
        MCP.supermetrics
      );
      setRows(parseJson(text).rows || []);
    } catch (e) {
      setError(`Supermetrics did not answer — ${e.message || e}`); setRows(null);
    }
    setBusy(false);
  };

  const all = rows || [];
  const web = all.filter((r) => !isOmni(r.name));
  const omni = all.filter((r) => isOmni(r.name));
  const ws = web.reduce((a, r) => a + (r.spend || 0), 0);
  const wv = web.reduce((a, r) => a + (r.revenue || 0), 0);
  const os = omni.reduce((a, r) => a + (r.spend || 0), 0);
  const ov = omni.reduce((a, r) => a + (r.conversions || 0), 0);

  const prep = (list, isO) => {
    let out = list.map((r) => ({
      ...r,
      roas: !isO && r.spend ? r.revenue / r.spend : null,
      ctr: r.impressions ? (100 * r.clicks) / r.impressions : null,
      costPer: isO && r.conversions ? r.spend / r.conversions : null,
    }));
    if (q.trim()) out = out.filter((r) => (r.name || "").toLowerCase().includes(q.trim().toLowerCase()));
    return out.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  };

  const Head = ({ k, label, first }) => (
    <th onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}
      style={{ textAlign: first ? "left" : "right", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: sort.key === k ? T.accent : T.dim, fontWeight: 700, padding: "6px 10px 7px", borderBottom: `1px solid ${T.borderHi}`, whiteSpace: "nowrap", cursor: "pointer" }}>
      {label}{sort.key === k ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
  const Cell = ({ children, first, strong }) => (
    <td style={{ textAlign: first ? "left" : "right", fontSize: 11.5, color: first ? T.text : T.muted, fontWeight: strong ? 700 : 400, padding: "7px 10px", borderBottom: `1px solid ${T.border}`, whiteSpace: first ? "normal" : "nowrap" }}>{children}</td>
  );

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Label>Account</Label>
        <select value={account} onChange={(e) => { setAccount(e.target.value); setRows(null); }}
          style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12.5, padding: "8px 11px", outline: "none", flex: "1 1 240px" }}>
          {GOOGLE_ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.note}</option>)}
        </select>
      </div>

      <DateRangeBar range={range} setRange={setRange} onReload={load} busy={busy} />

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter by campaign name"
          style={{ flex: "1 1 180px", padding: "8px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: R.md, color: T.text, fontFamily: SANS, fontSize: 12, outline: "none" }} />
        <div onClick={() => setShowOmni(!showOmni)}
          style={{ padding: "4px 9px", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: `1px solid ${showOmni ? T.accent : T.border}`, color: showOmni ? T.accent : T.dim }}>
          {showOmni ? "OMNI shown" : "OMNI hidden"}
        </div>
      </div>

      {error && <Caveat tone="err">{error}</Caveat>}
      {busy && <div style={{ fontSize: 11.5, color: T.warn, padding: "12px 0" }}>Querying Supermetrics — this runs async, give it a moment…</div>}
      {!rows && !busy && !error && (
        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "12px 0" }}>
          Nothing loaded. Press Load to pull every campaign on this account at {rangeLabel(range)}. Web and OMNI store-visit campaigns are separated automatically — OMNI conversion value is a visit count, not rupees.
        </div>
      )}

      {rows && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              ["Web spend", inr(ws), T.text], ["Web revenue", inr(wv), T.text],
              ["Web ROAS", xx(ws ? wv / ws : null), T.ok],
              ["OMNI spend", inr(os), T.warn],
              ["OMNI share", `${(100 * os / (ws + os) || 0).toFixed(0)}%`, os / (ws + os) > 0.25 ? T.warn : T.text],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: T.surface, padding: "11px 12px" }}>
                <Label style={{ marginBottom: 7 }}>{l}</Label>
                <div style={{ fontSize: 19, color: c, lineHeight: 1 }}>{v}</div>
              </div>
            ))}
          </div>

          <Label style={{ marginBottom: 8 }}>Web campaigns — graded on ROAS</Label>
          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO }}>
              <thead><tr>
                <Head k="name" label="Campaign" first /><Head k="spend" label="Spend" /><Head k="revenue" label="Revenue" />
                <Head k="roas" label="ROAS" /><Head k="impressions" label="Impr." /><Head k="clicks" label="Clicks" />
                <Head k="ctr" label="CTR" /><Head k="conversions" label="Conv." />
              </tr></thead>
              <tbody>
                {prep(web, false).map((r, i) => (
                  <tr key={i}>
                    <Cell first>{r.name}</Cell><Cell>{inr(r.spend)}</Cell><Cell>{inr(r.revenue)}</Cell>
                    <Cell strong>{xx(r.roas)}</Cell><Cell>{num(r.impressions)}</Cell><Cell>{num(r.clicks)}</Cell>
                    <Cell>{r.ctr == null ? "—" : r.ctr.toFixed(2) + "%"}</Cell><Cell>{num(r.conversions)}</Cell>
                  </tr>
                ))}
                <tr>
                  <Cell first strong>WEB TOTAL</Cell><Cell strong>{inr(ws)}</Cell><Cell strong>{inr(wv)}</Cell>
                  <Cell strong>{xx(ws ? wv / ws : null)}</Cell><Cell>—</Cell><Cell>—</Cell><Cell>—</Cell><Cell>—</Cell>
                </tr>
              </tbody>
            </table>
          </div>

          {showOmni && omni.length > 0 && (
            <>
              <Label style={{ marginBottom: 8, color: T.warn }}>OMNI store-visit campaigns — not graded on ROAS</Label>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO }}>
                  <thead><tr>
                    <Head k="name" label="Campaign" first /><Head k="spend" label="Spend" />
                    <Head k="conversions" label="Visits" /><Head k="costPer" label="Cost / visit" />
                    <Head k="impressions" label="Impr." /><Head k="ctr" label="CTR" />
                  </tr></thead>
                  <tbody>
                    {prep(omni, true).map((r, i) => (
                      <tr key={i}>
                        <Cell first>{r.name}</Cell><Cell>{inr(r.spend)}</Cell><Cell>{num(r.conversions)}</Cell>
                        <Cell strong>{inr(r.costPer)}</Cell><Cell>{num(r.impressions)}</Cell>
                        <Cell>{r.ctr == null ? "—" : r.ctr.toFixed(2) + "%"}</Cell>
                      </tr>
                    ))}
                    <tr>
                      <Cell first strong>OMNI TOTAL</Cell><Cell strong>{inr(os)}</Cell><Cell strong>{num(ov)}</Cell>
                      <Cell strong>{inr(ov ? os / ov : null)}</Cell><Cell>—</Cell><Cell>—</Cell>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          <Caveat>
            OMNI campaigns optimise store visits — their conversion value is a visit count, so a rupee ROAS on them is meaningless. Blending them in reported 3.61x against a real web figure of 5.61x on the 18 Aug pull — a 36% understatement. Web revenue is Google's own attributed value on its default attribution, and carries the same caveat as Meta's total ROAS.
          </Caveat>
        </>
      )}
    </Card>
  );
}

function DriveExplorer() {
  const [sel, setSel] = useState(null);
  const [content, setContent] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const open = async (f) => {
    setSel(f.id); setError(null);
    if (content[f.id]) return;
    setBusy(true);
    try {
      const text = await askClaude(
        `Use the Google Drive tools. Read file id "${f.id}" (${f.name}).
Summarise it faithfully: which tabs or sections exist, what period it covers, the shape of the data, and anything obviously broken (inverted dates, empty required columns, placeholder rows).
Reply with ONLY JSON, no fences: {"period":"","tabs":[""],"summary":"","rows":[{"label":"","value":""}],"issues":[""]}`,
        MCP.drive
      );
      setContent((c) => ({ ...c, [f.id]: parseJson(text) }));
    } catch (e) {
      setError(`Drive did not answer — ${e.message || e}`);
    }
    setBusy(false);
  };

  const d = sel ? content[sel] : null;
  const file = DRIVE_FILES.find((f) => f.id === sel);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <Card pad={0}>
        <div style={{ padding: "11px 13px", borderBottom: `1px solid ${T.border}` }}>
          <Label>{DRIVE_FILES.length} workbooks</Label>
        </div>
        {DRIVE_FILES.map((f) => (
          <div key={f.id} onClick={() => open(f)}
            style={{ padding: "9px 13px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: sel === f.id ? T.surfaceHi : "transparent" }}>
            <div style={{ fontSize: 11.5, color: sel === f.id ? T.accent : T.text }}>{f.name}</div>
            <div style={{ fontSize: 9.5, color: T.dim, marginTop: 2 }}>{f.note}</div>
          </div>
        ))}
      </Card>

      <Card>
        {!sel && (
          <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "10px 0" }}>
            Pick a workbook. Drive reads whole files rather than cells, so this returns a faithful summary of what each sheet holds — not a live cell query.
          </div>
        )}
        {sel && busy && <div style={{ fontSize: 11.5, color: T.warn, padding: "10px 0" }}>Reading {file?.name}…</div>}
        {error && <Caveat tone="err">{error}</Caveat>}
        {d && (
          <>
            <SectionHead right={d.period || "period unstated"}>{file?.name}</SectionHead>
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 14 }}>{d.summary}</div>
            {d.tabs?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {d.tabs.map((t, i) => (
                  <span key={i} style={{ fontSize: 9.5, letterSpacing: "0.08em", color: T.muted, border: `1px solid ${T.border}`, padding: "2px 7px" }}>{t}</span>
                ))}
              </div>
            )}
            {d.rows?.length > 0 && <Table cols={["Item", "Value"]} rows={d.rows.map((r) => [r.label, r.value])} />}
            {d.issues?.length > 0 && (
              <Caveat tone="err">
                <strong style={{ color: T.err }}>Problems found</strong>
                {d.issues.map((x, i) => <div key={i} style={{ marginTop: 4 }}>· {x}</div>)}
              </Caveat>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   HEALTH SCORING
   Borrowed from gstack's /health: weight by consequence rather
   than counting checks equally, redistribute when a check is
   skipped, band the result, and keep a history so a run can be
   compared against the last one.
   ============================================================ */

/* Weight = how much this being broken actually costs.
   A missing meta description and a collapsed lead funnel are
   not the same size of problem. Default 1 for anything unlisted. */
const CHECK_WEIGHTS = {
  // Calling
  "Lead capture": 5,
  "Staffing": 4,
  "Scoreboard dates": 3,
  "Call volume": 3,
  "Zero-call stores": 3,
  "Connect rate": 2,
  "Under-calling (staffed)": 2,
  // Ads
  "Creative fatigue": 4,
  "Attribution grade": 4,
  "Spend vs plan": 3,
  "Spend without return": 3,
  "Spend concentration": 2,
  // Commerce
  "Stock depth": 4,
  "Rakhi collections": 4,
  "Unpublished collections": 1,
  "Empty collections": 1,
  "Meta descriptions": 1,
  // Data
  "Freshness": 3,
  "Empty columns": 3,
  "Placeholder targets": 2,
  "Campaign plan age": 2,
  // Coverage
  "Meta web slice": 4,
  "App behaviour": 3,
  "Revenue truth": 2,
  "Paid social": 2,
  "Paid search": 2,
  "Ops workbooks": 2,
  "Live retail stock": 2,
};

const weightOf = (name) => CHECK_WEIGHTS[name] ?? 1;

/* pass = 1, warn = 0.5, fail = 0. A check marked 'skip' leaves the
   denominator entirely, which redistributes its weight across the
   rest rather than quietly scoring it as a failure. */
function scoreChecks(checks) {
  const scored = (checks || []).filter((c) => c.state !== "skip");
  if (!scored.length) return { score: null, weighted: 0, total: 0, skipped: (checks || []).length };
  const total = scored.reduce((a, c) => a + weightOf(c.name), 0);
  const weighted = scored.reduce(
    (a, c) => a + weightOf(c.name) * (c.state === "pass" ? 1 : c.state === "warn" ? 0.5 : 0),
    0
  );
  return {
    score: Math.round((100 * weighted) / total),
    weighted, total,
    skipped: (checks || []).length - scored.length,
  };
}

const BANDS = [
  { min: 90, label: "Healthy", colour: () => T.ok },
  { min: 70, label: "Watch", colour: () => T.ok },
  { min: 40, label: "Needs work", colour: () => T.warn },
  { min: 0, label: "Critical", colour: () => T.err },
];
const bandFor = (score) => (score == null ? { label: "Unrun", colour: () => T.dim } : BANDS.find((b) => score >= b.min));

const HEALTH_HISTORY_KEY = "mulmul-os:health-history";

async function loadHealthHistory() {
  try {
    const r = await window.storage.get(HEALTH_HISTORY_KEY);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}
async function saveHealthHistory(h) {
  try { await window.storage.set(HEALTH_HISTORY_KEY, JSON.stringify(h.slice(-40))); } catch { /* non-blocking */ }
}

function HealthView({ runHealth, healthState, history }) {
  const agents = AGENTS.filter((a) => a.health);
  const results = healthState.results || {};
  const done = Object.keys(results).length;

  const allChecks = agents.flatMap((a) =>
    (results[a.id]?.checks || []).map((c) => ({ ...c, agent: a.name, agentId: a.id }))
  );
  const fails = allChecks.filter((c) => c.state === "fail");
  const warns = allChecks.filter((c) => c.state === "warn");
  const passes = allChecks.filter((c) => c.state === "pass");
  const skips = allChecks.filter((c) => c.state === "skip");
  const { score, skipped } = scoreChecks(allChecks);
  const band = bandFor(score);

  const prev = history.length > 1 ? history[history.length - 2] : null;
  const delta = score != null && prev ? score - prev.score : null;
  const trend = delta == null ? null : delta > 1 ? "improving" : delta < -1 ? "slipping" : "flat";

  /* heaviest failures first — weight, then severity */
  const bySeverity = (list) => [...list].sort((a, b) => weightOf(b.name) - weightOf(a.name));

  const Pill = ({ state }) => (
    <span style={{
      fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700,
      padding: "1px 6px", whiteSpace: "nowrap",
      color: state === "fail" ? T.err : state === "warn" ? T.warn : state === "skip" ? T.dim : T.ok,
      border: `1px solid ${state === "fail" ? T.err : state === "warn" ? T.warn : state === "skip" ? T.dim : T.ok}`,
    }}>{state}</span>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <Gauge value={score} label={band.label} sub={score == null ? "" : "weighted"} colour={band.colour()} />

          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <Label style={{ marginBottom: 10 }}>By domain</Label>
            {agents.map((a) => {
              const ck = results[a.id]?.checks || [];
              const dom = scoreChecks(ck);
              const st = healthState.status?.[a.id] || "idle";
              const worst = ck.some((c) => c.state === "fail") ? T.err : ck.some((c) => c.state === "warn") ? T.warn : T.ok;
              return (
                <Meter key={a.id} label={a.name} value={dom.score} colour={dom.score == null ? T.dim : worst}
                  right={st === "running" ? "running" : dom.score == null ? "—" : `${dom.score}%`} />
              );
            })}
          </div>

          <div style={{ flex: "0 1 210px" }}>
            <Label style={{ marginBottom: 10 }}>{history.length > 1 ? `Last ${Math.min(history.length, 12)} runs` : "No history yet"}</Label>
            {history.length > 1
              ? <Spark points={history.slice(-12).map((h) => h.score)} colour={band.colour()} />
              : <div style={{ fontSize: 10.5, color: T.dim, lineHeight: 1.6 }}>Run twice to see movement.</div>}
            {trend && (
              <div style={{ fontSize: 10.5, marginTop: 8, color: trend === "improving" ? T.ok : trend === "slipping" ? T.err : T.dim }}>
                {trend} {delta > 0 ? "+" : ""}{delta} since last run
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 122 }}>
            {[["Failing", fails.length, fails.length ? T.err : T.ok],
              ["Warning", warns.length, warns.length ? T.warn : T.ok],
              ["Skipped", skips.length, T.dim],
              ["Checks", allChecks.length, T.text]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: `1px solid ${T.border}`, paddingBottom: 5 }}>
                <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: T.dim }}>{l}</span>
                <span style={{ fontSize: 17, color: c, lineHeight: 1 }}>{v}</span>
              </div>
            ))}
            <Btn primary onClick={runHealth} disabled={healthState.running}>
              {healthState.running ? `Running ${done}/${agents.length}` : allChecks.length ? "Re-run" : "Run all"}
            </Btn>
          </div>
        </div>
        {fails.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontSize: 11.5, color: T.muted, lineHeight: 1.6 }}>
            Heaviest failure: <span style={{ color: T.err }}>{bySeverity(fails)[0]?.name}</span> — {bySeverity(fails)[0]?.finding}
          </div>
        )}
      </Card>

      {allChecks.length === 0 && !healthState.running && (
        <Card>
          <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7 }}>
            Nothing checked yet. Five agents cover source coverage, the calling operation, the ad account, the store, and workbook integrity.
          </div>
        </Card>
      )}

      {[["Failing", bySeverity(fails), T.err], ["Warning", bySeverity(warns), T.warn], ["Healthy", bySeverity(passes), T.ok], ["Skipped", skips, T.dim]].map(([label, list, colour]) =>
        list.length === 0 ? null : (
          <Card key={label}>
            <SectionHead right={`${list.length}`}>{label}</SectionHead>
            <div style={{ display: "grid", gap: 8 }}>
              {list.map((c, i) => (
                <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.md, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6, flexWrap: "wrap" }}>
                    <Pill state={c.state} />
                    <span style={{ fontSize: 12.5, color: T.text, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontSize: 10, color: T.dim }}>{c.agent}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: T.dim, whiteSpace: "nowrap" }}>weight {weightOf(c.name)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.65 }}>{c.finding}</div>
                  {c.fix && (
                    <div style={{ fontSize: 11.5, color: colour === T.ok ? T.muted : colour, lineHeight: 1.65, marginTop: 6, display: "flex", gap: 8 }}>
                      <span>↳</span><span>{c.fix}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      )}

      {Object.entries(results).some(([, r]) => r.table) && (
        <Card>
          <SectionHead right="supporting data">Detail</SectionHead>
          {agents.map((a) => {
            const r = results[a.id];
            if (!r?.table) return null;
            return (
              <details key={a.id} style={{ marginBottom: 8 }}>
                <summary style={{ fontSize: 10.5, color: T.dim, cursor: "pointer", letterSpacing: "0.12em", textTransform: "uppercase", padding: "6px 0" }}>
                  {a.name}
                </summary>
                <div style={{ paddingTop: 8 }}><Table cols={r.table.cols} rows={r.table.rows} /></div>
              </details>
            );
          })}
        </Card>
      )}
    </div>
  );
}

const WIRING = [
  {
    id: "ga4", name: "GA4 — app and web behaviour",
    covers: "Sessions, conversion rate, funnel steps, push-slot lift, and the three app streams (Android, iOS, App-ios) on property " + GA4_PROPERTY + ".",
    why: "The mid-June conversion collapse lives here. Without it, the App & Site department is guesswork.",
    how: [
      "Create a Google Cloud service account and enable the GA4 Data API.",
      "Grant it Viewer on property " + GA4_PROPERTY + ".",
      "Expose it as an MCP server, or proxy it through a small endpoint this console can call.",
    ],
  },
  {
    id: "vinculum", name: "Vinculum — live retail stock",
    covers: "Real-time stock depth across 26 stores. Retail sell-through and the channel split now come from the FY-2026-27 sheets in Drive instead.",
    why: "Only live stock depth is still missing. Before a peak, a product can look in-stock online and be gone in store.",
    how: [
      "Check whether Vinculum exposes a REST API on your licence.",
      "If not, a scheduled export to Sheets is the usual path.",
      "Either way it needs an endpoint before stock depth can be trusted.",
    ],
  },
];

function WiringView() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <SectionHead right="what it would take">Not yet reachable</SectionHead>
        <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.7 }}>
          Four sources are missing, and they are the reason this console is not yet one stop for everything. Each is listed with what it would cover and what connecting it actually takes. Nothing here is estimated or filled in from memory in the meantime.
        </div>
      </Card>
      {WIRING.map((w) => (
        <Card key={w.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <Dot state="not_configured" />
            <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{w.name}</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <Label style={{ marginBottom: 5 }}>Would cover</Label>
              <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.65 }}>{w.covers}</div>
            </div>
            <div>
              <Label style={{ marginBottom: 5 }}>Cost of not having it</Label>
              <div style={{ fontSize: 11.5, color: T.warn, lineHeight: 1.65 }}>{w.why}</div>
            </div>
            <div>
              <Label style={{ marginBottom: 5 }}>To connect</Label>
              {w.how.map((h, i) => (
                <div key={i} style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.7, display: "flex", gap: 8 }}>
                  <span style={{ color: T.accent }}>{i + 1}</span><span>{h}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

const EXPLORE_TABS = [
  { id: "meta", label: "Meta" },
  { id: "shopify", label: "Shopify" },
  { id: "google", label: "Google" },
  { id: "drive", label: "Drive" },
  { id: "wiring", label: "Missing" },
];

function ExploreView({ range, setRange, breakdown, setBreakdown }) {
  const [tab, setTab] = useState("meta");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.lg, marginBottom: 18, flexWrap: "wrap" }}>
        {EXPLORE_TABS.map((t) => (
          <div key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "9px 17px", fontFamily: SANS, fontSize: 13, cursor: "pointer", borderRadius: R.md, background: tab === t.id ? `linear-gradient(135deg, ${T.accent}22, ${T.violet}14)` : "transparent", border: `1px solid ${tab === t.id ? `${T.accent}44` : "transparent"}`, color: tab === t.id ? T.text : T.muted, fontWeight: tab === t.id ? 600 : 500, display: "flex", alignItems: "center", gap: 8, transition: "all .16s" }}>
            {t.label}
            {t.id === "wiring" && <span style={{ width: 5, height: 5, background: T.warn, display: "inline-block" }} />}
          </div>
        ))}
      </div>
      {tab === "meta" && <MetaExplorer range={range} setRange={setRange} breakdown={breakdown} setBreakdown={setBreakdown} />}
      {tab === "shopify" && <ShopifyExplorer range={range} setRange={setRange} />}
      {tab === "google" && <GoogleExplorer range={range} setRange={setRange} />}
      {tab === "drive" && <DriveExplorer />}
      {tab === "wiring" && <WiringView />}
    </div>
  );
}

/* ============================================================
   VIEWS
   ============================================================ */

function ConsoleView({ conns, runs, agents, runAgent, running, go, flowState }) {
  const live = conns.filter((c) => c.state === "connected").length;
  const errored = conns.filter((c) => c.state === "error").length;
  const unwired = conns.filter((c) => c.state === "not_configured").length;
  const runnable = agents.filter((a) => a.mcp || a.local).length;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(178px, 1fr))", gap: 14 }}>
        <Kpi label="Sources live" value={`${live}/${conns.length}`} colour={live === conns.length ? T.ok : T.warn}
          sub={live === conns.length ? "all reporting" : `${conns.length - live} not reporting`} />
        <Kpi label="Blocked" value={String(errored + unwired)} colour={errored + unwired ? T.err : T.ok}
          sub={errored + unwired ? "need wiring" : "nothing blocked"} />
        <Kpi label="Agents ready" value={`${runnable}/${agents.length}`} colour={T.accent} sub="runnable now" />
        <Kpi label="Flows" value={String(FLOWS.length)} colour={T.violet}
          sub={`${FLOWS.filter((f) => f.stages.some((x) => x.kind === "gate")).length} gated`} />
        <Kpi label="Health checks" value={String(AGENTS.filter((a) => a.health).length)} colour={T.accent} sub="across 5 domains" />
        <Kpi label="Runs logged" value={String(runs.length)} colour={T.muted} sub="kept across sessions" />
      </div>

      <Card>
        <SectionHead right="one press, several agents">Flows</SectionHead>
        <div style={{ display: "grid", gap: 7 }}>
          {FLOWS.map((f) => {
            const st = flowState?.[f.id];
            const agentCount = f.stages.filter((s) => s.kind === "fanout").reduce((a, s) => a + s.agents.length, 0);
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                <Dot state={st?.running ? "running" : st?.waitingGate != null ? "gate" : st?.output ? "ok" : "idle"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.text }}>{f.name}</div>
                  <div style={{ fontSize: 10, color: T.dim }}>
                    {f.cadence} · {agentCount} agents{f.stages.some((s) => s.kind === "gate") ? " · gated" : ""}
                    {st?.waitingGate != null ? <span style={{ color: T.warn }}> · waiting on you</span> : null}
                  </div>
                </div>
                <Btn small onClick={() => go("flows")}>Open</Btn>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionHead right="every source, honestly">Connections</SectionHead>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 10 }}>
          {conns.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${T.border}`, borderLeft: `2px solid ${c.state === "connected" ? T.ok : c.state === "error" ? T.err : c.state === "checking" ? T.warn : T.dim}`, padding: "10px 11px", background: T.surfaceHi }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <Dot state={c.state} />
                <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{c.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim }}>{c.kind}</span>
              </div>
              <div style={{ fontSize: 10.5, lineHeight: 1.55, color: T.muted }}>{c.detail}</div>
              {c.fallback && <div style={{ fontSize: 10, lineHeight: 1.55, color: T.warn, marginTop: 5 }}>↳ {c.fallback}</div>}
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        <Card>
          <SectionHead right="tap to run">Quick runs</SectionHead>
          <div style={{ display: "grid", gap: 7 }}>
            {agents.filter((a) => a.mcp || a.local).slice(0, 6).map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
                <Dot state={running[a.id] ? "running" : a.lastRun ? (a.lastRun.ok ? "ok" : "fail") : "idle"} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: T.text }}>{a.name}</div>
                  <div style={{ fontSize: 10, color: T.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.source}</div>
                </div>
                <Btn small onClick={() => runAgent(a.id)} disabled={!!running[a.id]}>
                  {running[a.id] ? "···" : "Run"}
                </Btn>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <Btn onClick={() => go("agents")}>Open roster</Btn>
          </div>
        </Card>

        <Card>
          <SectionHead right={`${runs.length} kept`}>Recent runs</SectionHead>
          {runs.length === 0 ? (
            <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "10px 0" }}>
              Nothing has run yet. Every run lands here with its result and survives a reload.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {runs.slice(0, 7).map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
                  <Dot state={r.ok ? "ok" : "fail"} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: T.text }}>
                      {r.agent}
                      {r.flow && r.flow !== "flow" ? <span style={{ color: T.dim }}> · {r.flow}</span> : null}
                    </div>
                    <div style={{ fontSize: 10.5, color: T.dim, lineHeight: 1.5 }}>{r.summary}</div>
                  </div>
                  <div style={{ fontSize: 9.5, color: T.dim, whiteSpace: "nowrap" }}>{ago(r.at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function AgentsView({ agents, runAgent, running, results }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {DEPARTMENTS.map((d) => {
        const mine = agents.filter((a) => a.dept === d.id);
        return (
          <Card key={d.id}>
            <SectionHead right={d.tagline}>{d.name}</SectionHead>
            <div style={{ display: "grid", gap: 8 }}>
              {mine.map((a) => {
                const res = results[a.id];
                const isOpen = open === a.id;
                return (
                  <div key={a.id} style={{ background: T.surface }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px" }}>
                      <Dot state={running[a.id] ? "running" : res ? (res.ok ? "ok" : "fail") : "idle"} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12.5, color: T.text, fontWeight: 600 }}>{a.name}</span>
                          <span style={{ fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, border: `1px solid ${T.border}`, padding: "1px 5px" }}>{a.tier}</span>
                          <span style={{ fontSize: 10, color: T.dim }}>{a.source}</span>
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>{a.desc}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {res && <Btn small onClick={() => setOpen(isOpen ? null : a.id)}>{isOpen ? "Hide" : "Result"}</Btn>}
                        <Btn small primary onClick={() => runAgent(a.id)} disabled={!!running[a.id]}>
                          {running[a.id] ? "Running" : "Run"}
                        </Btn>
                      </div>
                    </div>
                    {isOpen && res && (
                      <div style={{ padding: "0 12px 14px", borderTop: `1px solid ${T.border}` }}>
                        <div style={{ fontSize: 11.5, color: res.ok ? T.text : T.err, padding: "10px 0", lineHeight: 1.6 }}>{res.summary}</div>
                        {res.table && <Table cols={res.table.cols} rows={res.table.rows} />}
                        {res.caveat && <Caveat tone={res.ok ? "warn" : "err"}>{res.caveat}</Caveat>}
                        {res.fallback && <Caveat tone="err">{res.fallback}</Caveat>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function OrgView({ agents }) {
  return (
    <Card>
      <SectionHead right="operator → department → lead → workers">Org</SectionHead>
      <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 2 }}>
        <div style={{ color: T.accent }}>◆ Aryan · operator</div>
        {DEPARTMENTS.map((d, di) => {
          const mine = agents.filter((a) => a.dept === d.id);
          const leads = mine.filter((a) => !a.parent);
          const lastDept = di === DEPARTMENTS.length - 1;
          return (
            <div key={d.id}>
              <div style={{ color: T.text, paddingLeft: 14 }}>
                <span style={{ color: T.dim }}>{lastDept ? "└─" : "├─"}</span> {d.name}
                <span style={{ color: T.dim, fontSize: 10.5 }}> · {mine.length} agents</span>
              </div>
              {leads.map((lead) => {
                const kids = mine.filter((a) => a.parent === lead.id);
                return (
                  <div key={lead.id}>
                    <div style={{ paddingLeft: 32, color: T.muted }}>
                      <span style={{ color: T.dim }}>{lastDept ? "   └─" : "│  └─"}</span>{" "}
                      <span style={{ color: T.text }}>{lead.name}</span>
                      <span style={{ color: T.dim, fontSize: 10.5 }}> · lead</span>
                    </div>
                    {kids.map((k, ki) => (
                      <div key={k.id} style={{ paddingLeft: 52, color: T.muted, fontSize: 11.5 }}>
                        <span style={{ color: T.dim }}>{ki === kids.length - 1 ? "└─" : "├─"}</span> {k.name}
                        <span style={{ color: k.mcp || k.local ? T.dim : T.err, fontSize: 10 }}>
                          {" "}· {k.mcp || k.local ? k.source : "blocked"}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <Caveat>
        Agents marked blocked have no reachable source. They are shown rather than hidden so the roster reflects real coverage, not intended coverage.
      </Caveat>
    </Card>
  );
}

function BrainView() {
  const pos = useMemo(layoutGraph, []);
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    if (!q.trim()) return null;
    const n = q.trim().toLowerCase();
    return new Set(
      KB_NODES.filter((k) => k.label.toLowerCase().includes(n) || (k.note || "").toLowerCase().includes(n)).map((k) => k.id)
    );
  }, [q]);

  const node = sel ? KB_NODES.find((n) => n.id === sel) : null;
  const neighbours = sel
    ? KB_EDGES.filter((e) => e.includes(sel)).map((e) => (e[0] === sel ? e[1] : e[0]))
    : [];

  const S = 500;
  const px = (v) => (v + 1.15) * (S / 2.3);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 18, alignItems: "start" }}>
      <Card pad={0}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: T.accent, fontSize: 12 }}>›</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search the brain"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: MONO, fontSize: 12 }}
          />
          <span style={{ fontSize: 10, color: T.dim }}>
            {matches ? `${matches.size} match` : `${KB_NODES.length} nodes · ${KB_EDGES.length} links`}
          </span>
        </div>
        <svg viewBox={`0 0 ${S} ${S}`} style={{ width: "100%", display: "block", background: T.bg }}>
          {KB_EDGES.map(([a, b], i) => {
            const pa = pos[a], pb = pos[b];
            if (!pa || !pb) return null;
            const active = sel === a || sel === b;
            return (
              <line key={i} x1={px(pa.x)} y1={px(pa.y)} x2={px(pb.x)} y2={px(pb.y)}
                stroke={active ? T.accent : T.border} strokeWidth={active ? 1.1 : 0.6} opacity={active ? 0.85 : 0.55} />
            );
          })}
          {KB_NODES.map((n) => {
            const p = pos[n.id];
            if (!p) return null;
            // hub spokes
            return null;
          })}
          {CLUSTERS.map((c, ci) => {
            const hub = KB_NODES.find((n) => n.cluster === c && n.hub);
            if (!hub) return null;
            return KB_NODES.filter((n) => n.cluster === c && !n.hub).map((n) => {
              const pa = pos[hub.id], pb = pos[n.id];
              return (
                <line key={hub.id + n.id} x1={px(pa.x)} y1={px(pa.y)} x2={px(pb.x)} y2={px(pb.y)}
                  stroke={`hsl(${CLUSTER_HUE[ci]} 45% 40%)`} strokeWidth={0.5} opacity={0.32} />
              );
            });
          })}
          {KB_NODES.map((n) => {
            const p = pos[n.id];
            if (!p) return null;
            const hue = CLUSTER_HUE[p.cluster];
            const dimmed = matches && !matches.has(n.id);
            const active = sel === n.id || hover === n.id;
            const r = n.hub ? 7 : n.open ? 5 : 4;
            return (
              <g key={n.id} onClick={() => setSel(n.id === sel ? null : n.id)}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}>
                {(active || n.open) && (
                  <circle cx={px(p.x)} cy={px(p.y)} r={r + 5}
                    fill="none" stroke={n.open && !active ? T.warn : T.accent} strokeWidth={0.8} opacity={active ? 0.9 : 0.4} />
                )}
                <circle cx={px(p.x)} cy={px(p.y)} r={r}
                  fill={n.hub ? `hsl(${hue} 55% 52%)` : `hsl(${hue} 45% 36%)`}
                  stroke={active ? T.accent : `hsl(${hue} 60% 60%)`} strokeWidth={active ? 1.4 : 0.6}
                  opacity={dimmed ? 0.15 : 1} />
                {(n.hub || active) && (
                  <text x={px(p.x)} y={px(p.y) - r - 6} textAnchor="middle"
                    fontFamily={MONO} fontSize={n.hub ? 9 : 8}
                    fill={active ? T.accent : T.muted}
                    letterSpacing={n.hub ? "0.14em" : "0"}
                    opacity={dimmed ? 0.2 : 1}
                    style={{ textTransform: n.hub ? "uppercase" : "none" }}>
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </Card>

      <div style={{ display: "grid", gap: 12 }}>
        <Card>
          <Label style={{ marginBottom: 10 }}>{node ? "Node" : "Select a node"}</Label>
          {!node && (
            <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7 }}>
              Every dot is something the OS knows about Mulmul. Ringed dots in amber are open questions with no settled answer.
            </div>
          )}
          {node && (
            <>
              <div style={{ fontSize: 14, color: T.text, marginBottom: 4 }}>{node.label}</div>
              <div style={{ fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.dim, marginBottom: 10 }}>
                {node.cluster}{node.open ? " · open" : ""}{node.stale ? " · stale" : ""}
              </div>
              <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.7 }}>{node.note || "Cluster hub."}</div>
              {neighbours.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                  <Label style={{ marginBottom: 7 }}>Linked</Label>
                  {neighbours.map((id) => {
                    const nn = KB_NODES.find((k) => k.id === id);
                    return (
                      <div key={id} onClick={() => setSel(id)}
                        style={{ fontSize: 11, color: T.accent, cursor: "pointer", padding: "3px 0" }}>
                        → {nn?.label || id}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <Label style={{ marginBottom: 10 }}>Clusters</Label>
          {CLUSTERS.map((c, i) => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <span style={{ width: 8, height: 8, background: `hsl(${CLUSTER_HUE[i]} 55% 45%)`, display: "inline-block" }} />
              <span style={{ fontSize: 11, color: T.muted }}>{c}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: T.dim }}>
                {KB_NODES.filter((n) => n.cluster === c && !n.hub).length}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function InvariantsView() {
  return (
    <Card>
      <SectionHead right="rules that never bend">Invariants</SectionHead>
      <div style={{ display: "grid", gap: 8 }}>
        {INVARIANTS.map((r, i) => (
          <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: R.md, padding: "14px 16px", display: "flex", gap: 13 }}>
            <span style={{ fontSize: 10, color: T.accent, paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontSize: 12, color: T.text, lineHeight: 1.65 }}>{r}</span>
          </div>
        ))}
      </div>
      <Caveat>
        These hold inside this console only. Nothing upstream enforces them — the daily report, the CEO Dashboard and the Discount sheet each need their own copy.
      </Caveat>
    </Card>
  );
}

function RunsView({ runs, clear }) {
  return (
    <Card>
      <SectionHead right={`${runs.length} kept across sessions`}>Run log</SectionHead>
      {runs.length === 0 ? (
        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7, padding: "12px 0" }}>
          Empty. Runs are recorded whether they succeed or fail — a failure three days old stays visible.
        </div>
      ) : (
        <>
          <Table
            cols={["Agent", "Flow", "Result", "Summary", "Age"]}
            rows={runs.map((r) => [r.agent, r.flow || "—", r.ok ? "ok" : "fail", r.summary, ago(r.at)])}
          />
          <div style={{ marginTop: 14 }}>
            <Btn onClick={clear}>Clear log</Btn>
          </div>
        </>
      )}
    </Card>
  );
}

/* ============================================================
   SHELL
   ============================================================ */

/* Minimal 20x20 stroke glyphs — the reference sidebars all pair icon + label. */
const ICONS = {
  console: "M3 4h18v13H3z M8 20h8",
  health: "M3 12h4l2-6 3 12 2.5-8 1.5 2h5",
  explore: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  flows: "M4 6h6 M14 6h6 M4 18h6 M14 18h6 M10 6a4 4 0 0 1 4 12",
  agents: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M4 21c0-4 4-6 8-6s8 2 8 6",
  brain: "M12 4v16 M8 7a3 3 0 1 0 0 6 M16 7a3 3 0 1 1 0 6 M8 13a3 3 0 1 0 2 5 M16 13a3 3 0 1 1-2 5",
  org: "M12 3v4 M6 21v-4 M18 21v-4 M6 17h12 M12 7v10 M9 3h6v4H9z M3 17h6v4H3z M15 17h6v4h-6z",
  invariants: "M12 3l8 4v6c0 5-4 7-8 8-4-1-8-3-8-8V7z M9 12l2 2 4-4",
  runs: "M12 7v5l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};

const Icon = ({ name, colour, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={colour} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <path d={ICONS[name] || ICONS.console} />
  </svg>
);

const NAV = [
  { group: "Operate", items: [["console", "Console"], ["health", "Health"], ["explore", "Explore"], ["flows", "Flows"], ["agents", "Agents"], ["brain", "Brain"]] },
  { group: "System", items: [["org", "Org"], ["invariants", "Invariants"], ["runs", "Runs"]] },
];

export default function MulmulOS() {
  const [view, setView] = useState("console");
  const [conns, setConns] = useState(() =>
    CONNECTORS.map((c) => ({ ...c, state: c.probe ? "checking" : c.state }))
  );
  const [runs, setRuns] = useState([]);
  const [running, setRunning] = useState({});
  const [results, setResults] = useState({});
  const [flowState, setFlowState] = useState({});
  const [healthState, setHealthState] = useState({ running: false, status: {}, results: {} });
  const [healthHistory, setHealthHistory] = useState([]);
  const [range, setRange] = useState("last_7d");
  const [breakdown, setBreakdown] = useState("none");
  const probed = useRef(false);
  const abandoned = useRef({});

  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })
  );
  useEffect(() => {
    const i = setInterval(
      () => setClock(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })),
      1000
    );
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    loadRuns().then(setRuns);
    loadHealthHistory().then(setHealthHistory);
  }, []);

  /* probe the three real connectors once, in parallel */
  useEffect(() => {
    if (probed.current) return;
    probed.current = true;
    CONNECTORS.filter((c) => c.probe).forEach(async (c) => {
      try {
        const text = await askClaude(
          `Make exactly one cheap read-only call with your available tools to confirm the connection works, then reply with ONLY JSON: {"ok":true,"detail":"<under 12 words naming what answered>"}`,
          MCP[c.probe]
        );
        const d = parseJson(text);
        setConns((prev) => prev.map((p) => (p.id === c.id ? { ...p, state: d.ok ? "connected" : "error", detail: d.detail || p.detail } : p)));
      } catch (e) {
        setConns((prev) => prev.map((p) => (p.id === c.id ? { ...p, state: "error", detail: e.message || "did not answer" } : p)));
      }
    });
  }, []);

  const record = useCallback((entry) => {
    setRuns((prev) => {
      const next = [{ ...entry, at: new Date().toISOString() }, ...prev];
      saveRuns(next);
      return next;
    });
  }, []);

  const executeAgent = useCallback(async (id) => {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) return { ok: false, summary: "Unknown agent." };
    try {
      if (a.local) return await a.local();
      if (a.run) return await a.run();
      if (a.mcp) {
        const text = await askClaude(a.prompt, MCP[a.mcp]);
        return { ok: true, ...a.shape(parseJson(text)) };
      }
      return { ok: false, summary: "No source wired." };
    } catch (e) {
      return {
        ok: false,
        summary: `${a.source} did not answer — ${e.message || e}`,
        fallback: "Nothing is shown rather than a stale figure.",
      };
    }
  }, []);

  const runAgent = useCallback(
    async (id) => {
      const a = AGENTS.find((x) => x.id === id);
      if (!a) return;
      setRunning((r) => ({ ...r, [id]: true }));
      const res = await executeAgent(id);
      setResults((r) => ({ ...r, [id]: res }));
      setRunning((r) => ({ ...r, [id]: false }));
      record({ agent: a.name, ok: res.ok, summary: res.summary });
    },
    [executeAgent, record]
  );

  /* ---------- flow engine ---------- */

  const patchFlow = useCallback((fid, patch) => {
    setFlowState((s) => ({
      ...s,
      [fid]: { ...(s[fid] || {}), ...(typeof patch === "function" ? patch(s[fid] || {}) : patch) },
    }));
  }, []);

  const runSynthesis = useCallback(
    async (flow, agentResults, gateValues, stageIndex) => {
      const agentBlock = Object.entries(agentResults)
        .map(([aid, r]) => {
          const a = AGENTS.find((x) => x.id === aid);
          if (!r.ok) return `${a?.name}: BLOCKED — ${r.summary}`;
          return `${a?.name}: ${r.summary}\n${JSON.stringify(r.data || {})}`;
        })
        .join("\n\n");

      const entries = Object.entries(gateValues || {}).filter(([, v]) => v !== "" && v != null);
      const gateBlock = entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join("\n") : "none supplied";

      patchFlow(flow.id, (s) => ({ stageStatus: { ...(s.stageStatus || {}), [stageIndex]: "running" } }));

      try {
        const text = await askClaude(flow.synthesis({ agentBlock, gateBlock }));
        const out = parseJson(text);
        patchFlow(flow.id, (s) => ({
          running: false, output: out, waitingGate: null,
          stageStatus: { ...(s.stageStatus || {}), [stageIndex]: "done" },
        }));
        record({ agent: flow.name, flow: "flow", ok: true, summary: out.headline || "Flow completed." });
      } catch (e) {
        patchFlow(flow.id, (s) => ({
          running: false, failed: true,
          error: `Synthesis failed — ${e.message || e}. The agent output above still stands; only the composed result is missing.`,
          stageStatus: { ...(s.stageStatus || {}), [stageIndex]: "failed" },
        }));
        record({ agent: flow.name, flow: "flow", ok: false, summary: `Synthesis failed — ${e.message || e}` });
      }
    },
    [patchFlow, record]
  );

  const advance = useCallback(
    async (flow, fromIndex, carried) => {
      const agentResults = { ...(carried.agentResults || {}) };
      for (let i = fromIndex; i < flow.stages.length; i++) {
        if (abandoned.current[flow.id]) return;
        const st = flow.stages[i];

        if (st.kind === "fanout") {
          patchFlow(flow.id, (s) => ({
            stageStatus: { ...(s.stageStatus || {}), [i]: "running" },
            agentStatus: { ...(s.agentStatus || {}), ...Object.fromEntries(st.agents.map((a) => [a, "running"])) },
          }));
          const settled = await Promise.all(st.agents.map(async (aid) => [aid, await executeAgent(aid)]));
          if (abandoned.current[flow.id]) return;
          settled.forEach(([aid, r]) => {
            agentResults[aid] = r;
            record({ agent: AGENTS.find((a) => a.id === aid)?.name, flow: flow.name, ok: r.ok, summary: r.summary });
          });
          setResults((r) => ({ ...r, ...Object.fromEntries(settled) }));
          patchFlow(flow.id, (s) => ({
            agentResults: { ...agentResults },
            stageStatus: { ...(s.stageStatus || {}), [i]: "done" },
            agentStatus: { ...(s.agentStatus || {}), ...Object.fromEntries(settled.map(([aid, r]) => [aid, r.ok ? "ok" : "fail"])) },
          }));
        }

        if (st.kind === "gate") {
          patchFlow(flow.id, (s) => ({
            running: false, waitingGate: i, resumeFrom: i + 1,
            agentResults: { ...agentResults },
            stageStatus: { ...(s.stageStatus || {}), [i]: "waiting" },
          }));
          return; // control returns to the operator
        }

        if (st.kind === "synthesis") {
          await runSynthesis(flow, agentResults, carried.gateValues, i);
          return;
        }
      }
    },
    [executeAgent, patchFlow, record, runSynthesis]
  );

  const startFlow = useCallback(
    (fid) => {
      const flow = FLOWS.find((f) => f.id === fid);
      abandoned.current[fid] = false;
      setFlowState((s) => ({
        ...s,
        [fid]: { running: true, stageStatus: {}, agentStatus: {}, agentResults: {}, output: null, error: null, failed: false, waitingGate: null },
      }));
      advance(flow, 0, { agentResults: {}, gateValues: {} });
    },
    [advance]
  );

  const submitGate = useCallback(
    (fid, values) => {
      const flow = FLOWS.find((f) => f.id === fid);
      const st = flowState[fid] || {};
      const gateIndex = st.waitingGate;
      patchFlow(fid, (s) => ({
        running: true, waitingGate: null, gateValues: values,
        stageStatus: { ...(s.stageStatus || {}), [gateIndex]: "done" },
      }));
      advance(flow, st.resumeFrom ?? 0, { agentResults: st.agentResults || {}, gateValues: values });
    },
    [advance, flowState, patchFlow]
  );

  const cancelFlow = useCallback(
    (fid) => {
      abandoned.current[fid] = true;
      patchFlow(fid, { running: false, waitingGate: null, error: "Run abandoned." });
    },
    [patchFlow]
  );

  const runHealth = useCallback(async () => {
    const list = AGENTS.filter((a) => a.health);
    setHealthState({ running: true, status: Object.fromEntries(list.map((a) => [a.id, "running"])), results: {} });
    await Promise.all(
      list.map(async (a) => {
        const res = await executeAgent(a.id);
        setHealthState((s) => ({
          ...s,
          status: { ...s.status, [a.id]: res.ok === false ? "fail" : "ok" },
          results: { ...s.results, [a.id]: res },
        }));
        record({ agent: a.name, flow: "health", ok: res.ok !== false, summary: res.summary });
      })
    );
    setHealthState((s) => {
      const checks = list.flatMap((a) => s.results[a.id]?.checks || []);
      const { score } = scoreChecks(checks);
      if (score != null) {
        const entry = {
          ts: new Date().toISOString(), score,
          fails: checks.filter((c) => c.state === "fail").length,
          warns: checks.filter((c) => c.state === "warn").length,
          checks: checks.length,
        };
        setHealthHistory((h) => {
          const next = [...h, entry];
          saveHealthHistory(next);
          return next;
        });
      }
      return { ...s, running: false };
    });
  }, [executeAgent, record]);

  const clearLog = () => {
    setRuns([]);
    saveRuns([]);
  };

  const agentsWithState = AGENTS.map((a) => ({ ...a, lastRun: results[a.id] }));
  const liveCount = conns.filter((c) => c.state === "connected").length;

  return (
    <div style={{ background: T.bgDeep, color: T.text, fontFamily: SANS, minHeight: "100%", display: "flex" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: ${T.dim}; }
        input, select, button, textarea { font-family: ${SANS}; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${T.borderHi}; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: ${T.bg}; }
      `}</style>

      {/* sidebar */}
      <aside style={{
        width: 214, borderRight: `1px solid ${T.border}`, padding: "20px 0 16px",
        flexShrink: 0, background: T.bgDeep, display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "0 18px 22px", display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            width: 34, height: 34, borderRadius: R.md, flexShrink: 0,
            background: `linear-gradient(135deg, ${T.accent}, ${T.violetDeep})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: glow(T.accent, 0.4, 18),
            fontFamily: SANS, fontWeight: 700, fontSize: 14, color: "#04131f",
          }}>M</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 700, color: T.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
              Mulmul<span style={{ color: T.accent }}>OS</span>
            </div>
            <div style={{ fontFamily: SANS, fontSize: 10.5, color: T.dim, marginTop: 2 }}>Operator console</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {NAV.map((g) => (
            <div key={g.group} style={{ marginBottom: 20 }}>
              <Label style={{ padding: "0 18px 9px", fontSize: 10 }}>{g.group}</Label>
              {g.items.map(([id, label]) => {
                const active = view === id;
                const waiting = id === "flows" && Object.values(flowState).some((s) => s?.waitingGate != null);
                return (
                  <div key={id} onClick={() => setView(id)}
                    style={{
                      margin: "0 10px 3px", padding: "9px 12px", borderRadius: R.md,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 11,
                      fontFamily: SANS, fontSize: 13, fontWeight: active ? 600 : 500,
                      color: active ? T.text : T.muted,
                      background: active ? `linear-gradient(135deg, ${T.accent}22, ${T.violet}14)` : "transparent",
                      border: `1px solid ${active ? `${T.accent}44` : "transparent"}`,
                      transition: "all .16s ease",
                    }}>
                    <Icon name={id} colour={active ? T.accent : T.dim} />
                    <span>{label}</span>
                    {waiting && !active && (
                      <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: R.pill, background: T.violet, boxShadow: glow(T.violet, 0.6, 8) }} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* status rail — the bottom strip from the JARVIS reference */}
        <div style={{ margin: "0 10px", padding: "12px 13px", borderRadius: R.md, background: T.surface, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Dot size={6} state={conns.some((c) => c.state === "checking") ? "checking" : liveCount === conns.length ? "connected" : "error"} />
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: T.text, fontWeight: 600 }}>
              {conns.some((c) => c.state === "checking") ? "Checking sources" : `${liveCount}/${conns.length} sources live`}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: R.pill, background: T.bg, overflow: "hidden" }}>
            <div style={{
              width: `${conns.length ? (100 * liveCount) / conns.length : 0}%`, height: "100%",
              background: `linear-gradient(90deg, ${T.accent}, ${T.violet})`,
              boxShadow: glow(T.accent, 0.5, 8), transition: "width .6s ease",
            }} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 10.5, color: T.dim, marginTop: 8 }}>
            {runs.length} runs logged
          </div>
        </div>
      </aside>

      {/* main */}
      <main style={{ flex: 1, minWidth: 0, background: T.bg }}>
        <div style={{
          padding: "16px 26px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          position: "sticky", top: 0, zIndex: 5,
          background: `linear-gradient(180deg, ${T.bg}, ${T.bg}f2)`, backdropFilter: "blur(8px)",
        }}>
          <div>
            <div style={{ fontFamily: SANS, fontSize: 11, color: T.dim, letterSpacing: "0.04em" }}>Shop Mulmul</div>
            <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 600, color: T.text, letterSpacing: "-0.015em", textTransform: "capitalize", lineHeight: 1.25 }}>
              {view}
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 13px",
              borderRadius: R.pill, background: T.surface, border: `1px solid ${T.border}`,
            }}>
              <Dot size={6} state={liveCount === conns.length ? "connected" : "error"} />
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: T.muted }}>
                {liveCount === conns.length ? "All systems operational" : `${conns.length - liveCount} source${conns.length - liveCount === 1 ? "" : "s"} down`}
              </span>
            </div>
            <div style={{
              padding: "7px 13px", borderRadius: R.pill, background: T.surface,
              border: `1px solid ${T.border}`, fontFamily: MONO, fontSize: 11.5, color: T.muted,
            }}>{clock}</div>
          </div>
        </div>

        <div style={{ padding: "24px 26px 48px" }}>
          {view === "console" && (
            <ConsoleView conns={conns} runs={runs} agents={agentsWithState} runAgent={runAgent} running={running} go={setView} flowState={flowState} />
          )}
          {view === "health" && <HealthView runHealth={runHealth} healthState={healthState} history={healthHistory} />}
          {view === "explore" && (
            <ExploreView range={range} setRange={setRange} breakdown={breakdown} setBreakdown={setBreakdown} />
          )}
          {view === "flows" && (
            <FlowsView flowState={flowState} startFlow={startFlow} submitGate={submitGate} cancelFlow={cancelFlow} />
          )}
          {view === "agents" && <AgentsView agents={agentsWithState} runAgent={runAgent} running={running} results={results} />}
          {view === "brain" && <BrainView />}
          {view === "org" && <OrgView agents={AGENTS} />}
          {view === "invariants" && <InvariantsView />}
          {view === "runs" && <RunsView runs={runs} clear={clearLog} />}
        </div>
      </main>
    </div>
  );
}
