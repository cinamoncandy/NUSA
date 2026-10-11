#!/usr/bin/env node
"use strict";
/**
 * Offline SMA cost screen (research note docs/RESEARCH_NOTE_2026-10-08_SMA_COST_SCREEN.md). Read-only: it reads the frozen
 * Upbit 1-minute closes file and prints the note's tables. It places no orders and changes no setting.
 *
 * Model (all choices are stated because they change the numbers):
 * - Input: per market an ascending array of [timestampMs, close]. The timestamp is the last-trade time inside the candle, not the
 *   candle boundary, and minutes without trades are absent, so consecutive entries are NOT guaranteed to be one minute apart.
 * - Bars: k-minute bars are groups of k consecutive entries (last close of the group), not wall-clock buckets.
 * - Signal: at every bar close, short SMA > long SMA opens a position when flat; short SMA < long SMA closes it. Equality does nothing.
 * - Execution: one position, 100% of notional, filled at that bar's close; no latency; slippage in basis points on each side.
 * - Fee: `fee` per side, applied as buy price * (1 + fee) and sell price * (1 - fee).
 * - Return: product of per-trade returns, compounded. A position still open at the end is NOT valued (unrealized is ignored).
 * - The most recent entry of the file may be an unfinished candle (it was fetched while that minute was open).
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "docs", "research-data", "2026-10-08-upbit-1m-closes.json");

function resample(candles, k) {
  const out = [];
  for (let index = 0; index + k <= candles.length; index += k) out.push(candles[index + k - 1]);
  return out;
}

function simulate(closes, shortPeriod, longPeriod, fee, slippageBps) {
  const slip = slippageBps / 1e4;
  const returns = [];
  let entry = null;
  for (let t = longPeriod; t < closes.length; t += 1) {
    const window = closes.slice(t - longPeriod + 1, t + 1).map((item) => item[1]);
    const short = window.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
    const long = window.reduce((a, b) => a + b, 0) / longPeriod;
    if (entry === null && short > long) entry = closes[t][1] * (1 + slip);
    else if (entry !== null && short < long) {
      const exit = closes[t][1] * (1 - slip);
      returns.push((exit * (1 - fee)) / (entry * (1 + fee)) - 1);
      entry = null;
    }
  }
  return returns;
}

function summarize(returns) {
  if (returns.length === 0) return { trades: 0, winRatePct: 0, netPct: 0 };
  const wins = returns.filter((value) => value > 0).length;
  const total = returns.reduce((product, value) => product * (1 + value), 1);
  return { trades: returns.length, winRatePct: Math.round((wins / returns.length) * 100), netPct: Math.round((total - 1) * 10000) / 100 };
}

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const rows = [];
  for (const [market, candles] of Object.entries(data)) {
    const spanHours = Math.round(((candles[candles.length - 1][0] - candles[0][0]) / 3_600_000) * 10) / 10;
    const buyHoldPct = Math.round((candles[candles.length - 1][1] / candles[0][1] - 1) * 10000) / 100;
    rows.push({
      market, entries: candles.length, spanHours, buyHoldPct,
      sma_5_20_1m: { gross: summarize(simulate(candles, 5, 20, 0, 0)), net: summarize(simulate(candles, 5, 20, 0.0005, 0)), net5bps: summarize(simulate(candles, 5, 20, 0.0005, 5)) },
      firstHalf: summarize(simulate(candles.slice(0, candles.length >> 1), 5, 20, 0.0005, 0)),
      secondHalf: summarize(simulate(candles.slice(candles.length >> 1), 5, 20, 0.0005, 0)),
      longerBars: Object.fromEntries([[5, 5, 20], [15, 5, 20], [15, 10, 50], [60, 5, 20]].map(([k, s, l]) => [`${k}m_sma_${s}_${l}`, { gross: summarize(simulate(resample(candles, k), s, l, 0, 0)), net: summarize(simulate(resample(candles, k), s, l, 0.0005, 0)) }])),
    });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main();
