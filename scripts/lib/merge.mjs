/**
 * Merge daily rows across pulls instead of overwriting them.
 *
 * Every puller writes a whole JSON file. Without merging, the frequent
 * short pull erases the occasional long one: a two-day live job replaces
 * a thirty-day backfill an hour after it runs, and the dashboard's date
 * picker silently collapses to two days.
 *
 * The rule is simple: rows dated inside the window just pulled are
 * authoritative from this run — so corrections and late cancellations
 * land — and rows outside it are history worth keeping.
 */
import { readFile } from "node:fs/promises";

export async function mergeInto(path, payload, keyed, { from, to } = {}) {
  let prev = null;
  try { prev = JSON.parse(await readFile(path, "utf8")); }
  catch { return payload; }               // first run, or unreadable

  if (!from || !to) return payload;

  const out = { ...payload };
  let kept = 0;

  for (const [field, keyOf] of Object.entries(keyed)) {
    const fresh = payload[field] || [];
    const old = prev[field] || [];
    if (!old.length) continue;

    const freshKeys = new Set(fresh.map(keyOf));
    const carried = old.filter((r) => {
      const d = r.date || r.orderedAt;
      if (d && d >= from && d <= to) return false;   // this run owns it
      return !freshKeys.has(keyOf(r));
    });
    kept += carried.length;
    out[field] = [...carried, ...fresh].sort((a, b) =>
      String(a.date || a.orderedAt || "").localeCompare(String(b.date || b.orderedAt || "")));
  }

  if (kept) {
    const all = Object.keys(keyed).flatMap((f) => (out[f] || []).map((r) => r.date || r.orderedAt)).filter(Boolean).sort();
    console.log(`  merged: kept ${kept} rows from earlier pulls · coverage ${all[0]} → ${all[all.length - 1]}`);
  }
  out.mergedFrom = prev.range || null;
  return out;
}
