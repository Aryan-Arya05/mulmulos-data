/**
 * node scripts/chunk.test.mjs
 *
 * Meta returns error 1 — its generic "unknown error" — when a request is
 * too heavy, which a four-month pull of daily campaign rows reliably is.
 * The range is therefore split. A split that drops or double-counts a day
 * would corrupt the numbers silently, so the boundaries are checked here.
 */
import { chunkRange } from "./lib/meta.mjs";

let ok = true;
const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} ${n}`); };
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;

const covers = (since, until, size) => {
  const cs = chunkRange(since, until, size);
  const total = cs.reduce((a, c) => a + days(c.since, c.until), 0);
  const contiguous = cs.every((c, i) =>
    i === 0 || Date.parse(c.since) - Date.parse(cs[i - 1].until) === 86400000);
  return { cs, total, contiguous, first: cs[0].since, last: cs[cs.length - 1].until };
};

{
  const r = covers("2026-04-28", "2026-08-25", 31);
  t("120-day range splits into 4", r.cs.length === 4);
  t("every day is covered exactly once", r.total === 120);
  t("chunks are contiguous", r.contiguous);
  t("starts on the requested day", r.first === "2026-04-28");
  t("ends on the requested day", r.last === "2026-08-25");
}
{
  const r = covers("2026-08-24", "2026-08-25", 31);
  t("a short range is not split", r.cs.length === 1);
  t("short range still exact", r.total === 2);
}
{
  const r = covers("2026-08-25", "2026-08-25", 31);
  t("a single day works", r.cs.length === 1 && r.total === 1);
}
{
  /* Exactly on the boundary is where off-by-one errors live. */
  const r = covers("2026-01-01", "2026-01-31", 31);
  t("exactly one chunk-length is one chunk", r.cs.length === 1 && r.total === 31);
  const r2 = covers("2026-01-01", "2026-02-01", 31);
  t("one day over splits into two", r2.cs.length === 2 && r2.total === 32);
  t("and stays contiguous", r2.contiguous);
}
{
  const r = covers("2026-01-01", "2026-12-31", 31);
  t("a full year is covered without gaps", r.total === 365 && r.contiguous);
}

console.log(ok ? "\nCHUNK TESTS PASS" : "\nCHUNK TESTS FAIL");
process.exit(ok ? 0 : 1);
