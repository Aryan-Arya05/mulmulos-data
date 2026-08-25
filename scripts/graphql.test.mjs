/**
 * node scripts/graphql.test.mjs
 *
 * Parses every GraphQL literal in the Shopify client. Exists because a
 * JavaScript-style comment inside a query is valid JavaScript and
 * invalid GraphQL — so it fails only at runtime, in Actions, after the
 * job has already spent a minute starting up.
 *
 * Falls back to a hand-rolled check when the graphql package is absent,
 * so it still runs in CI without adding a dependency.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/shopify.mjs", import.meta.url), "utf8");
const queries = [...src.matchAll(/`(\s*(?:query|mutation)[\s\S]*?)`/g)].map((m) => m[1]);

let ok = true;
const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} ${n}`); };

t(`found queries to check (${queries.length})`, queries.length >= 3);

let parse = null;
try { ({ parse } = await import("graphql")); } catch { /* optional */ }

for (const [i, q] of queries.entries()) {
  const name = (/(?:query|mutation)\s+(\w+)/.exec(q) || [])[1] || `#${i + 1}`;

  /* The specific failure that bit us: /* … *\/ is a JS comment, not a
     GraphQL one. GraphQL comments start with #. */
  t(`${name}: no JavaScript-style comments`, !/\/\*|\*\//.test(q));
  t(`${name}: braces balanced`, (q.match(/{/g) || []).length === (q.match(/}/g) || []).length);
  t(`${name}: parens balanced`, (q.match(/\(/g) || []).length === (q.match(/\)/g) || []).length);

  if (parse) {
    try { parse(q); t(`${name}: parses`, true); }
    catch (e) { t(`${name}: parses — ${e.message.split("\n")[0]}`, false); }
  }
}

if (!parse) console.log("\n(graphql package not installed — structural checks only)");
console.log(ok ? "\nGRAPHQL TESTS PASS" : "\nGRAPHQL TESTS FAIL");
process.exit(ok ? 0 : 1);
