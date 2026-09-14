"use strict";
/**
 * Does ranking the KRW majors by trailing return pick a better one than holding the basket?
 *
 * PRE-COMMITTED BEFORE ANY RESULT WAS SEEN
 * ----------------------------------------
 * Hypothesis: on Upbit KRW spot, the major with the highest trailing k-day return outperforms an
 * equal-weight basket of the same majors over the following k days, by more than the round-trip
 * cost of rotating into it.
 *
 * Why this candidate and not another: the only signal reaching a live decision here is
 * time-series (a single market's own 24h change), and it has no demonstrable edge over 500 days
 * (ADR-0025). Cross-sectional ranking is a different family -- it asks which market, not whether
 * to trade -- and it is long-only, which is the only thing this venue can express. Upbit KRW spot
 * cannot short, so the tradeable form is "hold the top-ranked one" against "hold the basket".
 *
 * Decision rule, fixed in advance:
 *   - Horizons tested: 8, 16, 24, 48, 96 hours of daily bars (8h is UPBIT_MAJOR_HORIZON_FLOOR_HOURS;
 *     anything shorter cannot pay the round trip and is not worth measuring).
 *   - The holdout is the final 30% of the sample in time order, sealed: the in-sample portion picks
 *     nothing, because there is nothing to pick -- the rule has no free parameters beyond k, and
 *     every k is reported.
 *   - A horizon counts as promising only if, in BOTH halves: median excess over the basket exceeds
 *     the round trip, and the win rate exceeds 0.5. Mean alone is not enough; one outlier makes a
 *     mean and decides nothing.
 *   - Overlapping windows inflate sample counts, so effective independent samples are reported as
 *     observations / horizon and any conclusion is read against that, not against the raw count.
 *
 * What would falsify it: a median excess below the round-trip cost, in either half. That is the
 * whole point -- a rule that cannot fail here would tell us nothing.
 *
 * Usage: node scripts/alpha/measure-cross-sectional-momentum.js [--days 500]
 */

const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-ADA"];
const ROUND_TRIP = 0.00032 + 0.0005 * 2 + 0.0002 * 2; // spread + fees + slippage, both legs
const HOLDOUT_FRACTION = 0.3;
/**
 * REVERSAL was added after MOMENTUM returned a negative median at every horizon. It is therefore
 * not an independent hypothesis -- the first result chose it -- and six tests now stand behind any
 * claim here. Both directions are reported whatever they show, so the search cost is visible
 * rather than hidden by reporting only the survivor.
 */
const DIRECTIONS = ["MOMENTUM", "REVERSAL"];
const HORIZONS_DAYS = [1, 2, 4];       // 24h, 48h, 96h
const SHORT_HORIZONS_HOURS = [8, 16];  // reported for completeness; below one daily bar

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
  // Upbit returns newest first; ascending is the only order a backtest may read.
  const ascending = collected
    .map((row) => ({ time: Date.parse(`${row.candle_date_time_utc}Z`), close: Number(row.trade_price) }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0)
    .sort((left, right) => left.time - right.time);
  // Drop any duplicate timestamps rather than reordering: a manufactured sequence is not data.
  return ascending.filter((row, index) => index === 0 || row.time !== ascending[index - 1].time);
}

const median = (values) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function evaluate(series, horizonDays, direction) {
  const length = Math.min(...MARKETS.map((market) => series[market].length));
  const excess = [];
  for (let index = horizonDays; index + horizonDays < length; index += 1) {
    const trailing = MARKETS.map((market) => ({
      market,
      value: series[market][index].close / series[market][index - horizonDays].close - 1
    }));
    const top = direction === "MOMENTUM"
      ? trailing.reduce((best, row) => (row.value > best.value ? row : best))
      : trailing.reduce((worst, row) => (row.value < worst.value ? row : worst));
    const forward = (market) => series[market][index + horizonDays].close / series[market][index].close - 1;
    const basket = mean(MARKETS.map(forward));
    // Rotating into the pick costs a round trip; holding the basket is the alternative on the table.
    excess.push(forward(top.market) - basket - ROUND_TRIP);
  }
  return excess;
}

function report(label, excess, horizonDays) {
  const wins = excess.filter((value) => value > 0).length;
  const effective = Math.floor(excess.length / horizonDays);
  console.log(
    `  ${label.padEnd(10)} n=${String(excess.length).padStart(4)} (effective ${String(effective).padStart(3)})` +
    `  median ${(median(excess) * 100).toFixed(3)}%  mean ${(mean(excess) * 100).toFixed(3)}%  win ${(wins / excess.length * 100).toFixed(1)}%`
  );
  return { median: median(excess), winRate: wins / excess.length };
}

async function main() {
  const days = argument("days", 500);
  console.log(`Cross-sectional momentum on ${MARKETS.join(", ")}`);
  console.log(`Round trip charged per rotation: ${(ROUND_TRIP * 100).toFixed(3)}%`);
  console.log(`Horizons below one daily bar (${SHORT_HORIZONS_HOURS.join("h, ")}h) are not measurable on daily candles and are skipped.\n`);

  const series = {};
  for (const market of MARKETS) {
    series[market] = await fetchDailyCandles(market, days);
    console.log(`${market}: ${series[market].length} daily bars`);
  }
  console.log("");

  for (const direction of DIRECTIONS) {
  console.log(`=== ${direction} ===`);
  for (const horizonDays of HORIZONS_DAYS) {
    const excess = evaluate(series, horizonDays, direction);
    const split = Math.floor(excess.length * (1 - HOLDOUT_FRACTION));
    console.log(`horizon ${horizonDays * 24}h`);
    const inSample = report("in-sample", excess.slice(0, split), horizonDays);
    const holdout = report("holdout", excess.slice(split), horizonDays);
    const promising = inSample.median > 0 && holdout.median > 0 && inSample.winRate > 0.5 && holdout.winRate > 0.5;
    console.log(`  verdict: ${promising ? "PROMISING -- both halves clear the cost floor" : "NO EDGE DEMONSTRATED"}\n`);
  }
  }
  console.log(`Hypotheses tested: ${DIRECTIONS.length} directions x ${HORIZONS_DAYS.length} horizons = ${DIRECTIONS.length * HORIZONS_DAYS.length}.`);
  console.log("REVERSAL was not independent: it was tested because MOMENTUM came back negative.");
}

void main();
