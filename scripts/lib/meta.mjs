/* ============================================================
   Meta Marketing API client.

   ⚠ VERSION: Graph API versions advance roughly quarterly and I
   cannot verify the current one from here. If the first run fails
   with "Unsupported get request" or an unknown-version error,
   change META_API_VERSION — it is an env var, no code edit needed.
   Everything else is stable across versions.

   Auth: a System User access token with ads_read on the account.
   ============================================================ */

const VERSION = process.env.META_API_VERSION || "v23.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const BASE = `https://graph.facebook.com/${VERSION}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params) {
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN is not set — add it as a GitHub Secret.");
  const qs = new URLSearchParams({ ...params, access_token: TOKEN });
  const url = `${BASE}${path}?${qs}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error(`Non-JSON (${res.status}) — ${text.slice(0, 200)}`); }

    if (body.error) {
      const e = body.error;
      /* 4 = app rate limit, 17 = user rate limit, 613 = throttled.
         1 and 2 are Meta's generic "unknown error", which in practice
         means the request was too heavy or a backend hiccuped — both
         clear on retry, so they belong here rather than failing the run. */
      if ([1, 2, 4, 17, 613].includes(e.code) || e.is_transient) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      const hint = e.code === 190 ? " — token invalid or expired."
        : e.code === 200 ? " — the token is missing ads_read on this account."
        : e.code === 2635 || /version/i.test(e.message || "") ? " — try a different META_API_VERSION."
        : "";
      throw new Error(`Meta ${e.code}: ${e.message}${hint}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    return body;
  }
  throw new Error("Meta rate-limited us after 5 attempts.");
}

/**
 * Daily insights, one row per campaign per day.
 *
 * action_attribution_windows is set to 7d_click explicitly. Meta's
 * default is unified attribution, which folds in view-through and
 * cross-device and reads materially higher than the Ads Manager
 * "7-day click" column the reports use.
 */
/**
 * Split a range into chunks of at most `days`.
 *
 * A four-month pull of daily campaign rows with action breakdowns is
 * enough work that Meta returns error 1 rather than a result. Asking a
 * month at a time succeeds where one large request does not.
 */
export function chunkRange(since, until, days = 31) {
  const out = [];
  let start = new Date(since + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  while (start <= end) {
    const stop = new Date(Math.min(
      start.getTime() + (days - 1) * 86400000, end.getTime()));
    out.push({ since: start.toISOString().slice(0, 10), until: stop.toISOString().slice(0, 10) });
    start = new Date(stop.getTime() + 86400000);
  }
  return out;
}

export async function fetchInsights({ accountId, since, until, level = "campaign", chunkDays = 31 }) {
  const chunks = chunkRange(since, until, chunkDays);
  if (chunks.length > 1) {
    console.log(`  range split into ${chunks.length} chunks of ≤${chunkDays} days — Meta rejects one large request`);
    const all = [];
    for (const c of chunks) {
      process.stdout.write(`    ${c.since} → ${c.until} … `);
      const rows = await fetchInsightsChunk({ accountId, since: c.since, until: c.until, level });
      console.log(`${rows.length} rows`);
      all.push(...rows);
    }
    return all;
  }
  return fetchInsightsChunk({ accountId, since, until, level });
}

async function fetchInsightsChunk({ accountId, since, until, level = "campaign" }) {
  const params = {
    level,
    time_increment: "1",                       // one row per day
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(["7d_click"]),
    fields: [
      "date_start", "campaign_id", "campaign_name", "objective",
      "spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm",
      "actions", "action_values",
    ].join(","),
    limit: "500",
  };

  const out = [];
  let path = `/act_${accountId}/insights`, page = params, guard = 0;
  while (path && guard++ < 60) {
    const body = await get(path, page);
    out.push(...(body.data || []));
    const next = body.paging?.next;
    if (!next) break;
    const u = new URL(next);
    path = u.pathname.replace(`/${VERSION}`, "");
    page = Object.fromEntries([...u.searchParams].filter(([k]) => k !== "access_token"));
  }
  return out;
}

export async function fetchAccount(accountId) {
  const b = await get(`/act_${accountId}`, { fields: "name,account_status,currency,timezone_name" });
  return b;
}
