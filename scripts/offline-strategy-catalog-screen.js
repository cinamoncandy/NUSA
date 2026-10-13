#!/usr/bin/env node
"use strict";
/**
 * Pre-registered catalog screen of widely known strategy families (WO-RESEARCH-20261013-STRATEGY-CATALOG).
 * Read-only: reads frozen close files, prints tables. Places no orders and changes no setting.
 *
 * Pre-registered (committed before the first run; nothing below may change after it):
 * - Data: 60-minute closes = the 383-day file followed by the 250-day file (contiguous, about 633 days, 5 markets);
 *   daily closes = the 1824-day file. Close prices only, so no rule uses highs, lows or volume.
 * - Holdout: the last 120 days of 60m data and the last 365 days of daily data are never used for discovery.
 *   (Disclosure: the daily Donchian 20 was already seen on roughly this daily holdout in the earlier feasibility check.)
 * - Discovery pass: on the discovery part, the 6-window rule of the earlier notes (base mean net > 0 in >= 4 of 6 windows,
 *   UP-window mean > 0, DOWN-window mean > 0, 2x-cost mean net > 0 in >= 4 of 6).
 * - Holdout pass (only discovery passers are evaluated): trade returns pooled over the markets after base costs have a positive
 *   mean, at least 30 trades, and a one-sided z-test p-value below 0.05 / K, where K is the number of configurations in the
 *   whole catalog (Bonferroni, so more tests mean a stricter bar); and the 2x-cost pooled mean is also positive.
 *   The holdout trade count is reported against the Research gate minimum of 50; it is not lowered.
 * - Costs: 0.05% fee + 5 bp slippage per side (base), 2x stress. Long only, fills at the bar close, positions open at a segment
 *   end are closed at its last close. Indicator warm-up uses earlier bars only.
 * - A holdout pass is only eligibility for a formal Research experiment; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "..", "docs", "research-data");
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const WINDOWS = 6;
const WARMUP = 721; // longest lookback (720) plus one

function load60m() {
  const a = read("2026-10-13-upbit-60m-closes-prior-383d.json");
  const b = read("2026-10-12-upbit-60m-closes-250d.json");
  const series = Object.fromEntries(MARKETS.map((m) => [m, [...a[m], ...b[m]]]));
  const bars = Math.min(...MARKETS.map((m) => series[m].length));
  return { name: "60m", barsPerDay: 24, holdoutBars: 120 * 24, closes: Object.fromEntries(MARKETS.map((m) => [m, series[m].slice(-bars).map((r) => r[1])])), times: series[MARKETS[0]].slice(-bars).map((r) => r[0]) };
}
function loadDaily() {
  const d = read("2026-10-13-upbit-1d-closes.json");
  const first = Math.max(...MARKETS.map((m) => d[m][0][0]));
  const series = Object.fromEntries(MARKETS.map((m) => [m, d[m].filter((r) => r[0] >= first)]));
  const bars = Math.min(...MARKETS.map((m) => series[m].length));
  return { name: "1d", barsPerDay: 1, holdoutBars: 365, closes: Object.fromEntries(MARKETS.map((m) => [m, series[m].slice(0, bars).map((r) => r[1])])), times: series[MARKETS[0]].slice(0, bars).map((r) => r[0]) };
}

// ---- indicators (value at t uses closes up to and including t unless named "prev") ----
function cache(c) {
  const memo = new Map();
  const get = (key, build) => { if (!memo.has(key)) memo.set(key, build()); return memo.get(key); };
  const sma = (n) => get(`sma${n}`, () => { const o = new Array(c.length).fill(NaN); let s = 0; for (let i = 0; i < c.length; i += 1) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) o[i] = s / n; } return o; });
  const ema = (n) => get(`ema${n}`, () => { const o = new Array(c.length).fill(NaN); const k = 2 / (n + 1); let e = c[0]; for (let i = 0; i < c.length; i += 1) { e = i === 0 ? c[0] : c[i] * k + e * (1 - k); if (i >= n - 1) o[i] = e; } return o; });
  const sd = (n) => get(`sd${n}`, () => { const m = sma(n); const o = new Array(c.length).fill(NaN); for (let i = n - 1; i < c.length; i += 1) { let s = 0; for (let j = i - n + 1; j <= i; j += 1) s += (c[j] - m[i]) ** 2; o[i] = Math.sqrt(s / n); } return o; });
  const prevHigh = (n) => get(`ph${n}`, () => { const o = new Array(c.length).fill(NaN); for (let i = n; i < c.length; i += 1) { let h = -Infinity; for (let j = i - n; j < i; j += 1) h = Math.max(h, c[j]); o[i] = h; } return o; });
  const prevLow = (n) => get(`pl${n}`, () => { const o = new Array(c.length).fill(NaN); for (let i = n; i < c.length; i += 1) { let l = Infinity; for (let j = i - n; j < i; j += 1) l = Math.min(l, c[j]); o[i] = l; } return o; });
  const rsi = (n) => get(`rsi${n}`, () => { const o = new Array(c.length).fill(NaN); let g = 0; let l = 0; for (let i = 1; i < c.length; i += 1) { const d = c[i] - c[i - 1]; const up = Math.max(d, 0); const dn = Math.max(-d, 0); if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; } if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; });
  const macd = () => get("macd", () => { const f = ema(12); const s = ema(26); const line = c.map((_, i) => f[i] - s[i]); const sig = new Array(c.length).fill(NaN); const k = 2 / 10; let e = NaN; for (let i = 0; i < c.length; i += 1) { if (Number.isNaN(line[i])) continue; e = Number.isNaN(e) ? line[i] : line[i] * k + e * (1 - k); sig[i] = e; } return { line, sig }; });
  const width = () => get("bw", () => { const m = sma(20); const s = sd(20); return c.map((_, i) => (4 * s[i]) / m[i]); });
  return { sma, ema, sd, prevHigh, prevLow, rsi, macd, width };
}

// ---- catalog: single-market enter/exit rules ----
const single = [];
const add = (family, params, make) => single.push({ id: `${family} ${params}`, family, make });
for (const [f, s] of [[5, 20], [10, 50], [20, 100], [50, 200]]) add("SMA_CROSS", `${f}/${s}`, (c, x) => ({ enter: (t) => x.sma(f)[t] > x.sma(s)[t], exit: (t) => x.sma(f)[t] <= x.sma(s)[t] }));
for (const [f, s] of [[12, 26], [20, 50], [50, 200]]) add("EMA_CROSS", `${f}/${s}`, (c, x) => ({ enter: (t) => x.ema(f)[t] > x.ema(s)[t], exit: (t) => x.ema(f)[t] <= x.ema(s)[t] }));
for (const n of [50, 100, 200]) add("PRICE_ABOVE_SMA", `${n}`, (c, x) => ({ enter: (t) => c[t] > x.sma(n)[t], exit: (t) => c[t] <= x.sma(n)[t] }));
for (const n of [20, 50, 100]) add("DONCHIAN", `${n}/${n >> 1}`, (c, x) => ({ enter: (t) => c[t] > x.prevHigh(n)[t], exit: (t) => c[t] < x.prevLow(n >> 1)[t] }));
add("TURTLE", "55/20", (c, x) => ({ enter: (t) => c[t] > x.prevHigh(55)[t], exit: (t) => c[t] < x.prevLow(20)[t] }));
for (const n of [20, 50, 100]) add("REGIME_DONCHIAN", `${n}/${n >> 1}`, (c, x) => ({ enter: (t) => c[t] > x.prevHigh(n)[t] && c[t] > x.sma(200)[t], exit: (t) => c[t] < x.prevLow(n >> 1)[t] }));
for (const k of [2, 2.5]) add("BOLLINGER_BREAKOUT", `20/${k}`, (c, x) => ({ enter: (t) => c[t] > x.sma(20)[t] + k * x.sd(20)[t], exit: (t) => c[t] < x.sma(20)[t] }));
for (const k of [2, 2.5]) add("BOLLINGER_REVERSION", `20/${k}`, (c, x) => ({ enter: (t) => c[t] < x.sma(20)[t] - k * x.sd(20)[t], exit: (t) => c[t] >= x.sma(20)[t] }));
for (const [n, z] of [[20, 2], [50, 2]]) add("ZSCORE_REVERSION", `${n}/${z}`, (c, x) => ({ enter: (t) => (c[t] - x.sma(n)[t]) / x.sd(n)[t] < -z, exit: (t) => c[t] >= x.sma(n)[t] }));
for (const [n, lo] of [[14, 30], [14, 25], [7, 20]]) add("RSI_REVERSION", `${n}/${lo}`, (c, x) => ({ enter: (t) => x.rsi(n)[t] < lo, exit: (t) => x.rsi(n)[t] > 50 }));
add("CONNORS_RSI2", "trend200", (c, x) => ({ enter: (t) => c[t] > x.sma(200)[t] && x.rsi(2)[t] < 10, exit: (t) => x.rsi(2)[t] > 70 }));
for (const hi of [60, 70]) add("RSI_MOMENTUM", `14/${hi}`, (c, x) => ({ enter: (t) => x.rsi(14)[t] > hi, exit: (t) => x.rsi(14)[t] < 50 }));
add("MACD", "12/26/9", (c, x) => ({ enter: (t) => x.macd().line[t] > x.macd().sig[t], exit: (t) => x.macd().line[t] <= x.macd().sig[t] }));
add("MACD_ZERO", "12/26", (c, x) => ({ enter: (t) => x.macd().line[t] > 0, exit: (t) => x.macd().line[t] <= 0 }));
for (const n of [24, 72, 168, 720]) add("TSMOM", `${n}`, (c) => ({ enter: (t) => c[t] > c[t - n], exit: (t) => c[t] <= c[t - n] }));
for (const [n, th] of [[24, 0.03], [168, 0.1]]) add("ROC_THRESHOLD", `${n}/${th}`, (c) => ({ enter: (t) => c[t] / c[t - n] - 1 > th, exit: (t) => c[t] < c[t - n] }));
add("SQUEEZE", "20/120/0.2", (c, x) => ({ enter: (t) => { const w = x.width(); let below = 0; for (let k = t - 120; k < t; k += 1) if (w[k] < w[t - 1]) below += 1; return below / 120 <= 0.2 && c[t] > x.prevHigh(20)[t]; }, exit: (t) => c[t] < x.prevLow(10)[t] }));
add("DIP_IN_UPTREND", "200/5%", (c, x) => ({ enter: (t) => c[t] > x.sma(200)[t] && c[t] < x.prevHigh(20)[t] * 0.95, exit: (t) => c[t] > x.prevHigh(20)[t] || c[t] < x.sma(200)[t] }));
add("DUAL_TREND", "50>200 & tsmom", (c, x) => ({ enter: (t) => x.sma(50)[t] > x.sma(200)[t] && c[t] > c[t - 168], exit: (t) => x.sma(50)[t] <= x.sma(200)[t] || c[t] <= c[t - 168] }));

// calendar rules use bar timestamps
const calendar = [];
for (const [from, to] of [[0, 8], [8, 16], [16, 24]]) calendar.push({ id: `HOUR_SESSION UTC${from}-${to}`, family: "HOUR_SESSION", only: "60m", hold: (ms) => { const h = new Date(ms).getUTCHours(); return h >= from && h < to; } });
calendar.push({ id: "WEEKEND_HOLD", family: "WEEKEND", only: null, hold: (ms) => [0, 6].includes(new Date(ms).getUTCDay()) });
calendar.push({ id: "WEEKDAY_HOLD", family: "WEEKDAY", only: null, hold: (ms) => ![0, 6].includes(new Date(ms).getUTCDay()) });

// cross-sectional rotation over the five markets
const rotations = [];
for (const lb of [24, 168, 720]) rotations.push({ id: `ROTATION_BEST lb${lb}`, family: "ROTATION", lookback: lb, absolute: false });
for (const lb of [168, 720]) rotations.push({ id: `DUAL_MOMENTUM lb${lb}`, family: "DUAL_MOMENTUM", lookback: lb, absolute: true });

// ---- simulation ----
function runSingle(rule, c, start, end, fee, slip) {
  const r = []; let entry = null;
  for (let t = Math.max(start, WARMUP); t < end; t += 1) {
    if (entry === null && rule.enter(t)) entry = c[t] * (1 + slip);
    else if (entry !== null && rule.exit(t)) { r.push((c[t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); entry = null; }
  }
  if (entry !== null) r.push((c[end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return r;
}
function runCalendar(rule, c, times, start, end, fee, slip) {
  return runSingle({ enter: (t) => rule.hold(times[t + 1] ?? Infinity), exit: (t) => !rule.hold(times[t + 1] ?? Infinity) }, c, start, end, fee, slip);
}
/** Holds at most one market: the best lookback return (and, for dual momentum, only if positive). Rebalances each 24 bars on 60m, 7 on 1d. */
function runRotation(rule, closes, step, start, end, fee, slip) {
  const r = []; let held = null; let entry = null;
  for (let t = Math.max(start, WARMUP); t < end; t += step) {
    const scores = MARKETS.map((m) => closes[m][t] / closes[m][t - rule.lookback] - 1);
    const best = scores.indexOf(Math.max(...scores));
    const want = rule.absolute && scores[best] <= 0 ? null : MARKETS[best];
    if (held !== null && held !== want) { r.push((closes[held][t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); held = null; }
    if (held === null && want !== null) { held = want; entry = closes[want][t] * (1 + slip); }
  }
  if (held !== null) r.push((closes[held][end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return r;
}

const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
function normalSf(z) { // one-sided upper tail, Abramowitz-Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

const datasets = [load60m(), loadDaily()];
const configs = [];
for (const ds of datasets) {
  for (const s of single) configs.push({ ds, kind: "single", rule: s });
  for (const s of calendar) if (s.only === null || s.only === ds.name) configs.push({ ds, kind: "calendar", rule: s });
  for (const s of rotations) configs.push({ ds, kind: "rotation", rule: s });
}
const K = configs.length;
const ALPHA = 0.05 / K;
console.log(`catalog: ${K} configurations; holdout p-value bar ${ALPHA.toExponential(2)}`);

const caches = new Map();
const rotationStep = (ds) => (ds.name === "60m" ? 24 : 7);
function returnsFor(cfg, start, end, fee, slip) {
  const { ds, kind, rule } = cfg;
  if (kind === "rotation") return [runRotation(rule, ds.closes, rotationStep(ds), start, end, fee, slip)];
  return MARKETS.map((m) => {
    if (kind === "calendar") return runCalendar(rule, ds.closes[m], ds.times, start, end, fee, slip);
    const key = `${ds.name}:${m}`; if (!caches.has(key)) caches.set(key, cache(ds.closes[m]));
    return runSingle(rule.make(ds.closes[m], caches.get(key)), ds.closes[m], start, end, fee, slip);
  });
}

const rows = [];
for (const ds of datasets) {
  const bars = ds.times.length;
  const discoveryEnd = bars - ds.holdoutBars;
  const size = Math.floor((discoveryEnd - WARMUP) / WINDOWS);
  const offset = discoveryEnd - size * WINDOWS;
  ds.windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);
  ds.regime = ds.windows.map(([s, e]) => (mean(MARKETS.map((m) => ds.closes[m][e - 1] / ds.closes[m][s] - 1)) > 0 ? "UP" : "DOWN"));
  ds.discoveryEnd = discoveryEnd;
  const day = (i) => new Date(ds.times[Math.min(i, bars - 1)]).toISOString().slice(0, 10);
  console.log(`\n${ds.name}: ${bars} bars; discovery windows ${ds.windows.map(([s, e], i) => `W${i + 1} ${day(s)}..${day(e - 1)} ${ds.regime[i]}`).join("; ")}; holdout ${day(discoveryEnd)}..${day(bars - 1)}`);
}
for (const cfg of configs) {
  const { ds } = cfg;
  const base = []; const stress = [];
  for (const [s, e] of ds.windows) {
    base.push(mean(returnsFor(cfg, s, e, 0.0005, 0.0005).map(net)));
    stress.push(mean(returnsFor(cfg, s, e, 0.001, 0.001).map(net)));
  }
  const up = base.filter((_, i) => ds.regime[i] === "UP"); const down = base.filter((_, i) => ds.regime[i] === "DOWN");
  const discovery = base.filter((x) => x > 0).length >= 4 && up.length > 0 && down.length > 0 && mean(up) > 0 && mean(down) > 0 && stress.filter((x) => x > 0).length >= 4;
  const row = { id: `${ds.name} ${cfg.rule.id}`, family: cfg.rule.family, positive: base.filter((x) => x > 0).length, up: mean(up), down: mean(down), discovery };
  if (discovery) {
    const end = ds.times.length;
    const trades = returnsFor(cfg, ds.discoveryEnd, end, 0.0005, 0.0005).flat();
    const stressed = returnsFor(cfg, ds.discoveryEnd, end, 0.001, 0.001).flat();
    const m = mean(trades); const v = trades.length > 1 ? trades.reduce((a, x) => a + (x - m) ** 2, 0) / (trades.length - 1) : 0;
    const z = v > 0 ? m / Math.sqrt(v / trades.length) : 0;
    const p = normalSf(z);
    Object.assign(row, { holdoutTrades: trades.length, holdoutMean: m * 100, holdoutStressMean: mean(stressed) * 100, p, holdout: m > 0 && trades.length >= 30 && p < ALPHA && mean(stressed) > 0 });
  }
  rows.push(row);
}
console.log("\nconfiguration | +windows | UP mean | DOWN mean | discovery | holdout trades | holdout mean/trade | 2x mean/trade | p | holdout pass");
for (const r of rows) console.log(`${r.id} | ${r.positive}/6 | ${fmt(r.up)} | ${fmt(r.down)} | ${r.discovery ? "PASS" : "fail"}${r.discovery ? ` | ${r.holdoutTrades} | ${fmt(r.holdoutMean)} | ${fmt(r.holdoutStressMean)} | ${r.p.toExponential(2)} | ${r.holdout ? "PASS" : "fail"}${r.holdout && r.holdoutTrades < 50 ? " (below the Research 50-trade minimum)" : ""}` : ""}`);
const discovered = rows.filter((r) => r.discovery); const survived = rows.filter((r) => r.holdout);
console.log(`\nSUMMARY: ${K} configurations, ${discovered.length} passed discovery, ${survived.length} passed the holdout${survived.length ? `: ${survived.map((r) => r.id).join(", ")}` : ""}`);
