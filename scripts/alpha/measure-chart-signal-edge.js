"use strict";
/**
 * Tests whether the signal that actually reaches a live PAPER decision predicts anything.
 *
 * `upbitTickerObservation.ts` is the only producer of intelligence observations in the running
 * system, and its score is the 24-hour change rate put through CHART_NORMALIZATION_V1. Nothing
 * in the repository had ever measured whether that score forecasts forward returns; the
 * evaluation framework -- calibration, multiple-testing correction, abstention -- had never been
 * given a number to score.
 *
 * Design fixed BEFORE running, so the result is a test rather than a search:
 *   - horizons: 8h (the floor from ADR-0024) and 24h
 *   - markets: the KRW majors passed on the command line, reported individually AND pooled
 *   - statistics: Spearman IC, mean forward return per signal bucket, and the top bucket net of
 *     a 0.172% round trip
 *   - every bucket is reported, including the ones that disagree
 *
 * An IC near zero means the score carries no forecast, whatever its buckets look like.
 *
 *   node scripts/alpha/measure-chart-signal-edge.js --markets KRW-BTC,KRW-ETH --candles 5000
 */
const { setTimeout: sleep } = require("node:timers/promises");
const { normalizeChartChangeRate } = require("../../dist/apps/cloud/src/chartSignalNormalization.js");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
};

const ROUND_TRIP = 0.00172;

async function fetchHourly(market, wanted) {
  const rows = [];
  let to;
  while (rows.length < wanted) {
    const url = `https://api.upbit.com/v1/candles/minutes/60?market=${encodeURIComponent(market)}&count=200${to == null ? "" : `&to=${encodeURIComponent(to)}`}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${market}: Upbit responded ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    to = page[page.length - 1].candle_date_time_utc;
    await sleep(140);
  }
  return rows.slice(0, wanted).reverse();
}

/** Rank correlation, so a handful of violent candles cannot carry the result. */
function spearman(xs, ys) {
  const rank = (values) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    let position = 0;
    while (position < order.length) {
      let end = position;
      while (end + 1 < order.length && order[end + 1].value === order[position].value) end += 1;
      const shared = (position + end) / 2 + 1;
      for (let index = position; index <= end; index += 1) ranks[order[index].index] = shared;
      position = end + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let index = 0; index < n; index += 1) {
    const a = rx[index] - mx;
    const b = ry[index] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

const mean = (values) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

/** Buckets fixed in advance; the dead zone gets its own so a flat signal is not averaged away. */
function bucketOf(score) {
  if (score <= -0.5) return "STRONG_DOWN";
  if (score < 0) return "DOWN";
  if (score === 0) return "FLAT (dead zone)";
  if (score < 0.5) return "UP";
  return "STRONG_UP";
}

/**
 * Median is reported beside the mean because a bucket whose winners are fewer than half its
 * windows is a tail bet, not an edge: the mean can be carried by a handful of large moves that a
 * live strategy would have to survive the drawdown to collect.
 */
const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

function analyse(closes, horizon) {
  const observations = [];
  // The signal at t is the 24h change ending at t; forward return runs t -> t+horizon.
  for (let index = 24; index + horizon < closes.length; index += 1) {
    const change = (closes[index] - closes[index - 24]) / closes[index - 24];
    const forward = (closes[index + horizon] - closes[index]) / closes[index];
    observations.push({ score: normalizeChartChangeRate(change), forward });
  }
  const buckets = new Map();
  for (const observation of observations) {
    const key = bucketOf(observation.score);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(observation.forward);
  }
  const order = ["STRONG_DOWN", "DOWN", "FLAT (dead zone)", "UP", "STRONG_UP"];
  const allForward = observations.map((o) => o.forward);
  // What holding blindly returned over the same period. A bucket only has an edge to the extent
  // it beats this; in a rising market every bucket looks good and none of it is the signal.
  const baseline = mean(allForward);
  return {
    observations: observations.length,
    // Adjacent windows share all but one hour, so independent samples are roughly n / horizon.
    effectiveIndependentSamples: Math.round(observations.length / horizon),
    unconditionalForwardPercent: Number((baseline * 100).toFixed(4)),
    informationCoefficient: Number(spearman(observations.map((o) => o.score), observations.map((o) => o.forward)).toFixed(4)),
    buckets: order.filter((key) => buckets.has(key)).map((key) => {
      const forwards = buckets.get(key);
      const average = mean(forwards);
      return {
        bucket: key,
        count: forwards.length,
        meanForwardPercent: Number((average * 100).toFixed(4)),
        medianForwardPercent: Number((median(forwards) * 100).toFixed(4)),
        excessOverBaselinePercent: Number(((average - baseline) * 100).toFixed(4)),
        shareUp: Number((forwards.filter((value) => value > 0).length / forwards.length).toFixed(3)),
        // A long in this bucket, net of one round trip. Shorting is not available on Upbit spot.
        netOfCostsPercent: Number(((average - ROUND_TRIP) * 100).toFixed(4))
      };
    })
  };
}

async function main() {
  const markets = argument("markets", "KRW-BTC,KRW-ETH,KRW-XRP,KRW-SOL,KRW-DOGE").split(",");
  const wanted = Number(argument("candles", "5000"));
  const horizons = argument("horizons", "8,24").split(",").map(Number);

  const perMarket = [];
  const pooled = new Map(horizons.map((horizon) => [horizon, { scores: [], forwards: [] }]));

  for (const market of markets) {
    const candles = await fetchHourly(market.trim(), wanted);
    const closes = candles.map((candle) => candle.trade_price);
    const entry = { market: market.trim(), candles: closes.length, span: { from: candles[0].candle_date_time_kst, to: candles[candles.length - 1].candle_date_time_kst }, horizons: {} };
    for (const horizon of horizons) {
      entry.horizons[`${horizon}h`] = analyse(closes, horizon);
      // The cheapest out-of-sample check available: a finding that holds in one half and
      // reverses in the other was a property of the period, not of the signal.
      const cut = Math.floor(closes.length / 2);
      const half = (slice) => {
        const found = analyse(slice, horizon).buckets.find((bucket) => bucket.bucket === "STRONG_UP");
        return found == null ? null : { n: found.count, excess: found.excessOverBaselinePercent, shareUp: found.shareUp };
      };
      entry.horizons[`${horizon}h`].strongUpSplitHalf = {
        firstHalf: half(closes.slice(0, cut)),
        secondHalf: half(closes.slice(cut))
      };
      for (let index = 24; index + horizon < closes.length; index += 1) {
        const change = (closes[index] - closes[index - 24]) / closes[index - 24];
        pooled.get(horizon).scores.push(normalizeChartChangeRate(change));
        pooled.get(horizon).forwards.push((closes[index + horizon] - closes[index]) / closes[index]);
      }
    }
    perMarket.push(entry);
  }

  const pooledOut = {};
  for (const [horizon, data] of pooled) {
    pooledOut[`${horizon}h`] = {
      observations: data.scores.length,
      informationCoefficient: Number(spearman(data.scores, data.forwards).toFixed(4))
    };
  }

  console.log(JSON.stringify({
    signal: "CHART_NORMALIZATION_V1 over the 24h change rate -- the only signal reaching a live PAPER decision",
    roundTripPercent: ROUND_TRIP * 100,
    perMarket, pooled: pooledOut,
    note: "Overlapping windows: adjacent observations share hours, so significance is weaker than the count suggests."
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
