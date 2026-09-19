"use strict";
/**
 * Does timing the basket pay on a risk-adjusted basis, under a bar fixed before it was run?
 *
 * PRE-COMMITTED IN ADR-0028, COMMITTED TO THE REPOSITORY BEFORE THIS SCRIPT WAS RUN
 * --------------------------------------------------------------------------------
 * ADR-0028 rejected basket exposure timing 0 of 12 under the ADR-0026/0027 rule, and showed why
 * that rule cannot pass this family shape: an exposure overlay's excess is exactly 0 whenever it is
 * invested, so a win can only occur in a window it sat out, and the win rate is capped by time
 * spent out of market. The clause was written for a selection rule, which is always invested.
 *
 * ADR-0028 also observed that every cell cut drawdown sharply, and precommitted that the drawdown
 * column could NOT rescue the verdict. A risk-adjusted rule was allowed only as its own
 * precommitment, stated in that ADR before being run. This script implements exactly that rule and
 * changes nothing else:
 *
 *   Statistic: compounded return divided by maximum drawdown, strategy versus basket, computed
 *              independently in each half.
 *   Bar:       the strategy must exceed the basket's ratio in BOTH halves, AND its compounded
 *              return must not fall below the basket's by more than 25% in either half -- so an
 *              overlay that avoids drawdown merely by avoiding the market cannot pass.
 *   Grid:      unchanged, the same 4 lookbacks x 3 horizons. No new parameter search.
 *   Floor:     unchanged, 10 effective holdout observations.
 *   Falsification: fewer than 2 of 12 cells clearing both halves closes the family outright.
 *
 * Search cost: 30 cumulative before this script; this adds 12, for 42. The count does not reset.
 *
 * The signal, the cost model, the universe, the holdout split and the observation construction are
 * imported unchanged from the ADR-0028 measurement, so the only thing that differs is the statistic
 * being read. Re-implementing them here would allow a silent drift that flatters the new rule.
 *
 * Measurement only. No strategy, registry entry, or execution path changes. liveAuthority stays
 * NONE and this grants no order, transfer, or production-mutation authority.
 *
 * Usage: node scripts/alpha/measure-basket-exposure-risk-adjusted.js [--days 900]
 */

const {
  MARKETS,
  ROUND_TRIP,
  HOLDOUT_FRACTION,
  MINIMUM_EFFECTIVE_SAMPLES,
  LOOKBACKS_DAYS,
  HORIZONS_DAYS,
  fetchDailyCandles,
  observations,
  maxDrawdown
} = require("./basketExposureTiming");

// Precommitted in ADR-0028: an overlay may not pass by simply staying out of the market.
const RETURN_SHORTFALL_LIMIT = 0.25;
const FALSIFICATION_MINIMUM_CELLS = 2;

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

const compounded = (periodReturns) => periodReturns.reduce((equity, value) => equity * (1 + value), 1) - 1;

/**
 * Return per unit of drawdown. A series that never drew down has no denominator; it is reported as
 * null rather than as an infinite ratio, because "never fell" over 38 observations is a statement
 * about that stretch and must not read as an unbeatable score.
 */
function returnOverDrawdown(periodReturns) {
  const total = compounded(periodReturns);
  const drawdown = Math.abs(maxDrawdown(periodReturns));
  if (drawdown === 0) return null;
  return total / drawdown;
}

function summarise(rows) {
  const strategy = rows.map((row) => row.strategy);
  const benchmark = rows.map((row) => row.benchmark);
  return {
    count: rows.length,
    strategyReturn: compounded(strategy),
    benchmarkReturn: compounded(benchmark),
    strategyRatio: returnOverDrawdown(strategy),
    benchmarkRatio: returnOverDrawdown(benchmark),
    strategyDrawdown: maxDrawdown(strategy),
    benchmarkDrawdown: maxDrawdown(benchmark),
    exposure: rows.filter((row) => row.hold).length / Math.max(1, rows.length)
  };
}

