"use strict";
/**
 * Evaluation step of the pre-registered futures regime long/short research (docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md
 * §4-§7 and the 2026-10-19 addendum). Re-fetches the public history in memory, refuses to run unless every file matches the committed
 * manifest (research/futures/futures-history-manifest.json), then runs the compiled pure evaluator
 * (dist/apps/cloud/src/futures/futuresRegimeStudy.js) on the development and holdout splits at base and doubled costs, N = 50 plus the
 * N = 20 / 100 sensitivity. It refuses if a holdout result is already committed. The file guard alone cannot stop a second dispatch
 * before that commit, so "exactly once" is also an operating rule: dispatch once, then commit the printed report before anything else.
 * Writes nothing, places nothing, takes no key. PAPER only.
 */
const fs = require("node:fs");
const path = require("node:path");
const history = require("./fetch-futures-history.js");

const RESEARCH_DIR = path.join(__dirname, "..", "research", "futures");
const MANIFEST = path.join(RESEARCH_DIR, "futures-history-manifest.json");
const HOLDOUT_RESULT = path.join(RESEARCH_DIR, "futures-regime-holdout-result.json");
const HOLDOUT_START = Date.parse("2025-10-15T00:00:00Z");
const BASE_COSTS = Object.freeze({ takerFeeRate: 0.0005, slippageBps: 5, maintenanceMarginRate: 0.004 });
const STRESS_COSTS = Object.freeze({ takerFeeRate: 0.001, slippageBps: 10, maintenanceMarginRate: 0.004 });

class StudyRunError extends Error { constructor(code) { super(code); this.name = "StudyRunError"; this.code = code; } }

function parseFiles(files) {
  const bars = {}; const funding = {};
  for (const symbol of history.SYMBOLS) {
    bars[symbol] = files[`klines_${symbol}_4h.csv`].trim().split("\n").slice(1).map((line) => {
      const [openTime, open, high, low, close, , closeTime] = line.split(",").map(Number);
      return { openTime, open, high, low, close, closeTime };
    });
    funding[symbol] = files[`funding_${symbol}.csv`].trim().split("\n").slice(1).map((line) => {
      const [time, rate] = line.split(",").map(Number);
      return { time, rate };
    });
  }
  return { bars, funding };
}

function summary(r) {
  return { roundTrips: r.roundTrips, meanNetReturn: r.meanNetReturn, pnlBySymbol: r.pnlBySymbol, profitableSymbols: r.profitableSymbols,
    shortPnlInDownMonths: r.shortPnlInDownMonths, maxDrawdown: r.maxDrawdown, liquidations: r.liquidations, finalEquity: r.finalEquity };
}

/** Pure given the fetched files: returns the full report. `study` is the compiled evaluator module. */
function evaluate(files, study) {
  const { bars, funding } = parseFiles(files);
  const splits = { development: [history.START, HOLDOUT_START], holdout: [HOLDOUT_START, history.END] };
  const report = { prereg: "RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT", splits: {} };
  for (const [name, [windowStart, windowEnd]] of Object.entries(splits)) {
    const byN = {};
    for (const breakoutN of [50, 20, 100]) {
      const base = study.runRegimeStudy({ bars, funding, windowStart, windowEnd, breakoutN, costs: BASE_COSTS });
      const stressed = study.runRegimeStudy({ bars, funding, windowStart, windowEnd, breakoutN, costs: STRESS_COSTS });
      byN[`N${breakoutN}`] = { base: summary(base), stressed: summary(stressed), rule: study.passRule(base, stressed) };
    }
    report.splits[name] = byN;
  }
  // §6/§7: only the holdout at N = 50 decides; development and other N are reported, never decisive.
  report.verdict = report.splits.holdout.N50.rule.pass ? "PASS" : "FAIL";
  return report;
}

async function main({ fetchImpl = fetch, study = null, manifestPath = MANIFEST, resultPath = HOLDOUT_RESULT } = {}) {
  if (fs.existsSync(resultPath)) throw new StudyRunError("HOLDOUT_ALREADY_EVALUATED");
  if (!fs.existsSync(manifestPath)) throw new StudyRunError("MANIFEST_NOT_COMMITTED");
  const committed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const fresh = await history.fetchHistory({ fetchImpl });
  if (!history.verify(fresh, committed).ok) throw new StudyRunError("HISTORY_HASH_MISMATCH");
  return evaluate(fresh.files, study ?? require("../dist/apps/cloud/src/futures/futuresRegimeStudy.js"));
}

module.exports = { evaluate, parseFiles, main, StudyRunError, BASE_COSTS, STRESS_COSTS, HOLDOUT_START };

if (require.main === module) {
  main().then((report) => {
    console.log(`FUTURES_STUDY_VERDICT ${report.verdict}`);
    console.log(`FUTURES_STUDY_REPORT ${JSON.stringify(report)}`);
  }).catch((error) => {
    console.error("FUTURES_STUDY_REFUSED", error instanceof StudyRunError || error instanceof history.HistoryError ? error.code : "ERROR");
    process.exitCode = 1;
  });
}
