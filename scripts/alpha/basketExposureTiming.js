"use strict";
/**
 * Shared construction for the basket exposure timing family (ADR-0028).
 *
 * The universe, cost model, holdout split, grid, signal and observation construction live here so
 * that the two measurements over this family -- the ADR-0026/0027 rule and the risk-adjusted rule
 * precommitted in ADR-0028 -- read the same candidate. If each script built its own, the second
 * could drift toward whatever flatters the newer statistic, which is precisely the failure the
 * precommitment is meant to prevent. Only the statistic being read differs between them.
 *
 * Nothing here is a strategy, a registry entry, or an execution path.
 */

// Same five majors and the same round trip as ADR-0026/0027, so the benchmark is literally theirs.
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-ADA"];
const ROUND_TRIP = 0.00032 + 0.0005 * 2 + 0.0002 * 2;
const HOLDOUT_FRACTION = 0.3;
const MINIMUM_EFFECTIVE_SAMPLES = 10;
const LOOKBACKS_DAYS = [14, 30, 60, 90];
const HORIZONS_DAYS = [7, 14, 30];

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

const mean = (values) => (values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length);

const median = (values) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/**
 * One observation per rebalance date. The basket is equal-weight across the five majors, so its
 * return is the mean of the constituents' returns over the same window.
 *
 * The signal at index i reads only closes at or before i, and the outcome is measured strictly
 * after i, so no observation can see its own result. Rebalances step by the horizon, so windows do
 * not overlap and every observation is an independent draw.
 *
 * The held state carries across the in-sample/holdout boundary on purpose: a real overlay arrives
 * at the holdout already in whatever position the prior window left it in, and resetting there
 * would hand the holdout a free entry.
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

module.exports = {
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
};
