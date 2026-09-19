"use strict";
/**
 * Is there a holding period long enough, or a dispersion wide enough, to pay for concentrating?
 *
 * PRE-COMMITTED BEFORE ANY RESULT WAS SEEN
 * ----------------------------------------
 * ADR-0026 measured cross-sectional rotation between five KRW majors and found both momentum and
 * reversal losing to an equal-weight basket at every horizon up to 96h. Because both directions
 * lost, the loss is not the ranking rule: it is the 0.172% round trip charged per rotation plus the
 * diversification given up by holding one asset instead of five. That ADR named the only two
 * reasons left to believe the penalty could be paid, and this script tests exactly those two and
 * nothing else.
 *
 * Hypothesis A -- amortisation: at a long enough holding period the round trip is a small enough
 * share of the move that picking can pay. Horizons 7, 14, 30 and 60 days.
 *
 * Hypothesis B -- dispersion: rotation pays only when the majors are far apart, so restricting to
 * the widest-dispersion observations should show an excess the unconditional test washed out.
 * Dispersion is the spread between the best and worst trailing return; the top tercile and top
 * decile are reported.
 *
 * Decision rule, unchanged from ADR-0026 so results stay comparable: a configuration counts as
 * promising only if, in BOTH the in-sample and the sealed holdout halves, median excess over the
 * basket exceeds zero after cost and the win rate exceeds 0.5. Mean alone decides nothing.
 * Overlapping windows inflate counts, so effective independent samples are printed and any reading
 * is against those.
 *
 * Search cost: ADR-0026 spent 6 tests. This adds 4 horizons x 3 dispersion bands x 1 direction
 * = 12, for 18 cumulative. Conditioning on dispersion after seeing an unconditional failure is
 * exactly the move that manufactures false positives, which is why both halves are required and
 * why every cell is printed rather than only a survivor.
 *
 * Direction is fixed to MOMENTUM. Testing both again would double the count for no reason: ADR-0026
 * showed the sign of the ranking rule is not what decides the outcome.
 *
 * Usage: node scripts/alpha/measure-rotation-amortisation.js [--days 900]
 */

const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-ADA"];
const ROUND_TRIP = 0.00032 + 0.0005 * 2 + 0.0002 * 2;
const HOLDOUT_FRACTION = 0.3;
// Below this many effective independent holdout observations a cell cannot be read at all, in
// either direction. See ADR-0027: at 60 days over 900 bars the holdout carries 1 to 3 genuinely
// independent windows, and a positive median there states only that one stretch of market went up.
const MINIMUM_EFFECTIVE_SAMPLES = 10;
const HORIZONS_DAYS = [7, 14, 30, 60];
const DISPERSION_BANDS = [
  { label: "all", keep: 1 },
  { label: "top 33%", keep: 1 / 3 },
  { label: "top 10%", keep: 0.1 }
];

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

/** One observation per rebalance date: the excess of the pick over the basket, after cost. */
function observations(series, horizonDays) {
  const length = Math.min(...MARKETS.map((market) => series[market].length));
  const rows = [];
  for (let index = horizonDays; index + horizonDays < length; index += 1) {
    const trailing = MARKETS.map((market) => ({
      market,
      value: series[market][index].close / series[market][index - horizonDays].close - 1
    }));
    const top = trailing.reduce((best, row) => (row.value > best.value ? row : best));
    const worst = trailing.reduce((low, row) => (row.value < low.value ? row : low));
    const forward = (market) => series[market][index + horizonDays].close / series[market][index].close - 1;
    const basket = mean(MARKETS.map(forward));
    rows.push({
      dispersion: top.value - worst.value,
      excess: forward(top.market) - basket - ROUND_TRIP
    });
  }
  return rows;
}

function summarise(rows, horizonDays) {
  const excess = rows.map((row) => row.excess);
  if (excess.length === 0) return { median: Number.NaN, winRate: 0, line: "      (no observations)" };
  const wins = excess.filter((value) => value > 0).length;
  const effective = Math.max(1, Math.floor(excess.length / horizonDays));
  return {
    median: median(excess),
    winRate: wins / excess.length,
    effective,
    line: `n=${String(excess.length).padStart(4)} (eff ${String(effective).padStart(3)})  median ${(median(excess) * 100).toFixed(3).padStart(7)}%  mean ${(mean(excess) * 100).toFixed(3).padStart(7)}%  win ${(wins / excess.length * 100).toFixed(1).padStart(5)}%`
  };
}

/** Keep the widest-dispersion share, measured within the half being summarised so the threshold
 *  is never chosen using data from the other half. */
function widest(rows, keep) {
  if (keep >= 1) return rows;
  const sorted = [...rows].sort((left, right) => right.dispersion - left.dispersion);
  return sorted.slice(0, Math.max(1, Math.floor(sorted.length * keep)));
}

async function main() {
  const days = argument("days", 900);
  console.log("Rotation amortisation and dispersion, MOMENTUM only");
  console.log(`Round trip per rotation: ${(ROUND_TRIP * 100).toFixed(3)}%\n`);

  const series = {};
  for (const market of MARKETS) {
    series[market] = await fetchDailyCandles(market, days);
    console.log(`${market}: ${series[market].length} daily bars`);
  }
  console.log("");

  let promisingCells = 0;
  let underpoweredCells = 0;
  for (const horizonDays of HORIZONS_DAYS) {
    const rows = observations(series, horizonDays);
    const split = Math.floor(rows.length * (1 - HOLDOUT_FRACTION));
    console.log(`horizon ${horizonDays}d  (round trip is ${(ROUND_TRIP * 100).toFixed(3)}% of the holding period)`);
    for (const band of DISPERSION_BANDS) {
      const inSample = summarise(widest(rows.slice(0, split), band.keep), horizonDays);
      const holdout = summarise(widest(rows.slice(split), band.keep), horizonDays);
      const clears = inSample.median > 0 && holdout.median > 0 && inSample.winRate > 0.5 && holdout.winRate > 0.5;
      // A cell that clears only because it has too few independent observations to be
      // contradicted is not promising, it is unmeasured. ADR-0027 was nearly mis-read for
      // exactly this reason: the only two cells that cleared carried the smallest effective
      // samples in the grid. Overlapping windows inflate n; eff n is what counts.
      const measured = holdout.effective >= MINIMUM_EFFECTIVE_SAMPLES;
      if (clears && measured) promisingCells += 1;
      if (clears && !measured) underpoweredCells += 1;
      const verdict = clears
        ? (measured ? "<-- PROMISING" : `<-- UNDERPOWERED (eff ${holdout.effective} < ${MINIMUM_EFFECTIVE_SAMPLES}, not evidence)`)
        : "";
      console.log(`  ${band.label.padEnd(8)} in  ${inSample.line}`);
      console.log(`  ${" ".padEnd(8)} out ${holdout.line}   ${verdict}`);
    }
    console.log("");
  }
  console.log(`Cells clearing both halves with an adequate holdout sample: ${promisingCells} of ${HORIZONS_DAYS.length * DISPERSION_BANDS.length}.`);
  if (underpoweredCells > 0) {
    console.log(`Cells clearing the thresholds but on fewer than ${MINIMUM_EFFECTIVE_SAMPLES} effective holdout samples: ${underpoweredCells}. These are not results.`);
  }
  console.log("Cumulative hypotheses tested across ADR-0026 and this script: 18.");
}

void main();
