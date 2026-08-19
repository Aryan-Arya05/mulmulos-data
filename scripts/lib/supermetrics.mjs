/* ============================================================
   ⚠  VERIFY THIS FILE BEFORE FIRST RUN — it is the only part of
   the pipeline written against an API contract I could not read.

   What is confirmed (Supermetrics public docs, Aug 2026):
     · Server-to-server auth uses an API key bearer token,
       format `api_*`. Get it from the Supermetrics Hub.
     · The Data API is a single endpoint covering all connected
       sources, addressed by ds_id (Google Ads = "AW").
     · Queries are async: submit, receive a schedule id, poll.

   What is NOT confirmed: the exact URL paths, parameter casing,
   and response envelope below. Confirm against your Hub's API
   reference, adjust the three marked constants, and the rest of
   the pipeline works unchanged.

   Everything else in this repo is deliberately independent of
   this file, so a wrong guess here breaks one function, not the
   build.
   ============================================================ */

/* ---- VERIFY: base URL and the two paths ---- */
const BASE = process.env.SUPERMETRICS_BASE || "https://api.supermetrics.com";
const SUBMIT_PATH = process.env.SUPERMETRICS_SUBMIT_PATH || "/enterprise/v2/query/data/async";
const RESULT_PATH = process.env.SUPERMETRICS_RESULT_PATH || "/enterprise/v2/query/data/result";

const KEY = process.env.SUPERMETRICS_API_KEY;

function requireKey() {
  if (!KEY) throw new Error("SUPERMETRICS_API_KEY is not set — add it as a GitHub Secret.");
  if (!KEY.startsWith("api_")) {
    console.warn("⚠ SUPERMETRICS_API_KEY does not start with 'api_' — check you copied a server-to-server key, not an OAuth token.");
  }
}

async function call(path, body, method = "POST") {
  requireKey();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supermetrics ${res.status} on ${path} — ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Supermetrics returned non-JSON on ${path} — ${text.slice(0, 300)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit a query, poll until complete, return the 2D array
 * (row 0 = headers, rows 1+ = data) plus requested field ids.
 */
export async function query({ dsId, accounts, fields, dateRangeType, maxRows = 500 }) {
  const submitted = await call(SUBMIT_PATH, {
    ds_id: dsId,
    ds_accounts: accounts,
    fields,
    date_range_type: dateRangeType,
    max_rows: maxRows,
  });

  /* ---- VERIFY: the field carrying the poll handle ---- */
  const scheduleId = submitted.schedule_id || submitted.data?.schedule_id || submitted.id;
  if (!scheduleId) {
    throw new Error(`No schedule id in submit response — got keys: ${Object.keys(submitted).join(", ")}`);
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(attempt === 0 ? 1500 : 3000);
    const out = await call(`${RESULT_PATH}?schedule_id=${encodeURIComponent(scheduleId)}`, null, "GET");
    const status = out.status || out.data?.status;
    if (status === "completed") {
      const payload = out.data || out;
      return {
        rows: payload.data || [],
        fieldIds: payload.requested_field_ids || fields.split(","),
      };
    }
    if (status === "failed" || status === "error") {
      throw new Error(`Supermetrics query failed: ${JSON.stringify(out).slice(0, 300)}`);
    }
  }
  throw new Error("Supermetrics query did not complete within ~90s.");
}

/**
 * Map the 2D array to objects using requested_field_ids — never the
 * row-0 display labels, which differ from field ids and would
 * silently read the wrong column.
 */
export function toObjects({ rows, fieldIds }, mapping) {
  if (!rows || rows.length < 2) return [];
  const idx = {};
  fieldIds.forEach((id, i) => { idx[id] = i; });
  return rows.slice(1).map((r) => {
    const o = {};
    for (const [out, { field, type }] of Object.entries(mapping)) {
      const raw = r[idx[field]];
      o[out] = type === "number" ? (raw == null || raw === "" ? null : Number(raw)) : raw;
    }
    return o;
  });
}
