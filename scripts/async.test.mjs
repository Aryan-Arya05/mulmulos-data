/* node async.test.mjs — exercises the Meta async report job end to end
   against a stubbed API, since the real one only fails under load. */
process.env.META_ACCESS_TOKEN = "test";
process.env.META_ACCOUNT_ID = "123";

const calls = [];
let pollCount = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ u, method: init.method || "GET" });

  if (init.method === "POST" && u.includes("/insights?")) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ report_run_id: "run_1" }) };
  }
  if (/\/run_1\?/.test(u)) {
    pollCount++;
    /* Not ready the first two times — the poll loop must wait. */
    const status = pollCount < 3 ? "Job Running" : "Job Completed";
    return { ok: true, status: 200, text: async () => JSON.stringify({ async_status: status, async_percent_completion: pollCount * 40 }) };
  }
  if (/\/run_1\/insights/.test(u)) {
    const after = new URL(u).searchParams.get("after");
    if (!after) {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        data: [{ date_start: "2026-05-01", campaign_name: "A", spend: "100" }],
        paging: { next: "https://x/next", cursors: { after: "cur1" } } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({
      data: [{ date_start: "2026-05-02", campaign_name: "B", spend: "200" }] }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
};

const { fetchInsights } = await import("./lib/meta.mjs");

let ok = true;
const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} ${n}`); };

const rows = await fetchInsights({ accountId: "123", since: "2026-05-01", until: "2026-08-25" });

t("submits an async job", calls.some((c) => c.method === "POST" && c.u.includes("/insights?")));
t("polls until the job completes", pollCount >= 3);
t("follows pagination", rows.length >= 2 && rows.some((r) => r.campaign_name === "B"));
t("requests 7-day-click attribution", calls.some((c) => decodeURIComponent(c.u).includes('["7d_click"]')));
t("asks for daily rows", calls.some((c) => c.u.includes("time_increment=1")));

/* A short window must stay on the fast synchronous path. */
calls.length = 0;
await fetchInsights({ accountId: "123", since: "2026-08-24", until: "2026-08-25" });
t("short range stays synchronous", !calls.some((c) => c.method === "POST"));

console.log(ok ? "\nASYNC TESTS PASS" : "\nASYNC TESTS FAIL");
process.exit(ok ? 0 : 1);
