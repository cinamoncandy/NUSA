"use strict";
/**
 * Can timing exposure to the basket pay, when picking within it cannot?
 *
 * PRE-COMMITTED BEFORE ANY RESULT WAS SEEN
 * ----------------------------------------
 * ADR-0026 and ADR-0027 closed cross-sectional rotation between five KRW majors: both directions
 * of the ranking rule lost to an equal-weight basket at every horizon, longer holds did not
 * amortise the cost, and dispersion conditioning made it worse. The loss was attributed to two
 * charges, neither of which is the ranking rule:
 *
 *   1. the 0.172% round trip paid on every rotation, and
 *   2. the diversification given up by holding one asset instead of five.
 *
 * ADR-0026 stated the only useful next move: not a better ranking rule, but a reason to believe the
 * concentration penalty is smaller than measured. This script takes the other available answer --
 * do not concentrate at all. Hold the whole basket and decide only whether to be in it.
 *
 * That candidate pays charge 2 never, and charge 1 only when the state actually flips, rather than
 * on every rebalance. If timing the basket also loses, then both the selection and the timing forms
 * of this family are closed on this venue, which is a materially stronger statement than either
 * alone and should redirect the search away from price-history signals entirely.
 *
 * Hypothesis: the sign of the basket's own trailing return predicts its next-horizon return well
 * enough that standing aside after a negative lookback beats holding through it, after cost.
 * This is absolute (time-series) momentum, a different driver from the cross-sectional momentum
 * ADR-0026 rejected: it asks whether to hold, not which to hold.
 *
 * Decision rule, UNCHANGED from ADR-0026/0027 so results stay comparable: a cell counts as
 * promising only if, in BOTH the in-sample and the sealed holdout halves, median excess over
 * buy-and-hold exceeds zero after cost AND the win rate exceeds 0.5. Mean alone decides nothing.
 *
 * This rule is deliberately demanding for a defensive overlay. An overlay that stands aside gives
 * up upside in most windows and earns its keep in few, so its median excess per window can be
 * negative while its drawdown is better. Maximum drawdown is therefore printed for both, as
 * context -- but it does NOT enter the verdict. Changing the bar after seeing the result is the
 * move this repository's own ADRs exist to prevent; a drawdown-based rule would have to be
 * precommitted in its own right before it could decide anything.
 *
 * Search cost: ADR-0026 spent 6 and ADR-0027 spent 12, for 18 cumulative. This adds 4 lookbacks
 * x 3 horizons x 1 direction = 12, for 30 cumulative. Direction is fixed to momentum (stand aside
 * after a negative lookback) rather than testing its reverse: ADR-0026 established that flipping
 * the sign of a ranking rule is not what decides the outcome here, and testing both would double
 * the count for no reason.
 *
 * Overlapping windows inflate counts, so effective independent samples are printed and every
 * reading is against those. A cell clearing the thresholds on fewer than MINIMUM_EFFECTIVE_SAMPLES
 * independent holdout observations is reported UNDERPOWERED, not promising -- ADR-0027 was nearly
 * mis-read for exactly that reason.
 *
 * Measurement only. No strategy, registry entry, or execution path changes. liveAuthority stays
 * NONE and this grants no order, transfer, or production-mutation authority.
 *
 * Usage: node scripts/alpha/measure-basket-exposure-timing.js [--days 900]
 */

const {
  MARKETS,
  ROUND_TRIP,
  HOLDOUT_FRACTION,
  MINIMUM_EFFECTIVE_SAMPLES,
  LOOKBACKS_DAYS,
  HORIZONS_DAYS,
  fetchDailyCandles,
  mean,
  median,
  observations,
  maxDrawdown
} = require("./basketExposureTiming");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

function summarise(rows) {
  const excess = rows.map((row) => row.excess);
  if (excess.length === 0) return { median: Number.NaN, winRate: 0, effective: 0, line: "(no observations)" };
  const wins = excess.filter((value) => value > 0).length;
  // Rebalances already step by the horizon, so windows do not overlap and every row is an
  // independent draw. Kept explicit so the floor below is checked against a real number rather
  // than an assumption.
  const effective = excess.length;
  const exposure = rows.filter((row) => row.hold).length / rows.length;
  return {
    median: median(excess),
    winRate: wins / excess.length,
    effective,
    line: `n=${String(excess.length).padStart(4)} (eff ${String(effective).padStart(3)})  median ${(median(excess) * 100).toFixed(3).padStart(7)}%  mean ${(mean(excess) * 100).toFixed(3).padStart(7)}%  win ${(wins / excess.length * 100).toFixed(1).padStart(5)}%  in-market ${(exposure * 100).toFixed(0).padStart(3)}%`,
    drawdown: `maxDD strategy ${(maxDrawdown(rows.map((row) => row.strategy)) * 100).toFixed(1).padStart(6)}%  basket ${(maxDrawdown(rows.map((row) => row.benchmark)) * 100).toFixed(1).padStart(6)}%`
  };
}

async function main() {
  const days = argument("days", 900);
  console.log("Basket exposure timing (absolute momentum), momentum direction only");
  console.log(`Round trip charged on state flips only: ${(ROUND_TRIP * 100).toFixed(3)}%`);
  console.log(`Benchmark: buy and hold the equal-weight basket of ${MARKETS.join(", ")}\n`);

  const series = {};
  for (const market of MARKETS) {
    series[market] = await fetchDailyCandles(market, days);
    console.log(`${market}: ${series[market].length} daily bars`);
  }
  console.log("");

  let promisingCells = 0;
  let underpoweredCells = 0;
  const total = LOOKBACKS_DAYS.length * HORIZONS_DAYS.length;
  for (const lookbackDays of LOOKBACKS_DAYS) {
    console.log(`lookback ${lookbackDays}d`);
    for (const horizonDays of HORIZONS_DAYS) {
      const rows = observations(series, lookbackDays, horizonDays);
      const split = Math.floor(rows.length * (1 - HOLDOUT_FRACTION));
      const inSample = summarise(rows.slice(0, split));
      const holdout = summarise(rows.slice(split));
      const clears = inSample.median > 0 && holdout.median > 0 && inSample.winRate > 0.5 && holdout.winRate > 0.5;
      const measured = holdout.effective >= MINIMUM_EFFECTIVE_SAMPLES;
      if (clears && measured) promisingCells += 1;
      if (clears && !measured) underpoweredCells += 1;
      const verdict = clears
        ? (measured ? "<-- PROMISING" : `<-- UNDERPOWERED (eff ${holdout.effective} < ${MINIMUM_EFFECTIVE_SAMPLES}, not evidence)`)
        : "";
      console.log(`  rebalance ${String(horizonDays).padStart(2)}d  in  ${inSample.line}`);
      console.log(`  ${" ".padEnd(13)} out ${holdout.line}   ${verdict}`);
      console.log(`  ${" ".padEnd(13)}     ${holdout.drawdown}  (context only, not in the verdict)`);
    }
    console.log("");
  }
  console.log(`Cells clearing both halves with an adequate holdout sample: ${promisingCells} of ${total}.`);
  if (underpoweredCells > 0) {
    console.log(`Cells clearing the thresholds but on fewer than ${MINIMUM_EFFECTIVE_SAMPLES} effective holdout samples: ${underpoweredCells}. These are not results.`);
  }
  console.log("Cumulative hypotheses tested across ADR-0026, ADR-0027 and this script: 30.");
}

void main();
