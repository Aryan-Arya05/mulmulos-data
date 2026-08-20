/* ============================================================
   GA4 Data API client.

   Auth is a service-account JWT exchanged for an access token.
   Signed here with node:crypto so the repo stays dependency-free —
   no npm install step in the workflow, nothing to keep patched.

   Setup:
     1. Google Cloud → enable the Google Analytics Data API.
     2. Create a service account, download the JSON key.
     3. GA4 Admin → Property Access Management → add the service
        account's client_email as VIEWER on the property.
     4. Paste the whole JSON key into the secret GA4_SERVICE_ACCOUNT.

   ⚠ Standard GA4 properties retain event data for 14 months, and
   the default is 2. Nothing can backfill past that limit, so check
   Admin → Data Settings → Data Retention today if you have not.
   ============================================================ */

import { createSign } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://analyticsdata.googleapis.com/v1beta";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function credentials() {
  const raw = process.env.GA4_SERVICE_ACCOUNT;
  if (!raw) throw new Error("GA4_SERVICE_ACCOUNT is not set — paste the whole service-account JSON as a GitHub Secret.");
  let c;
  try { c = JSON.parse(raw); }
  catch { throw new Error("GA4_SERVICE_ACCOUNT is not valid JSON — paste the key file's entire contents, not just the private key."); }
  if (!c.client_email || !c.private_key) throw new Error("Service-account JSON is missing client_email or private_key.");
  return c;
}

let cached = null;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const c = credentials();
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: c.client_email, scope: SCOPE, aud: TOKEN_URL,
    iat: now, exp: now + 3600,
  }));

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  /* Secrets often arrive with literal \n instead of newlines. */
  const key = c.private_key.replace(/\\n/g, "\n");
  const jwt = `${header}.${claim}.${b64url(signer.sign(key))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Token exchange failed (${res.status}): ${body.error_description || body.error || "unknown"}`);
  }
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
  return cached.token;
}

export async function runReport(propertyId, request) {
  const token = await accessToken();
  const res = await fetch(`${API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Non-JSON (${res.status}) — ${text.slice(0, 200)}`); }

  if (body.error) {
    const e = body.error;
    const hint = e.status === "PERMISSION_DENIED"
      ? " — grant the service account Viewer on this GA4 property."
      : e.status === "INVALID_ARGUMENT" ? " — check the metric and dimension names." : "";
    throw new Error(`GA4 ${e.code} ${e.status}: ${e.message}${hint}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  return body;
}

/** Flatten GA4's row shape into plain objects keyed by header name. */
export function toRows(report) {
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const mets = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = r.dimensionValues?.[i]?.value ?? null; });
    mets.forEach((m, i) => {
      const v = r.metricValues?.[i]?.value;
      o[m] = v == null || v === "" ? null : Number(v);
    });
    return o;
  });
}
