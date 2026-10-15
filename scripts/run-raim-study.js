"use strict";
/**
 * Pre-registered RAIM regime-adaptive market-making study, work order WO-RESEARCH-20261015-RAIM-VENUESPEC. Runs on the PAPER host
 * inside the nusa-research service, reads research_orderbook_samples and research_trade_ticks_v2 READ-ONLY from
 * NUSA_CLOUD_STATE_DB_PATH, replays the compiled deterministic simulator (dist/apps/cloud/src/researchMarketMakingSim.js) and prints
 *   RAIM_STUDY {"status":"WAITING_DATA"|"INSUFFICIENT_DATA"|"DATA_INTEGRITY_FAIL"|"BLOCKED_SPEC"|"HOLDOUT_PASS"|"HOLDOUT_FAIL", ...}
 * It places no order and writes only its own result file. A PASS qualifies a forward SHADOW test under the recorded assumptions;
 * it is never independent evidence, never a League qualification, never PAPER authority.
 *
 * Fixed before any row of the window was examined (nothing below may change after this commit):
 * - Nothing is fitted: the regime constants (REGIME_PREREGISTERED) and the candidate are fixed hypotheses, so there is no training
 *   split. Window: 2026-10-25T00:00Z .. 2026-10-29T00:00Z, four whole UTC days, evaluated once. This window overlaps the ORDERBOOK ML
 *   study's holdout (same data, different hypothesis): it is an additional comparison on the same days and is recorded as such.
 * - Books: one per market per minute (the last sample of the minute). Trades: research_trade_ticks_v2 (ASK = taker sell, BID = taker buy).
 * - Eligible market: books in >= 90% of the window's minutes, median spread between 10 and 50 bp, and >= 200 trade ticks. The 20 with
 *   the most ticks (ties by market name) are used.
 * - Per market and UTC day, from zero inventory: quote notional 20,000 KRW (size = 20,000 / first mid of the day), inventory cap 3 sizes,
 *   latency 1 s, adverse-selection horizon 60 s. Assumptions SINGLE_LISTED_FEE (5 bp both sides) and QUANTITY_STEP_IGNORED are recorded.
 * - Baseline: join the touch. Candidate: regimeCandidateQuote. Same books and trades for both.
 * - HOLDOUT_PASS only if all hold: candidate filled orders >= 100; candidate net PnL > 0; candidate net > baseline net; candidate net > baseline
 *   net on >= 3 of the 4 days; candidate net > 0 with the fee doubled to 10 bp (stress).
 * - Selection effect (stated, not corrected): eligibility and the top-20 ranking by trade count use the evaluation window itself; they are
 *   outcome-blind but correlate with fill counts. Leftover inventory is valued at the last best bid net of fee (no exit at mid).
 *   Fills are counted per filled resting order (filledOrders), not per partial trade event.
 * - Written once: after a final HOLDOUT_* result exists the study is not re-run and never overwrites it.
 * - The run fails closed with DATA_INTEGRITY_FAIL:DATA_FUTURE if any stored book or trade is stamped more than 5 s after the run time.
 */
const crypto = require("node:crypto");
const M = 60_000;
const DAY = 24 * 60 * M;
const START = Date.parse("2026-10-25T00:00:00Z");
const END = Date.parse("2026-10-29T00:00:00Z");
const NOTIONAL = 20_000;
const TOP_MARKETS = 20;

function loadSim() {
  const sim = require("../dist/apps/cloud/src/researchMarketMakingSim.js");
  const regime = require("../dist/apps/cloud/src/researchRegimeQuoting.js");
  const venue = require("../dist/apps/cloud/src/researchVenueSpec.js");
  return { ...sim, ...regime, spec: venue.UPBIT_KRW_SPOT_SPEC };
}

function median(values) { const s = [...values].sort((x, y) => x - y); return s.length === 0 ? Infinity : s[Math.floor(s.length / 2)]; }

