/* node merge.test.mjs — the merge must never lose history */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const DIR = "/tmp/mergetest";
await rm(DIR, { recursive: true, force: true });
await mkdir(DIR + "/data", { recursive: true });

process.chdir(DIR);
const { mergeInto } = await import("/mnt/user-data/outputs/mulmulos-pipeline/scripts/lib/merge.mjs");
const mergeDaily = (payload, keys) => mergeInto("data/shopify.json", payload, keys,
  { from: payload.range.slice(0, 10), to: payload.range.slice(13, 23) });

let ok = true;
const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} ${n}`); };

const KEYS = {
  revenueDaily: (r) => `${r.date}|${r.bucket}`,
  fakeOrders: (r) => r.name,
};

/* A thirty-day backfill lands first. */
const backfill = {
  range: "2026-07-26 → 2026-08-24 IST",
  revenueDaily: [
    { date: "2026-07-26", bucket: "online", grossSales: 100 },
    { date: "2026-08-20", bucket: "online", grossSales: 200 },
    { date: "2026-08-24", bucket: "online", grossSales: 300 },
  ],
  fakeOrders: [{ name: "#old", orderedAt: "2026-07-26" }],
};
await writeFile("data/shopify.json", JSON.stringify(backfill));

/* Then the two-day live job runs, covering the 24th and 25th. */
const live = {
  range: "2026-08-24 → 2026-08-25 IST",
  revenueDaily: [
    { date: "2026-08-24", bucket: "online", grossSales: 350 },   // corrected
    { date: "2026-08-25", bucket: "online", grossSales: 400 },   // today
  ],
  fakeOrders: [{ name: "#new", orderedAt: "2026-08-25" }],
};

const out = await mergeDaily(live, KEYS);
const day = (d) => out.revenueDaily.find((r) => r.date === d)?.grossSales;

t("history outside the window survives", day("2026-07-26") === 100 && day("2026-08-20") === 200);
t("today is added", day("2026-08-25") === 400);
t("a corrected day is replaced, not duplicated", day("2026-08-24") === 350);
t("no duplicate rows", out.revenueDaily.length === 4);
t("rows stay in date order",
  out.revenueDaily.map((r) => r.date).join() === "2026-07-26,2026-08-20,2026-08-24,2026-08-25");
t("older fake orders are kept", out.fakeOrders.some((f) => f.name === "#old"));
t("new fake orders are added", out.fakeOrders.some((f) => f.name === "#new"));
t("provenance recorded", out.mergedFrom === backfill.range);

/* A backfill running after the live job must not lose today either. */
await writeFile("data/shopify.json", JSON.stringify(out));
const wide = {
  range: "2026-07-26 → 2026-08-25 IST",
  revenueDaily: [
    { date: "2026-08-25", bucket: "online", grossSales: 450 },
  ],
  fakeOrders: [],
};
const out2 = await mergeDaily(wide, KEYS);
t("a wider pull replaces everything it covers",
  out2.revenueDaily.length === 1 && out2.revenueDaily[0].grossSales === 450);

/* First run, with no existing file. */
await rm("data/shopify.json");
const first = await mergeDaily(live, KEYS);
t("first run works with no prior file", first.revenueDaily.length === 2);

/* A corrupt file must not lose the pull. */
await writeFile("data/shopify.json", "{ not json");
const corrupt = await mergeDaily(live, KEYS);
t("unreadable prior file falls back to this pull", corrupt.revenueDaily.length === 2);

console.log(ok ? "\nMERGE TESTS PASS" : "\nMERGE TESTS FAIL");
process.exit(ok ? 0 : 1);
