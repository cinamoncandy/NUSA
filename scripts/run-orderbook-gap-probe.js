"use strict";
/**
 * Read-only map of where the order-book coverage gaps lie (WO-LEARNING-20261120-ORDERBOOK-GAP-PROBE). Runs on the PAPER host inside the nusa-research
 * service, opens NUSA_CLOUD_STATE_DB_PATH READ-ONLY and prints one line:
 *   ORDERBOOK_GAPS {"status":"OK","windowHours":192,"coveredHours":n,"uncoveredHours":n,"longestGapHours":n,"gapRuns":n,"gapOneStartMs":..,"gapOneHours":.., ... up to six longest runs}
 * An hour is covered, as in apps/cloud/src/orderBookCoverage.ts, when a stored sample lies in the 2 minutes up to the full hour (captured_at_ms in (t - 2 min, t]).
 * The query selects captured_at_ms only: **no bid, ask or size value is read**, so no reserved span of a pre-registration is touched (counting hours that hold
 * data is allowed). It answers where the uncovered hours of the 192-hour window lie (an old outage leaves the window by itself, a recent one does not).
 * It changes nothing, gates nothing, grants nothing.
 */
const { orderBookSource } = require("./lib/orderBookSource.js");

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 192;
const BOOK_WINDOW_MS = 120_000;
const MARKET = "KRW-BTC"; // the collector requests all KRW markets together every minute, so one liquid market shows the shared gaps
const NAMES = ["One", "Two", "Three", "Four", "Five", "Six"];

function probe(db, now = Date.now()) {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS; // the last full hour
  const first = end - (WINDOW_HOURS - 1) * HOUR_MS;
  const times = db.prepare(`SELECT captured_at_ms AS t FROM ${orderBookSource(db)} WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms ASC`)
    .all(MARKET, first - BOOK_WINDOW_MS, end).map((r) => Number(r.t));
  const flags = []; let i = 0;
  for (let h = first; h <= end; h += HOUR_MS) {
    while (i < times.length && times[i] <= h - BOOK_WINDOW_MS) i += 1;
    flags.push(i < times.length && times[i] <= h);
  }
  const runs = []; let start = -1;
  flags.forEach((ok, k) => { if (!ok && start < 0) start = k; if ((ok || k === flags.length - 1) && start >= 0) { const stop = ok ? k : k + 1; runs.push({ startMs: first + start * HOUR_MS, hours: stop - start }); start = -1; } });
  const covered = flags.filter(Boolean).length;
  const out = { status: "OK", windowHours: flags.length, coveredHours: covered, uncoveredHours: flags.length - covered, longestGapHours: runs.reduce((m, r) => Math.max(m, r.hours), 0), gapRuns: runs.length, asOfMs: end };
  [...runs].sort((a, b) => (b.hours - a.hours) || (a.startMs - b.startMs)).slice(0, NAMES.length).forEach((r, k) => { out[`gap${NAMES[k]}StartMs`] = r.startMs; out[`gap${NAMES[k]}Hours`] = r.hours; });
  return out;
}

module.exports = { probe, MARKET, WINDOW_HOURS };

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { console.log("ORDERBOOK_GAPS", JSON.stringify(probe(db))); } finally { db.close(); }
  } catch { console.error("ORDERBOOK_GAPS_FAILED_CLOSED"); process.exitCode = 1; }
}