function runStudy({ db, now = Date.now(), lib = loadSim() }) {
  if (now < END + 2 * 3_600_000) return { status: "WAITING_DATA", daysCollected: Math.max(0, Math.floor((Math.min(now, END) - START) / DAY)) };
  for (const [table, column] of [["research_orderbook_samples", "captured_at_ms"], ["research_trade_ticks_v2", "traded_at_ms"]]) {
    if (Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} > ?`).get(now + 5_000).n) > 0) return { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" };
  }
  const assumptions = ["SINGLE_LISTED_FEE", "QUANTITY_STEP_IGNORED"];
  const stressSpec = { ...lib.spec, listedFeeBp: { ...lib.spec.listedFeeBp, value: lib.spec.listedFeeBp.value * 2 } };
  const markets = db.prepare("SELECT DISTINCT market FROM research_orderbook_samples WHERE captured_at_ms > ? AND captured_at_ms <= ?").all(START, END).map((r) => r.market).sort();
  const minutes = (END - START) / M;
  const candidates = [];
  const countTrades = db.prepare("SELECT COUNT(*) AS n FROM research_trade_ticks_v2 WHERE market = ? AND traded_at_ms > ? AND traded_at_ms <= ?");
  for (const market of markets) {
    const byMinute = new Map();
    for (const r of db.prepare("SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a FROM research_orderbook_samples WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms").iterate(market, START, END)) byMinute.set(Math.floor(r.t / M), r);
    const books = [...byMinute.entries()].sort((x, y) => x[0] - y[0]).map(([, r]) => ({ t: r.t, bestBid: r.b, bestAsk: r.a }));
    const spreads = books.map((b) => ((b.bestAsk - b.bestBid) / ((b.bestAsk + b.bestBid) / 2)) * 10_000);
    const tradeCount = Number(countTrades.get(market, START, END).n);
    const med = median(spreads);
    if (books.length >= 0.9 * minutes && med >= 10 && med <= 50 && tradeCount >= 200) candidates.push({ market, books, tradeCount });
  }
  // Only the selected markets keep their books, and only they have their trades loaded (bounded memory).
  const used = candidates.sort((x, y) => y.tradeCount - x.tradeCount || (x.market < y.market ? -1 : 1)).slice(0, TOP_MARKETS);
  for (const u of used) u.trades = db.prepare("SELECT traded_at_ms AS t, price, volume, side FROM research_trade_ticks_v2 WHERE market = ? AND traded_at_ms > ? AND traded_at_ms <= ? ORDER BY traded_at_ms, price").all(u.market, START, END).map((r) => ({ t: r.t, price: r.price, volume: r.volume, side: r.side }));
  if (used.length < 4) return { status: "INSUFFICIENT_DATA", markets: markets.length, eligible: used.length };

  const hash = crypto.createHash("sha256");
  const days = [0, 1, 2, 3].map(() => ({ base: 0, cand: 0, stress: 0 }));
  let fillsBase = 0; let fillsCand = 0; let datasetRows = 0; let blocked; let invalid = false;
  for (const { market, books, trades } of used) {
    hash.update(`${market}\n`);
    for (const b of books) hash.update(`B${b.t},${b.bestBid},${b.bestAsk}\n`);
    for (const t of trades) hash.update(`T${t.t},${t.price},${t.volume},${t.side}\n`);
    datasetRows += books.length + trades.length;
    for (let d = 0; d < 4; d += 1) {
      const lo = START + d * DAY; const hi = lo + DAY;
      const dayBooks = books.filter((b) => b.t > lo && b.t <= hi); const dayTrades = trades.filter((t) => t.t > lo && t.t <= hi);
      if (dayBooks.length === 0) continue;
      const size = NOTIONAL / ((dayBooks[0].bestBid + dayBooks[0].bestAsk) / 2);
      const common = { assumptions, books: dayBooks, trades: dayTrades, maxInventory: 3 * size };
      const base = lib.simulateQuoting({ ...common, spec: lib.spec, quote: lib.baselineQuote(size) });
      const cand = lib.simulateQuoting({ ...common, spec: lib.spec, quote: lib.regimeCandidateQuote(size, 3 * size) });
      const stress = lib.simulateQuoting({ ...common, spec: stressSpec, quote: lib.regimeCandidateQuote(size, 3 * size) });
      if (base.status !== "SIMULATED" || cand.status !== "SIMULATED" || stress.status !== "SIMULATED") { blocked = base.unknownFields ?? cand.unknownFields ?? stress.unknownFields ?? ["SIM"]; if (blocked.includes("INPUT_INVALID_OR_UNORDERED")) invalid = true; continue; }
      days[d].base += base.netPnl; days[d].cand += cand.netPnl; days[d].stress += stress.netPnl;
      fillsBase += base.filledOrders; fillsCand += cand.filledOrders;
    }
  }
  if (invalid) return { status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_INVALID" };
  if (blocked !== undefined) return { status: "BLOCKED_SPEC", reasonCode: "SIM_BLOCKED" };
  const sum = (k) => days.reduce((s, x) => s + x[k], 0);
  const baseNet = sum("base"); const candNet = sum("cand"); const stressNet = sum("stress");
  const daysAhead = days.filter((x) => x.cand > x.base).length;
  const pass = fillsCand >= 100 && candNet > 0 && candNet > baseNet && daysAhead >= 3 && stressNet > 0;
  const round = (x) => Math.round(x * 100) / 100;
  return {
    status: pass ? "HOLDOUT_PASS" : "HOLDOUT_FAIL", markets: markets.length, eligible: used.length,
    datasetFingerprint: hash.digest("hex"), datasetRows, baselineFilledOrders: fillsBase, candidateFilledOrders: fillsCand,
    baselineNetKrw: round(baseNet), candidateNetKrw: round(candNet), candidateStressNetKrw: round(stressNet), daysCandidateAhead: daysAhead,
    independent: false,
  };
}

const RESULT_FILE = "raim-study-result.json";
function recordedResult(stateDbPath, fs = require("node:fs"), pathLib = require("node:path")) {
  try {
    const r = JSON.parse(fs.readFileSync(pathLib.join(pathLib.dirname(stateDbPath), RESULT_FILE), "utf8"));
    return r && (r.status === "HOLDOUT_PASS" || r.status === "HOLDOUT_FAIL") ? r : undefined;
  } catch { return undefined; }
}
function writeResult(stateDbPath, result, fs = require("node:fs"), pathLib = require("node:path")) {
  if (result.status !== "HOLDOUT_PASS" && result.status !== "HOLDOUT_FAIL") return false;
  if (recordedResult(stateDbPath, fs, pathLib) !== undefined) return false; // evaluated once: a final result is never overwritten
  const target = pathLib.join(pathLib.dirname(stateDbPath), RESULT_FILE);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ schemaVersion: 1, studyId: "RAIM_MM_20261029", ...result }));
  fs.renameSync(`${target}.tmp`, target);
  return true;
}

module.exports = { runStudy, writeResult, recordedResult, RESULT_FILE, START, END };

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const existing = recordedResult(path);
    if (existing !== undefined) { console.log("RAIM_STUDY", JSON.stringify({ ...existing, recorded: true })); return; }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const result = runStudy({ db });
      console.log("RAIM_STUDY", JSON.stringify(result));
      writeResult(path, result);
    } finally { db.close(); }
  } catch { console.error("RAIM_STUDY_FAILED_CLOSED"); process.exitCode = 1; }
}
