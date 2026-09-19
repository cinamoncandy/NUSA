"use strict";
/**
 * Answers one question with real history: at which holding horizon does Upbit KRW spot move
 * further than a round trip costs?
 *
 * ADR-0023 established that order-book imbalance cannot pay 0.17% per round trip, and that
 * whether any horizon covers it depends on the regime -- measured over 25 minutes, which is far
 * too short to generalise. Candles, unlike order books, ARE available historically, so the same
 * arithmetic can be run over months instead of minutes.
 *
 * The movement reported is the median ABSOLUTE return: what a perfect direction-caller would
 * collect. A horizon where that is below the round trip cannot be traded profitably by anyone,
 * so it bounds the search before any signal is considered. The 25th percentile is reported
 * beside it, because a strategy has to survive its quiet quarter, not just its median one.
 *
 *   node scripts/alpha/measure-candle-horizon-economics.js --market KRW-BTC --unit 60 --candles 2000
 */
const { setTimeout: sleep } = require("node:timers/promises");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
};
const numeric = (name, fallback) => {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
};

const quantile = (sorted, fraction) => {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

/** Upbit serves at most 200 candles per call and pages backwards through `to`. */
async function fetchCandles(market, unit, wanted) {
  const path = unit === "days" ? "days" : `minutes/${unit}`;
  const rows = [];
  let to;
  while (rows.length < wanted) {
    const url = `https://api.upbit.com/v1/candles/${path}?market=${encodeURIComponent(market)}&count=200${to == null ? "" : `&to=${encodeURIComponent(to)}`}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Upbit responded ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    to = page[page.length - 1].candle_date_time_utc;
    await sleep(150);
  }
  // Upbit returns newest first; the analysis reads forward in time.
  return rows.slice(0, wanted).reverse();
}

async function main() {
  const market = argument("market", "KRW-BTC");
  const unit = argument("unit", "60");
  const wanted = numeric("candles", 2000);
  const takerFeeRate = numeric("fee", 0.0005);
  const slippageRate = numeric("slippage", 0.0002);
  const spreadRate = numeric("spread", 0.00032);
  const horizons = (argument("horizons", "1,4,12,24,72,168")).split(",").map(Number);

  const candles = await fetchCandles(market, unit, wanted);
  if (candles.length < 100) throw new Error(`only ${candles.length} candles returned`);
  const closes = candles.map((candle) => candle.trade_price);

  const roundTripRate = spreadRate + takerFeeRate * 2 + slippageRate * 2;
  const minutesPerCandle = unit === "days" ? 1440 : Number(unit);

  const rows = horizons.filter((horizon) => horizon < closes.length / 4).map((horizon) => {
    const moves = [];
    for (let index = 0; index + horizon < closes.length; index += 1) moves.push(Math.abs(closes[index + horizon] - closes[index]) / closes[index]);
    moves.sort((a, b) => a - b);
    const medianMove = quantile(moves, 0.5);
    const quietMove = quantile(moves, 0.25);
    const hours = (horizon * minutesPerCandle) / 60;
    return {
      candles: horizon,
      hours: Number(hours.toFixed(2)),
      medianAbsoluteMovePercent: Number((medianMove * 100).toFixed(4)),
      quietQuartileMovePercent: Number((quietMove * 100).toFixed(4)),
      // Below 1.0 the median window offers more than a round trip costs.
      costToMedianMove: Number((roundTripRate / Math.max(medianMove, 1e-12)).toFixed(2)),
      costToQuietMove: Number((roundTripRate / Math.max(quietMove, 1e-12)).toFixed(2)),
      // The share of a perfect call the costs eat, at the median window.
      viableAtMedian: medianMove > roundTripRate,
      viableInQuietQuartile: quietMove > roundTripRate
    };
  });

  const firstViable = rows.find((row) => row.viableInQuietQuartile);
  console.log(JSON.stringify({
    market,
    unit: unit === "days" ? "1d" : `${unit}m`,
    candles: candles.length,
    span: { from: candles[0].candle_date_time_kst, to: candles[candles.length - 1].candle_date_time_kst },
    roundTripPercent: Number((roundTripRate * 100).toFixed(4)),
    horizons: rows,
    firstHorizonViableInQuietQuartile: firstViable == null ? null : { candles: firstViable.candles, hours: firstViable.hours },
    note: "Median ABSOLUTE move is what a perfect direction-caller collects; it bounds the search before any signal is considered."
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
