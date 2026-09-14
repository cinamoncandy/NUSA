"use strict";
/**
 * Compares what a round trip COSTS against how far price actually MOVES over each candidate
 * holding period, from a recorded order-book dataset.
 *
 * This decides whether a taker strategy on this market can profit at all, before any question
 * of signal quality. The movement reported is the median ABSOLUTE change, so it is the take a
 * perfect oracle would collect -- one that always picked the correct direction. If cost exceeds
 * that, no signal rescues the horizon, and measuring the signal harder is wasted work.
 *
 * The spread matters twice over, and is easy to miss: the backtest fills a BUY at the best ask
 * and a SELL at the best bid, so a taker round trip pays the full spread INSIDE grossPnl, where
 * it does not appear in the fee or slippage lines.
 *
 *   node scripts/alpha/measure-cost-vs-movement.js --data ob.jsonl [--notional 1000000]
 */
const { readFileSync } = require("node:fs");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
};
const numeric = (name, fallback) => {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

function main() {
  const dataPath = argument("data", undefined);
  if (dataPath == null) throw new Error("--data is required");
  const notional = numeric("notional", 1_000_000);
  const takerFeeRate = numeric("fee", 0.0005);
  const slippageRate = numeric("slippage", 0.0002);
  const holds = (argument("holds", "5,10,20,40,80,160,320")).split(",").map(Number);

  const rows = readFileSync(dataPath, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const ordered = [];
  for (const snapshot of rows) {
    const previous = ordered[ordered.length - 1];
    if (previous != null && Date.parse(snapshot.capturedAt) <= Date.parse(previous.capturedAt)) continue;
    ordered.push(snapshot);
  }
  if (ordered.length < 20) throw new Error(`only ${ordered.length} usable snapshots`);

  const mid = (row) => (row.bids[0].price + row.asks[0].price) / 2;
  const mids = ordered.map(mid);
  const spreads = ordered.map((row) => (row.asks[0].price - row.bids[0].price) / mid(row));
  const spreadRate = median(spreads);

  const spreadCost = spreadRate * notional;
  const feeCost = takerFeeRate * notional * 2;
  const slippageCost = slippageRate * notional * 2;
  const roundTrip = spreadCost + feeCost + slippageCost;

  const spanSeconds = (Date.parse(ordered[ordered.length - 1].capturedAt) - Date.parse(ordered[0].capturedAt)) / 1000;
  const secondsPerSnapshot = spanSeconds / Math.max(ordered.length - 1, 1);

  const horizons = holds.filter((hold) => hold < mids.length).map((hold) => {
    const moves = [];
    for (let index = 0; index + hold < mids.length; index += 1) moves.push(Math.abs(mids[index + hold] - mids[index]) / mids[index]);
    const moveRate = median(moves);
    const oracleTake = moveRate * notional;
    return {
      holdSnapshots: hold,
      approxSeconds: Number((hold * secondsPerSnapshot).toFixed(1)),
      medianAbsoluteMoveRate: Number((moveRate * 100).toFixed(4)),
      oracleTake: Math.round(oracleTake),
      // Above 1.0 a perfect direction-caller still loses: cost exceeds the whole move.
      costToOracleRatio: Number((roundTrip / Math.max(oracleTake, 1e-9)).toFixed(2)),
      profitablePossible: oracleTake > roundTrip
    };
  });

  console.log(JSON.stringify({
    dataset: { path: dataPath, snapshots: ordered.length, spanSeconds: Number(spanSeconds.toFixed(1)), secondsPerSnapshot: Number(secondsPerSnapshot.toFixed(2)) },
    market: ordered[0].market,
    roundTripCost: {
      spreadRatePercent: Number((spreadRate * 100).toFixed(4)),
      spread: Math.round(spreadCost),
      fees: Math.round(feeCost),
      slippage: Math.round(slippageCost),
      total: Math.round(roundTrip),
      totalPercent: Number((roundTrip / notional * 100).toFixed(4))
    },
    horizons,
    verdict: horizons.some((horizon) => horizon.profitablePossible)
      ? "Some horizon offers more movement than a round trip costs; signal quality is then the open question."
      : "No horizon tested offers as much movement as a round trip costs. A perfect direction-caller would still lose."
  }, null, 2));
}

main();
