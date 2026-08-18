/* ============================================================
   Pulls Google Ads for every Mulmul account, splits web from
   OMNI, writes data/google.json and appends data/history.jsonl.

   Run:  SUPERMETRICS_API_KEY=api_xxx node scripts/pull-google.mjs
   ============================================================ */

import { writeFile, appendFile, mkdir, readFile } from "node:fs/promises";
import { query, toObjects } from "./lib/supermetrics.mjs";
import { splitChannels, envelope } from "./lib/shape.mjs";

const ACCOUNTS = [
  { id: "3669746941", name: "Shop Mul Mul", note: "India — primary web account" },
  { id: "8496183372", name: "Mul Mul", note: "India" },
  { id: "5604246703", name: "Mulmul — UAE", note: "UAE" },
  { id: "3207381292", name: "Mulmul Asia-Pacific", note: "Asia" },
  { id: "2357544596", name: "Mulmul UK", note: "UK" },
  { id: "9514329217", name: "Shopmulmul (US and UAE)", note: "US + UAE" },
];

const RANGE = process.env.RANGE || "last_7_days";
const FIELDS = "campaign_name,cost,impressions,clicks,conversions,conversion_value";

const MAPPING = {
  name: { field: "campaign_name" },
  spend: { field: "cost", type: "number" },
  impressions: { field: "impressions", type: "number" },
  clicks: { field: "clicks", type: "number" },
  conversions: { field: "conversions", type: "number" },
  revenue: { field: "conversion_value", type: "number" },
};

async function pullAccount(acct) {
  process.stdout.write(`  ${acct.name.padEnd(24)} `);
  try {
    const raw = await query({
      dsId: "AW",
      accounts: acct.id,
      fields: FIELDS,
      dateRangeType: RANGE,
      maxRows: 500,
    });
    const rows = toObjects(raw, MAPPING);
    const split = splitChannels(rows);
    console.log(
      `ok — ${rows.length} campaigns, web ROAS ${split.totals.webRoas?.toFixed(2) ?? "—"}x, OMNI ${(100 * split.totals.omniShare).toFixed(0)}%`
    );
    return { account: acct, ok: true, ...split };
  } catch (e) {
    /* An account that did not answer reports why. It never becomes a zero. */
    console.log(`FAILED — ${e.message}`);
    return { account: acct, ok: false, error: e.message, web: [], omni: [], totals: null };
  }
}

async function main() {
  console.log(`Google Ads pull · range=${RANGE}`);
  const results = [];
  for (const a of ACCOUNTS) results.push(await pullAccount(a));

  const ok = results.filter((r) => r.ok);
  if (!ok.length) {
    console.error("\nEvery account failed. Not writing data — a stale file beats a file full of zeros.");
    process.exit(1);
  }

  const payload = {
    ...envelope({
      source: "Google Ads via Supermetrics",
      account: `${ok.length}/${ACCOUNTS.length} accounts`,
      range: RANGE,
      rows: ok.flatMap((r) => [...r.web, ...r.omni]),
      extra: {
        attribution: "Google default attribution. Not incrementality.",
        rule: "OMNI campaigns optimise store visits; conversion value is a visit count, not rupees. Never graded on ROAS.",
      },
    }),
    accounts: results.map((r) => ({
      id: r.account.id,
      name: r.account.name,
      note: r.account.note,
      ok: r.ok,
      error: r.error ?? null,
      totals: r.totals,
      web: r.web,
      omni: r.omni,
    })),
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/google.json", JSON.stringify(payload, null, 2));
  console.log(`\nWrote data/google.json (${ok.length}/${ACCOUNTS.length} accounts)`);

  /* One line per run — the repo becomes the trend history for free. */
  const primary = results.find((r) => r.account.id === "3669746941");
  if (primary?.ok) {
    const line = JSON.stringify({
      ts: payload.fetchedAt,
      range: RANGE,
      account: "Shop Mul Mul",
      webSpend: Math.round(primary.totals.webSpend),
      webRevenue: Math.round(primary.totals.webRevenue),
      webRoas: Number(primary.totals.webRoas?.toFixed(3) ?? 0),
      omniSpend: Math.round(primary.totals.omniSpend),
      omniShare: Number(primary.totals.omniShare.toFixed(3)),
    });
    await appendFile("data/history.jsonl", line + "\n");
    console.log("Appended data/history.jsonl");
  }

  /* Fail loudly if OMNI is eating the account — the thing worth alerting on. */
  if (primary?.ok && primary.totals.omniShare > 0.4) {
    console.log(`\n⚠ OMNI is ${(100 * primary.totals.omniShare).toFixed(0)}% of Shop Mul Mul spend.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
