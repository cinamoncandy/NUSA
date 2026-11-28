#!/usr/bin/env node
"use strict";
/**
 * Pre-registered DISCOVERY screen of famous-trader rules that use high, low and volume (WO-RESEARCH-20261125-FAMOUS-SCREEN).
 * Read-only: reads frozen OHLCV files, prints tables. Places no orders and changes no setting.
 *
 * Pre-registered (committed before the first run; nothing below may change after it):
 * - Data: docs/research-data 60m OHLCV and 1d OHLCV, 5 markets (BTC, ETH, XRP, SOL, DOGE), long only, fills at the bar close.
 * - The last 120 days of 60m data and the last 365 days of daily data were already read by the 2026-10-13 catalog screen,
 *   so they are NOT a clean holdout. Here they are only a second filter; passing is eligibility for a FORWARD pre-registration,
 *   never evidence of an edge and never a promotion.
 * - K = 12 configurations (rules below). Discovery pass = the 6-window rule of the earlier notes (base mean net > 0 in >= 4 of 6
 *   windows, UP-window mean > 0, DOWN-window mean > 0, 2x-cost mean net > 0 in >= 4 of 6). Second filter = pooled trades over the
 *   markets in the last part: positive mean, >= 30 trades, one-sided z p < 0.05 / K, 2x-cost mean > 0.
 * - Costs: 0.05% fee + 5 bp slippage per side (base), 2x stress. Position open at the end is closed at the last close.
 * - Periods are in days; on 60m data one day = 24 bars. Minervini and Weinstein use 150-250 day windows: daily data only.
 * Rules (each fixed, no fitting):
 *   DARVAS_BOX     enter: close > highest high of prior 20 days and volume > 1.5 x mean volume of prior 20 days; exit: close < lowest low of prior 10 days.
 *   LIVERMORE_PIVOT enter: range of prior 10 days (highest high - lowest low) / close < 15 percent and close > highest high of prior 10 days; exit: close < lowest low of prior 10 days.
 *   ONEIL_BASE     enter: close > highest high of prior 50 days and volume > 1.5 x mean volume of prior 50 days; exit: close < mean close of 10 days.
 *   RASCHKE_PULLBACK enter: EMA20 > SMA50 and low <= EMA20 and close > EMA20; exit: close < SMA50.
 *   VOLUME_SPIKE   enter: volume > 3 x mean volume of prior 20 days and close > open; exit: close < mean close of 20 days.
 *   MINERVINI_TEMPLATE (daily) enter: close > SMA50, SMA150, SMA200; SMA150 > SMA200; SMA200 > SMA200 20 days earlier; close within 25 percent of the 250-day high and >= 1.3 x the 250-day low; exit: close < SMA50.
 *   WEINSTEIN_STAGE2 (daily) enter: close > SMA150 and SMA150 > SMA150 20 days earlier; exit: close < SMA150.
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "..", "docs", "research-data");
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const WINDOWS = 6;

function loadOhlcv(file, name, barsPerDay, lastDays) {
  const d = read(file);
  const rows = Object.fromEntries(MARKETS.map((m) => [m, d[m]]));
  const first = Math.max(...MARKETS.map((m) => rows[m][0][0]));
  const series = Object.fromEntries(MARKETS.map((m) => [m, rows[m].filter((r) => r[0] >= first)]));
  const bars = Math.min(...MARKETS.map((m) => series[m].length));
  const col = (i) => Object.fromEntries(MARKETS.map((m) => [m, series[m].slice(0, bars).map((r) => r[i])]));
  return { name, barsPerDay, holdoutBars: lastDays * barsPerDay, times: series[MARKETS[0]].slice(0, bars).map((r) => r[0]), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) };
}

function indicators(S, D) {
  const n = S.c.length; const memo = new Map();
  const get = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  const mean = (arr, p) => get(`m${arr === S.c ? "c" : "v"}${p}`, () => { const o = new Array(n).fill(NaN); let s = 0; for (let i = 0; i < n; i += 1) { s += arr[i]; if (i >= p) s -= arr[i - p]; if (i >= p - 1) o[i] = s / p; } return o; });
  const prevMean = (arr, p) => { const m = mean(arr, p); return get(`pm${arr === S.c ? "c" : "v"}${p}`, () => m.map((_, i) => (i > 0 ? m[i - 1] : NaN))); };
  const prevMax = (arr, p) => get(`px${p}${arr === S.h ? "h" : "c"}`, () => { const o = new Array(n).fill(NaN); for (let i = p; i < n; i += 1) { let x = -Infinity; for (let j = i - p; j < i; j += 1) x = Math.max(x, arr[j]); o[i] = x; } return o; });
  const prevMin = (arr, p) => get(`pn${p}`, () => { const o = new Array(n).fill(NaN); for (let i = p; i < n; i += 1) { let x = Infinity; for (let j = i - p; j < i; j += 1) x = Math.min(x, arr[j]); o[i] = x; } return o; });
  const ema = (p) => get(`e${p}`, () => { const o = new Array(n).fill(NaN); const k = 2 / (p + 1); let e = S.c[0]; for (let i = 0; i < n; i += 1) { e = i === 0 ? S.c[0] : S.c[i] * k + e * (1 - k); o[i] = e; } return o; });
  return { mean, prevMean, prevMax, prevMin, ema, D };
}

const rules = [];
const add = (id, only, make) => rules.push({ id, only, make });
add("DARVAS_BOX", null, (S, x, D) => ({ enter: (t) => S.c[t] > x.prevMax(S.h, 20 * D)[t] && S.v[t] > 1.5 * x.prevMean(S.v, 20 * D)[t], exit: (t) => S.c[t] < x.prevMin(S.l, 10 * D)[t] }));
add("LIVERMORE_PIVOT", null, (S, x, D) => ({ enter: (t) => (x.prevMax(S.h, 10 * D)[t] - x.prevMin(S.l, 10 * D)[t]) / S.c[t] < 0.15 && S.c[t] > x.prevMax(S.h, 10 * D)[t], exit: (t) => S.c[t] < x.prevMin(S.l, 10 * D)[t] }));
add("ONEIL_BASE", null, (S, x, D) => ({ enter: (t) => S.c[t] > x.prevMax(S.h, 50 * D)[t] && S.v[t] > 1.5 * x.prevMean(S.v, 50 * D)[t], exit: (t) => S.c[t] < x.mean(S.c, 10 * D)[t] }));
add("RASCHKE_PULLBACK", null, (S, x, D) => ({ enter: (t) => x.ema(20 * D)[t] > x.mean(S.c, 50 * D)[t] && S.l[t] <= x.ema(20 * D)[t] && S.c[t] > x.ema(20 * D)[t], exit: (t) => S.c[t] < x.mean(S.c, 50 * D)[t] }));
add("VOLUME_SPIKE", null, (S, x, D) => ({ enter: (t) => S.v[t] > 3 * x.prevMean(S.v, 20 * D)[t] && S.c[t] > S.o[t], exit: (t) => S.c[t] < x.mean(S.c, 20 * D)[t] }));
add("MINERVINI_TEMPLATE", "1d", (S, x) => ({ enter: (t) => S.c[t] > x.mean(S.c, 50)[t] && S.c[t] > x.mean(S.c, 150)[t] && S.c[t] > x.mean(S.c, 200)[t] && x.mean(S.c, 150)[t] > x.mean(S.c, 200)[t] && x.mean(S.c, 200)[t] > x.mean(S.c, 200)[t - 20] && S.c[t] >= 0.75 * x.prevMax(S.h, 250)[t] && S.c[t] >= 1.3 * x.prevMin(S.l, 250)[t], exit: (t) => S.c[t] < x.mean(S.c, 50)[t] }));
add("WEINSTEIN_STAGE2", "1d", (S, x) => ({ enter: (t) => S.c[t] > x.mean(S.c, 150)[t] && x.mean(S.c, 150)[t] > x.mean(S.c, 150)[t - 20], exit: (t) => S.c[t] < x.mean(S.c, 150)[t] }));

const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
function normalSf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; }

function runSingle(rule, c, start, end, fee, slip) {
  const r = []; let entry = null;
  for (let t = start; t < end; t += 1) {
    if (entry === null && rule.enter(t)) entry = c[t] * (1 + slip);
    else if (entry !== null && rule.exit(t)) { r.push((c[t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); entry = null; }
  }
  if (entry !== null) r.push((c[end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return r;
}

const datasets = [loadOhlcv("2026-10-13-upbit-60m-ohlcv.json", "60m", 24, 120), loadOhlcv("2026-10-13-upbit-1d-ohlcv.json", "1d", 1, 365)];
const configs = [];
for (const ds of datasets) for (const r of rules) if (r.only === null || r.only === ds.name) configs.push({ ds, rule: r });
const K = configs.length; const ALPHA = 0.05 / K;
console.log(`famous screen: ${K} configurations; second-filter p-value bar ${ALPHA.toExponential(2)}`);

const WARM = (ds) => (ds.name === "1d" ? 251 : 51 * 24);
const caches = new Map();
function returnsFor(cfg, start, end, fee, slip) {
  const { ds, rule } = cfg;
  return MARKETS.map((m) => {
    const S = { o: ds.o[m], h: ds.h[m], l: ds.l[m], c: ds.c[m], v: ds.v[m] };
    const key = `${ds.name}:${m}`; if (!caches.has(key)) caches.set(key, indicators(S, ds.barsPerDay));
    return runSingle(rule.make(S, caches.get(key), ds.barsPerDay), S.c, Math.max(start, WARM(ds)), end, fee, slip);
  });
}

const rows = [];
for (const ds of datasets) {
  const bars = ds.times.length; const discoveryEnd = bars - ds.holdoutBars;
  const size = Math.floor((discoveryEnd - WARM(ds)) / WINDOWS); const offset = discoveryEnd - size * WINDOWS;
  ds.windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);
  ds.regime = ds.windows.map(([s, e]) => (mean(MARKETS.map((m) => ds.c[m][e - 1] / ds.c[m][s] - 1)) > 0 ? "UP" : "DOWN"));
  ds.discoveryEnd = discoveryEnd;
  const day = (i) => new Date(ds.times[Math.min(i, bars - 1)]).toISOString().slice(0, 10);
  console.log(`\n${ds.name}: ${bars} bars; windows ${ds.windows.map(([s, e], i) => `W${i + 1} ${day(s)}..${day(e - 1)} ${ds.regime[i]}`).join("; ")}; last part ${day(discoveryEnd)}..${day(bars - 1)}`);
}
for (const cfg of configs) {
  const { ds } = cfg; const base = []; const stress = [];
  for (const [s, e] of ds.windows) { base.push(mean(returnsFor(cfg, s, e, 0.0005, 0.0005).map(net))); stress.push(mean(returnsFor(cfg, s, e, 0.001, 0.001).map(net))); }
  const up = base.filter((_, i) => ds.regime[i] === "UP"); const down = base.filter((_, i) => ds.regime[i] === "DOWN");
  const discovery = base.filter((x) => x > 0).length >= 4 && up.length > 0 && down.length > 0 && mean(up) > 0 && mean(down) > 0 && stress.filter((x) => x > 0).length >= 4;
  const row = { id: `${ds.name} ${cfg.rule.id}`, positive: base.filter((x) => x > 0).length, up: mean(up), down: mean(down), discovery };
  const end = ds.times.length;
  const trades = returnsFor(cfg, ds.discoveryEnd, end, 0.0005, 0.0005).flat(); const stressed = returnsFor(cfg, ds.discoveryEnd, end, 0.001, 0.001).flat();
  const m = mean(trades); const v = trades.length > 1 ? trades.reduce((a, x) => a + (x - m) ** 2, 0) / (trades.length - 1) : 0;
  const p = normalSf(v > 0 ? m / Math.sqrt(v / trades.length) : 0);
  Object.assign(row, { lastTrades: trades.length, lastMean: m * 100, lastStress: mean(stressed) * 100, p, second: m > 0 && trades.length >= 30 && p < ALPHA && mean(stressed) > 0 });
  rows.push(row);
}
console.log("\nconfiguration | +windows | UP mean | DOWN mean | discovery | last-part trades | mean/trade | 2x mean/trade | p | second filter");
for (const r of rows) console.log(`${r.id} | ${r.positive}/6 | ${fmt(r.up)} | ${fmt(r.down)} | ${r.discovery ? "PASS" : "fail"} | ${r.lastTrades} | ${fmt(r.lastMean)} | ${fmt(r.lastStress)} | ${r.p.toExponential(2)} | ${r.second ? "PASS" : "fail"}`);
const both = rows.filter((r) => r.discovery && r.second);
console.log(`\nSUMMARY: ${K} configurations, ${rows.filter((r) => r.discovery).length} passed discovery, ${both.length} passed both${both.length ? `: ${both.map((r) => r.id).join(", ")}` : ""}`);
