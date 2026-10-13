#!/usr/bin/env node
"use strict";
/**
 * Forward (never-seen data) SHADOW evaluation of REGIME_BREAKOUT N=50 (WO-RESEARCH-20261013-FORWARD-REGIME-BREAKOUT).
 * Read-only: fetches public Upbit 60-minute candles, simulates, prints a verdict. Places no orders and changes no setting.
 *
 * Frozen on 2026-10-13, before any forward data exists. Nothing below may change after this commit:
 * - Rule: entry when the close exceeds the highest close of the previous 50 bars AND the close is above SMA(200) AND SMA(200) is
 *   higher than 24 bars earlier; exit when the close falls below the lowest close of the previous 25 bars. Long only, fills at
 *   the bar close, one position per market, markets KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE.
 * - Evaluation starts at FORWARD_START (2026-10-14T00:00:00Z); earlier bars are warm-up only. A position open at the last bar
 *   is closed at the last close.
 * - Costs: 0.05% fee + 5 bp slippage per side (base); 2x stress.
 * - Verdict: INCOMPLETE until 60 days of forward bars exist. Then PASS only if the 5-market mean net after base costs > 0 AND
 *   the mean net under 2x costs > 0 AND at least 20 round trips in total AND at least 3 of 5 markets are positive after base costs.
 * - A PASS only makes the rule eligible for a formal Research experiment; it is not promotion evidence.
 */
const FORWARD_START = Date.parse("2026-10-14T00:00:00Z");
const MIN_DAYS = 60;
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const WARMUP = 224;

async function candles(market, now) {
  const out = [];
  let to = new Date(now).toISOString().slice(0, 19);
  const earliest = FORWARD_START - (WARMUP + 10) * 3_600_000;
  for (let page = 0; page < 200; page += 1) {
    const url = `https://api.upbit.com/v1/candles/minutes/60?market=${market}&count=200&to=${to}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`UPBIT_HTTP_${response.status}`);
    const rows = await response.json();
    if (rows.length === 0) break;
    for (const row of rows) out.push([Date.parse(`${row.candle_date_time_utc}Z`), row.trade_price]);
    const oldest = Date.parse(`${rows[rows.length - 1].candle_date_time_utc}Z`);
    if (oldest <= earliest) break;
    to = new Date(oldest).toISOString().slice(0, 19);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const unique = new Map(out.map((row) => [row[0], row]));
  return [...unique.values()].sort((a, b) => a[0] - b[0]);
}

function simulate(rows, fee, slip) {
  const c = rows.map((row) => row[1]);
  const sma = (t, n) => { let s = 0; for (let i = t - n; i < t; i += 1) s += c[i]; return s / n; };
  const start = rows.findIndex((row) => row[0] >= FORWARD_START);
  const returns = [];
  let entry = null;
  if (start < WARMUP) throw new Error("WARMUP_UNAVAILABLE");
  for (let t = start; t < c.length; t += 1) {
    let high = -Infinity; for (let i = t - 50; i < t; i += 1) high = Math.max(high, c[i]);
    let low = Infinity; for (let i = t - 25; i < t; i += 1) low = Math.min(low, c[i]);
    if (entry === null && c[t] > high && c[t] > sma(t + 1, 200) && sma(t + 1, 200) > sma(t - 23, 200)) entry = c[t] * (1 + slip);
    else if (entry !== null && c[t] < low) { returns.push((c[t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); entry = null; }
  }
  if (entry !== null) returns.push((c[c.length - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return returns;
}
const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

(async () => {
  const now = Date.now();
  const days = (now - FORWARD_START) / 86_400_000;
  if (days <= 0) { console.log("VERDICT INCOMPLETE (forward period has not started)"); return; }
  const base = [];
  const stress = [];
  let trades = 0;
  for (const market of MARKETS) {
    const rows = await candles(market, now);
    const b = simulate(rows, 0.0005, 0.0005);
    trades += b.length;
    base.push(net(b));
    stress.push(net(simulate(rows, 0.001, 0.001)));
    console.log(`${market} trades ${b.length} base ${base.at(-1).toFixed(2)}% 2x ${stress.at(-1).toFixed(2)}%`);
  }
  const positive = base.filter((x) => x > 0).length;
  console.log(`forward days ${days.toFixed(1)}; mean base ${mean(base).toFixed(2)}%; mean 2x ${mean(stress).toFixed(2)}%; trades ${trades}; positive markets ${positive}/5`);
  if (days < MIN_DAYS) { console.log(`VERDICT INCOMPLETE (${days.toFixed(1)} of ${MIN_DAYS} days)`); return; }
  const pass = mean(base) > 0 && mean(stress) > 0 && trades >= 20 && positive >= 3;
  console.log(`VERDICT ${pass ? "PASS" : "FAIL"}`);
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
