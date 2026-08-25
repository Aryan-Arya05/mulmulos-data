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

  let lastError = null;
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
        lastError = e;
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
  /* Say what actually failed. "Rate-limited" was a guess, and when the
     real cause was error 1 (request too heavy) it pointed the wrong way. */
  throw new Error(lastError
    ? `Meta ${lastError.code} after 5 attempts: ${lastError.message}`
    : "Meta failed after 5 attempts.");
}

/* One definition, used by both the synchronous and async paths — so the
   two can never drift and quietly return different shapes. */
const INSIGHT_FIELDS = [
  "date_start", "campaign_id", "campaign_name", "objective",
  "spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm",
  "actions", "action_values",
].join(",");

/**
 * Heavy queries go through Meta's async insights job rather than the
 * synchronous endpoint: submit, poll, collect. Months of daily
 * campaign rows with action breakdowns exceed what the synchronous
 * call will return, and it reports that as error 1 — "unknown error" —
 * which retrying cannot fix.
 */
async function runAsyncInsights(accountId, params) {
  const qs = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = await fetch(`${BASE}/act_${accountId}/insights?${qs}`, { method: "POST" });
  /* .text() then parse, matching the rest of the client — Meta returns
     HTML on some failures and .json() would throw an opaque error. */
  const raw = await res.text();
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new Error(`Meta async submit returned non-JSON (${res.status}) — ${raw.slice(0, 200)}`); }
  if (body.error) throw new Error(`Meta async submit ${body.error.code}: ${body.error.message}`);
  const runId = body.report_run_id;
  if (!runId) throw new Error("Meta accepted the async job but returned no report_run_id.");

  for (let i = 0; i < 120; i++) {          // up to ~10 minutes
    await sleep(5000);
    const st = await get(`/${runId}`, { fields: "async_status,async_percent_completion" });
    if (st.async_status === "Job Completed") break;
    if (/Failed|Skipped/i.test(st.async_status || "")) {
      throw new Error(`Meta async job ${st.async_status}`);
    }
    if (i === 119) throw new Error("Meta async job did not finish within 10 minutes.");
  }

  const out = [];
  let after = null;
  do {
    const page = await get(`/${runId}/insights`, { limit: "500", ...(after ? { after } : {}) });
    out.push(...(page.data || []));
    after = page.paging?.cursors?.after && page.paging?.next ? page.paging.cursors.after : null;
  } while (after);
  return out;
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
  const span = (Date.parse(until) - Date.parse(since)) / 86400000 + 1;

  /* Short windows — the hourly live pull — stay synchronous because it
     returns immediately. Anything longer goes async, which is slower to
     start but is the only thing that completes. */
  if (span <= 14) {
    return fetchInsightsChunk({ accountId, since, until, level });
  }

  const chunks = chunkRange(since, until, chunkDays);
  console.log(`  ${span} days — using Meta's async report job, ${chunks.length} chunk(s) of ≤${chunkDays} days`);
  const all = [];
  for (const c of chunks) {
    process.stdout.write(`    ${c.since} → ${c.until} … `);
    const rows = await runAsyncInsights(accountId, {
      level,
      time_range: JSON.stringify({ since: c.since, until: c.until }),
      time_increment: "1",
      fields: INSIGHT_FIELDS,
      action_attribution_windows: JSON.stringify(["7d_click"]),
      limit: "500",
    });
    console.log(`${rows.length} rows`);
    all.push(...rows);
  }
  return all;
}

async function fetchInsightsChunk({ accountId, since, until, level = "campaign" }) {
  const params = {
    level,
    time_increment: "1",                       // one row per day
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(["7d_click"]),
    fields: INSIGHT_FIELDS,
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
