/* ============================================================
   Supermetrics API v2 client.

   CONFIRMED against docs.supermetrics.com (Aug 2026):
     · GET https://api.supermetrics.com/enterprise/v2/query/data/json
     · Query parameters are sent as a JSON string in the `json` param.
     · Auth: `Authorization: Bearer <api key>` — documented as
       preferred over api_key in the URL, and it keeps the key out
       of proxy and server access logs.
     · Synchronous by default. If a query outlives the wait window
       it returns 202 with meta.schedule_id, and you poll
       GET /enterprise/v2/query/status.
     · Response is { meta, data } where data is a 2D array. With
       settings.no_headers = true there is no header row, so column
       order === the order of `fields`.

   An earlier version of this file guessed a submit/poll pair at
   /query/data/async. No such endpoint exists — it returned
   ENDPOINT_NOT_FOUND on every account. The shape below is from
   the published docs, not inference.
   ============================================================ */

const BASE = process.env.SUPERMETRICS_BASE || "https://api.supermetrics.com";
const DATA_PATH = "/enterprise/v2/query/data/json";
const STATUS_PATH = "/enterprise/v2/query/status";

const KEY = process.env.SUPERMETRICS_API_KEY;

function requireKey() {
  if (!KEY) throw new Error("SUPERMETRICS_API_KEY is not set — add it as a GitHub Secret.");
}

async function get(path, params) {
  requireKey();
  const url = `${BASE}${path}?json=${encodeURIComponent(JSON.stringify(params))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${path} — ${text.slice(0, 200)}`);
  }

  /* v2 puts failures in body.error with a code worth surfacing verbatim. */
  if (body.error) {
    const e = body.error;
    throw new Error(`${e.code || res.status}: ${e.message || ""}${e.description ? ` — ${e.description}` : ""}`);
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`HTTP ${res.status} from ${path} — ${text.slice(0, 200)}`);
  }
  return { body, status: res.status };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one query. Returns a 2D data array (no header row).
 * Handles the 202/QUEUED case by polling the status endpoint.
 */
export async function query({ dsId, accounts, fields, startDate, endDate, maxRows = 1000 }) {
  const params = {
    ds_id: dsId,
    ds_accounts: accounts,
    start_date: startDate,
    end_date: endDate,
    fields,
    max_rows: maxRows,
    settings: { no_headers: true },
  };

  const { body, status } = await get(DATA_PATH, params);

  const queued = status === 202 || body.meta?.status_code === "QUEUED";
  if (!queued) return body.data || [];

  const scheduleId = body.meta?.schedule_id;
  if (!scheduleId) throw new Error("Query was queued but no schedule_id was returned.");

  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(attempt === 0 ? 2000 : 3000);
    const poll = await get(STATUS_PATH, { schedule_id: scheduleId });
    const code = poll.body.meta?.status_code;
    if (code === "SUCCESS" || code === "COMPLETED" || (poll.body.data && poll.body.data.length)) {
      return poll.body.data || [];
    }
    if (code === "FAILED" || code === "ERROR") {
      throw new Error(`Query failed: ${JSON.stringify(poll.body.meta).slice(0, 200)}`);
    }
  }
  throw new Error("Query did not finish within ~2 minutes.");
}

/**
 * Map rows to objects. With no_headers the column order is exactly
 * the order of `fields`, so index off that rather than guessing from
 * labels — labels differ from field ids and would silently read the
 * wrong column.
 */
export function toObjects(rows, fields, mapping) {
  const order = fields.split(",").map((f) => f.trim());
  const idx = Object.fromEntries(order.map((f, i) => [f, i]));
  return (rows || []).map((r) => {
    const o = {};
    for (const [out, { field, type }] of Object.entries(mapping)) {
      const raw = r[idx[field]];
      o[out] = type === "number" ? (raw == null || raw === "" ? null : Number(raw)) : raw;
    }
    return o;
  });
}

/** Supermetrics wants YYYY-MM-DD. Explicit window beats a named range
    whose definition could drift between products. */
export function lastNDays(n) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // yesterday: today is partial
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}
