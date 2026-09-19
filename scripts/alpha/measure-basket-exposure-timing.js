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

// Same five majors and the same round trip as ADR-0026/0027, so the benchmark is literally theirs.
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-ADA"];
const ROUND_TRIP = 0.00032 + 0.0005 * 2 + 0.0002 * 2;
const HOLDOUT_FRACTION = 0.3;
const MINIMUM_EFFECTIVE_SAMPLES = 10;
const LOOKBACKS_DAYS = [14, 30, 60, 90];
const HORIZONS_DAYS = [7, 14, 30];

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

async function fetchDailyCandles(market, count) {
  const collected = [];
  let cursor;
  while (collected.length < count) {
    const page = Math.min(200, count - collected.length);
    const url = new URL("https://api.upbit.com/v1/candles/days");
    url.searchParams.set("market", market);
    url.searchParams.set("count", String(page));
    if (cursor) url.searchParams.set("to", cursor);
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) throw new Error(`${market} upstream ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    collected.push(...rows);
    cursor = rows[rows.length - 1].candle_date_time_utc;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const ascending = collected
    .map((row) => ({ time: Date.parse(`${row.candle_date_time_utc}Z`), close: Number(row.trade_price) }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0)
    .sort((left, right) => left.time - right.time);
  return ascending.filter((row, index) => index === 0 || row.time !== ascending[index - 1].time);
}

const median = (values) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
const mean = (values) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);

/**
 * One observation per rebalance date. The basket is equal-weight across the five majors, so its
 * return is the mean of the constituents' returns over the same window.
 *
 * The signal at index i reads only closes at or before i, and the outcome is measured strictly
 * after i, so no observation can see its own result.
 */
function observations(series, lookbackDays, horizonDays) {
  const length = Math.min(...MARKETS.map((market) => series[market].length));
  const basketReturn = (from, to) => mean(MARKETS.map((market) => series[market][to].close / series[market][from].close - 1));
  const rows = [];
  let held = false;
  for (let index = lookbackDays; index + horizonDays < length; index += horizonDays) {
    const trailing = basketReturn(index - lookbackDays, index);
    const forward = basketReturn(index, index + horizonDays);
    // Absolute momentum: hold the basket after a positive lookback, stand aside otherwise.
    const hold = trailing > 0;
    // Cost falls on the flip, not on the rebalance. Standing pat costs nothing, which is the whole
    // reason this candidate is worth measuring after rotation failed.
    const cost = hold === held ? 0 : ROUND_TRIP;
    held = hold;
    const strategy = (hold ? forward : 0) - cost;
    rows.push({ excess: strategy - forward, strategy, benchmark: forward, hold });
  }
  return rows;
}

/** Compounded peak-to-trough decline of a sequence of period returns. */
function maxDrawdown(periodReturns) {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of periodReturns) {
    equity *= 1 + value;
    if (equity > peak) peak = equity;
    const decline = equity / peak - 1;
    if (decline < worst) worst = decline;
  }
  return worst;
}

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