/** The precommitted bar, applied to one half. */
function clearsHalf(half) {
  if (half.strategyRatio == null || half.benchmarkRatio == null) return false;
  if (!(half.strategyRatio > half.benchmarkRatio)) return false;
  // Shortfall is measured in the benchmark's own terms, and only bites when the benchmark made
  // money: giving up 25% of a loss is not a shortfall.
  if (half.benchmarkReturn > 0) {
    const shortfall = (half.benchmarkReturn - half.strategyReturn) / half.benchmarkReturn;
    if (shortfall > RETURN_SHORTFALL_LIMIT) return false;
  }
  return true;
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const ratio = (value) => (value == null ? "   n/a" : value.toFixed(2).padStart(6));

async function main() {
  const days = argument("days", 900);
  console.log("Basket exposure timing, risk-adjusted rule precommitted in ADR-0028");
  console.log(`Bar: return/maxDD above basket in BOTH halves, and return shortfall <= ${pct(RETURN_SHORTFALL_LIMIT)} in each`);
  console.log(`Round trip charged on state flips only: ${pct(ROUND_TRIP)}\n`);

  const series = {};
  for (const market of MARKETS) {
    series[market] = await fetchDailyCandles(market, days);
    console.log(`${market}: ${series[market].length} daily bars`);
  }
  console.log("");

  let clearedCells = 0;
  let underpoweredCells = 0;
  const total = LOOKBACKS_DAYS.length * HORIZONS_DAYS.length;
  for (const lookbackDays of LOOKBACKS_DAYS) {
    console.log(`lookback ${lookbackDays}d`);
    for (const horizonDays of HORIZONS_DAYS) {
      const rows = observations(series, lookbackDays, horizonDays);
      const split = Math.floor(rows.length * (1 - HOLDOUT_FRACTION));
      const inSample = summarise(rows.slice(0, split));
      const holdout = summarise(rows.slice(split));
      const clears = clearsHalf(inSample) && clearsHalf(holdout);
      const measured = holdout.count >= MINIMUM_EFFECTIVE_SAMPLES;
      if (clears && measured) clearedCells += 1;
      if (clears && !measured) underpoweredCells += 1;
      const verdict = clears
        ? (measured ? "<-- CLEARS" : `<-- UNDERPOWERED (eff ${holdout.count} < ${MINIMUM_EFFECTIVE_SAMPLES}, not evidence)`)
        : "";
      for (const [label, half] of [["in ", inSample], ["out", holdout]]) {
        console.log(
          `  reb ${String(horizonDays).padStart(2)}d ${label} n=${String(half.count).padStart(3)}` +
          `  ret ${pct(half.strategyReturn).padStart(8)} vs ${pct(half.benchmarkReturn).padStart(8)}` +
          `  maxDD ${pct(half.strategyDrawdown).padStart(7)} vs ${pct(half.benchmarkDrawdown).padStart(7)}` +
          `  ret/DD ${ratio(half.strategyRatio)} vs ${ratio(half.benchmarkRatio)}` +
          `  in-mkt ${pct(half.exposure).padStart(5)}` +
          (label === "out" ? `  ${verdict}` : "")
        );
      }
    }
    console.log("");
  }
  console.log(`Cells clearing both halves with an adequate holdout sample: ${clearedCells} of ${total}.`);
  if (underpoweredCells > 0) {
    console.log(`Cells clearing the bar on fewer than ${MINIMUM_EFFECTIVE_SAMPLES} effective holdout samples: ${underpoweredCells}. These are not results.`);
  }
  console.log(
    clearedCells < FALSIFICATION_MINIMUM_CELLS
      ? `Below the precommitted falsification threshold of ${FALSIFICATION_MINIMUM_CELLS}. The family is closed.`
      : `At or above the precommitted threshold of ${FALSIFICATION_MINIMUM_CELLS}. The family is not closed by this test.`
  );
  console.log("Cumulative hypotheses tested across ADR-0026, ADR-0027, ADR-0028 and this script: 42.");
}

void main();
