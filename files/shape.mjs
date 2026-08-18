/* ============================================================
   Pure shaping logic. No network, no secrets — so it can be
   unit-tested and is the part you never have to debug live.

   The rule this file exists to enforce: a Google campaign whose
   name contains OMNI is optimising STORE VISITS. Its conversion
   value is a visit count, not rupees. Grading those on ROAS
   reported 3.61x against a real web figure of 5.61x on the
   18 Aug 2026 pull — a 55% understatement.
   ============================================================ */

export const isOmni = (name) => /omni/i.test(name || "");

/** Split raw campaign rows into web (gradeable) and OMNI (not gradeable). */
export function splitChannels(rows = []) {
  const web = rows.filter((r) => !isOmni(r.name));
  const omni = rows.filter((r) => isOmni(r.name));

  const sum = (list, key) => list.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  const webSpend = sum(web, "spend");
  const webRevenue = sum(web, "revenue");
  const omniSpend = sum(omni, "spend");
  const omniVisits = sum(omni, "conversions");
  const totalSpend = webSpend + omniSpend;

  return {
    web: web
      .map((r) => ({ ...r, roas: r.spend ? r.revenue / r.spend : null }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    omni: omni
      .map((r) => ({ ...r, costPerVisit: r.conversions ? r.spend / r.conversions : null }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    totals: {
      webSpend,
      webRevenue,
      webRoas: webSpend ? webRevenue / webSpend : null,
      omniSpend,
      omniVisits,
      omniCostPerVisit: omniVisits ? omniSpend / omniVisits : null,
      totalSpend,
      omniShare: totalSpend ? omniSpend / totalSpend : 0,
      /* What an unfiltered pull would wrongly report — kept so the
         dashboard can show the gap rather than just the right number. */
      naiveBlendedRoas: totalSpend ? (webRevenue + omniVisits) / totalSpend : null,
    },
  };
}

/** Wrap a payload with provenance. Nothing ships without knowing where it came from. */
export function envelope({ source, account, range, rows, extra = {} }) {
  return {
    source,
    account,
    range,
    fetchedAt: new Date().toISOString(),
    rowCount: rows.length,
    ...extra,
  };
}
