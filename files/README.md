# MulmulOS data pipeline — Google Ads pilot

Scheduled GitHub Action pulls Google Ads, splits web from OMNI, commits JSON.
The repo becomes both the data source and the history.

```
Actions (cron, secrets server-side)
  → scripts/pull-google.mjs
  → data/google.json  +  data/history.jsonl
  → committed back to the repo
  → Pages serves the dashboard, which fetches ./data/google.json
```

No key ever reaches a browser. That is the whole point of this shape.

---

## Setup — about 15 minutes

**1. Create the repo** (private) and copy these files in.

**2. Get a Supermetrics server-to-server API key.**
Supermetrics Hub → API access. It is the key beginning `api_`, *not* an
OAuth token. Same subscription you renewed; no extra cost.

**3. Add it as a secret.**
`Settings → Secrets and variables → Actions → New repository secret`
Name it exactly `SUPERMETRICS_API_KEY`.
Never put it in a file — Actions masks secrets in logs, literals are not masked.

**4. Verify the API contract.** ⚠ Read this before the first run.

`scripts/lib/supermetrics.mjs` is written against a contract I could not
read. Confirmed from public docs: server-to-server uses an `api_*` bearer
token, one endpoint covers all sources, Google Ads is `ds_id: "AW"`, and
queries are async (submit → poll). **Not** confirmed: exact URL paths and
the response envelope.

Check your Hub's API reference and adjust the three constants at the top of
that file if they differ. They can also be overridden by env var without
editing code:

```
SUPERMETRICS_BASE
SUPERMETRICS_SUBMIT_PATH
SUPERMETRICS_RESULT_PATH
```

Everything else is isolated from this file — a wrong guess breaks one
function, not the pipeline.

**5. Run it by hand first.**
`Actions → Pull Google Ads → Run workflow`. Read the log. Each account
prints ok-or-failed with a reason. Then check `data/google.json` landed.

Once it works, the cron takes over: 07:00 and 19:00 IST.

---

## Access control — do not skip

A Pages site built from a private repo is **still publicly reachable**
unless your plan includes Pages access control. Check first. If it isn't
covered, put Cloudflare Access in front (free tier, email-based, ~10 min)
or host the build on Vercel with password protection.

The data includes real revenue and named store staff. Treat the URL as
sensitive until you've confirmed the gate.

---

## What the data looks like

`data/google.json`

```json
{
  "source": "Google Ads via Supermetrics",
  "fetchedAt": "2026-08-18T13:30:00.000Z",
  "range": "last_7_days",
  "rule": "OMNI campaigns optimise store visits; conversion value is a visit count, not rupees. Never graded on ROAS.",
  "accounts": [
    {
      "id": "3669746941",
      "name": "Shop Mul Mul",
      "ok": true,
      "totals": {
        "webSpend": 352030, "webRevenue": 1974112, "webRoas": 5.607,
        "omniSpend": 195180, "omniVisits": 135, "omniCostPerVisit": 1445.8,
        "omniShare": 0.357, "naiveBlendedRoas": 3.608
      },
      "web": [ ... ], "omni": [ ... ]
    }
  ]
}
```

`naiveBlendedRoas` is kept deliberately: it is what an unfiltered pull would
report, so the dashboard can show the gap rather than just the right number.

---

## Tests

```
node scripts/shape.test.mjs
```

Twenty assertions against the real 18 Aug 2026 figures, including the case
this pipeline exists to prevent:

```
web 5.61x vs naive 3.61x — grading OMNI in understates by 36%
```

The shaping logic is pure — no network, no secrets — so it is testable and
is the part you should never have to debug live.

---

## Failure behaviour

- One account fails → recorded with its error, others still write.
- Every account fails → **nothing is written**, job exits 1. A stale file
  beats a file full of zeros.
- No change in data → no commit, so history stays meaningful.
- OMNI above 40% of spend → warning printed in the log.

---

## Next sources, in order of effort

| Source | Auth | Notes |
|---|---|---|
| Shopify | Admin API access token | Revenue truth. Straightforward REST. |
| Meta | Graph API long-lived token | Same 7-day-click caveat applies — the API cannot give the web slice. |
| Drive | Google service account + share the files | Unlocks the FY-2026-27 channel split. |
| GA4 | Service account + Data API + Viewer | Still the biggest blind spot. |

Add one at a time. Each is a `scripts/pull-*.mjs` plus a workflow, following
the same shape: pure logic in `lib/`, network isolated, tests against real
figures.
