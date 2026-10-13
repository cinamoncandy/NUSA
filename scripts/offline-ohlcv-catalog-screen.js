#!/usr/bin/env node
"use strict";
/**
 * Pre-registered OHLCV catalog screen (WO-RESEARCH-20261013-OHLCV-CATALOG). Read-only: places no orders, changes no setting.
 * `--fetch` downloads public Upbit 60m and daily candles (open, high, low, close, volume) once into frozen files.
 *
 * Pre-registered (committed before the data was fetched or any result seen; nothing below may change after it):
 * - Data: KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE. 60m candles from 2025-01-16 to 2026-10-12 (the span of the earlier close
 *   files) and daily candles from the common start to 2026-10-12. Bars are aligned on candle start time; a market missing a bar is
 *   dropped from that timestamp onward for rotation-free single-market rules only (no rule here crosses markets).
 * - Holdout: the last 120 days (60m) and 365 days (daily), never used for discovery.
 * - Discovery: the 6-window rule of the earlier notes. Holdout (discovery passers only): pooled mean trade > 0 after base costs,
 *   >= 30 trades, one-sided z p < 0.05 / K (K = all configurations here plus the 97 of the close-only catalog = cumulative
 *   Bonferroni), and the 2x-cost pooled mean > 0. The Research 50-trade minimum is reported, not lowered.
 * - Costs: 0.05% fee + 5 bp slippage per side (base), 2x stress. Long only, entries and exits at the bar close.
 * - A holdout pass is only eligibility for a formal Research experiment; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "..", "docs", "research-data");
const FILES = { "60m": path.join(DATA, "2026-10-13-upbit-60m-ohlcv.json"), "1d": path.join(DATA, "2026-10-13-upbit-1d-ohlcv.json") };
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const START_60M = Date.parse("2025-01-16T00:00:00Z");
const END = Date.parse("2026-10-13T00:00:00Z");
const PRIOR_CATALOG = 97;
const WINDOWS = 6;
const WARMUP = 201;

async function fetchSeries(kind, market) {
  const endpoint = kind === "60m" ? "minutes/60" : "days";
  const rows = new Map();
  let to = new Date(END).toISOString().slice(0, 19);
  for (let page = 0; page < 200; page += 1) {
    const response = await fetch(`https://api.upbit.com/v1/candles/${endpoint}?market=${market}&count=200&to=${to}`);
    if (!response.ok) throw new Error(`UPBIT_HTTP_${response.status}`);
    const batch = await response.json();
    if (batch.length === 0) break;
    for (const r of batch) {
      const at = Date.parse(`${r.candle_date_time_utc}Z`);
      if (at < END && (kind === "1d" || at >= START_60M)) rows.set(at, [at, r.opening_price, r.high_price, r.low_price, r.trade_price, r.candle_acc_trade_volume]);
    }
    const oldest = Date.parse(`${batch[batch.length - 1].candle_date_time_utc}Z`);
    if (batch.length < 200 || (kind === "60m" && oldest < START_60M)) break;
    to = new Date(oldest).toISOString().slice(0, 19);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return [...rows.values()].sort((a, b) => a[0] - b[0]);
}

function align(raw) {
  const sets = MARKETS.map((m) => new Set(raw[m].map((r) => r[0])));
  const times = raw[MARKETS[0]].map((r) => r[0]).filter((t) => sets.every((s) => s.has(t)));
  const index = Object.fromEntries(MARKETS.map((m) => [m, new Map(raw[m].map((r) => [r[0], r]))]));
  const series = Object.fromEntries(MARKETS.map((m) => {
    const rows = times.map((t) => index[m].get(t));
    return [m, { o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]), v: rows.map((r) => r[5]) }];
  }));
  return { times, series };
}

function indicators(s) {
  const memo = new Map();
  const get = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  const n = s.c.length;
  const smaOf = (arr, p) => { const o = new Array(n).fill(NaN); let sum = 0; for (let i = 0; i < n; i += 1) { sum += arr[i]; if (i >= p) sum -= arr[i - p]; if (i >= p - 1) o[i] = sum / p; } return o; };
  const emaOf = (arr, p) => { const o = new Array(n).fill(NaN); const k = 2 / (p + 1); let e = arr[0]; for (let i = 0; i < n; i += 1) { e = i === 0 ? arr[0] : arr[i] * k + e * (1 - k); if (i >= p - 1) o[i] = e; } return o; };
  const tr = () => get("tr", () => s.c.map((_, i) => (i === 0 ? s.h[0] - s.l[0] : Math.max(s.h[i] - s.l[i], Math.abs(s.h[i] - s.c[i - 1]), Math.abs(s.l[i] - s.c[i - 1])))));
  const x = {
    sma: (p) => get(`sma${p}`, () => smaOf(s.c, p)),
    ema: (p) => get(`ema${p}`, () => emaOf(s.c, p)),
    vsma: (p) => get(`vsma${p}`, () => smaOf(s.v, p)),
    atr: (p) => get(`atr${p}`, () => { const t = tr(); const o = new Array(n).fill(NaN); let a = 0; for (let i = 0; i < n; i += 1) { a = i < p ? a + t[i] / p : (a * (p - 1) + t[i]) / p; if (i >= p - 1) o[i] = a; } return o; }),
    prevHigh: (p) => get(`ph${p}`, () => { const o = new Array(n).fill(NaN); for (let i = p; i < n; i += 1) { let m = -Infinity; for (let j = i - p; j < i; j += 1) m = Math.max(m, s.h[j]); o[i] = m; } return o; }),
    prevLow: (p) => get(`pl${p}`, () => { const o = new Array(n).fill(NaN); for (let i = p; i < n; i += 1) { let m = Infinity; for (let j = i - p; j < i; j += 1) m = Math.min(m, s.l[j]); o[i] = m; } return o; }),
    stoch: (p) => get(`st${p}`, () => { const o = new Array(n).fill(NaN); for (let i = p - 1; i < n; i += 1) { let hi = -Infinity; let lo = Infinity; for (let j = i - p + 1; j <= i; j += 1) { hi = Math.max(hi, s.h[j]); lo = Math.min(lo, s.l[j]); } o[i] = hi > lo ? (100 * (s.c[i] - lo)) / (hi - lo) : 50; } return o; }),
    obv: () => get("obv", () => { const o = [0]; for (let i = 1; i < n; i += 1) o.push(o[i - 1] + (s.c[i] > s.c[i - 1] ? s.v[i] : s.c[i] < s.c[i - 1] ? -s.v[i] : 0)); return o; }),
    obvSma: (p) => get(`obvs${p}`, () => smaOf(x.obv(), p)),
    mfi: (p) => get(`mfi${p}`, () => { const tp = s.c.map((c, i) => (s.h[i] + s.l[i] + c) / 3); const o = new Array(n).fill(NaN); for (let i = p; i < n; i += 1) { let pos = 0; let neg = 0; for (let j = i - p + 1; j <= i; j += 1) { const f = tp[j] * s.v[j]; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; } o[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg); } return o; }),
    vwap: (p) => get(`vwap${p}`, () => { const o = new Array(n).fill(NaN); let pv = 0; let vv = 0; for (let i = 0; i < n; i += 1) { const tp = (s.h[i] + s.l[i] + s.c[i]) / 3; pv += tp * s.v[i]; vv += s.v[i]; if (i >= p) { const tq = (s.h[i - p] + s.l[i - p] + s.c[i - p]) / 3; pv -= tq * s.v[i - p]; vv -= s.v[i - p]; } if (i >= p - 1 && vv > 0) o[i] = pv / vv; } return o; }),
    adx: (p) => get(`adx${p}`, () => { const t = tr(); const plus = new Array(n).fill(NaN); const minus = new Array(n).fill(NaN); const adx = new Array(n).fill(NaN); let sTr = 0; let sP = 0; let sM = 0; let a = 0; for (let i = 1; i < n; i += 1) { const up = s.h[i] - s.h[i - 1]; const dn = s.l[i - 1] - s.l[i]; const pdm = up > dn && up > 0 ? up : 0; const mdm = dn > up && dn > 0 ? dn : 0; sTr = sTr - sTr / p + t[i]; sP = sP - sP / p + pdm; sM = sM - sM / p + mdm; if (i >= p) { plus[i] = (100 * sP) / sTr; minus[i] = (100 * sM) / sTr; const dx = (100 * Math.abs(plus[i] - minus[i])) / (plus[i] + minus[i] || 1); a = i === p ? dx : (a * (p - 1) + dx) / p; if (i >= 2 * p) adx[i] = a; } } return { plus, minus, adx }; }),
    supertrend: (p, m) => get(`stt${p}_${m}`, () => { const a = x.atr(p); const dir = new Array(n).fill(0); let upper = Infinity; let lower = -Infinity; let d = 1; for (let i = p; i < n; i += 1) { const mid = (s.h[i] + s.l[i]) / 2; const bu = mid + m * a[i]; const bl = mid - m * a[i]; upper = bu < upper || s.c[i - 1] > upper ? bu : upper; lower = bl > lower || s.c[i - 1] < lower ? bl : lower; if (s.c[i] > upper) d = 1; else if (s.c[i] < lower) d = -1; dir[i] = d; } return dir; }),
  };
  return x;
}

// Rules: enter(t) / exit(t, entryIndex, peakClose) evaluated at the close of bar t.
const RULES = [];
const add = (id, make) => RULES.push({ id, make });
for (const k of [1, 1.5]) add(`ATR_BREAKOUT k${k} chandelier3`, (s, x) => ({ enter: (t) => s.c[t] > s.c[t - 1] + k * x.atr(14)[t - 1], exit: (t, e, peak) => s.c[t] < peak - 3 * x.atr(14)[t] }));
add("KELTNER_BREAKOUT 20/2", (s, x) => ({ enter: (t) => s.c[t] > x.ema(20)[t] + 2 * x.atr(20)[t], exit: (t) => s.c[t] < x.ema(20)[t] }));
for (const p of [20, 55]) add(`DONCHIAN_HL ${p}/${p >> 1}`, (s, x) => ({ enter: (t) => s.c[t] > x.prevHigh(p)[t], exit: (t) => s.c[t] < x.prevLow(p >> 1)[t] }));
add("VOLUME_BREAKOUT 20 vol2x", (s, x) => ({ enter: (t) => s.c[t] > x.prevHigh(20)[t] && s.v[t] > 2 * x.vsma(20)[t - 1], exit: (t) => s.c[t] < x.prevLow(10)[t] }));
add("OBV_TREND 20 & sma50", (s, x) => ({ enter: (t) => x.obv()[t] > x.obvSma(20)[t] && s.c[t] > x.sma(50)[t], exit: (t) => x.obv()[t] < x.obvSma(20)[t] || s.c[t] < x.sma(50)[t] }));
add("STOCHASTIC 14 20/80", (s, x) => ({ enter: (t) => x.stoch(14)[t - 1] < 20 && x.stoch(14)[t] >= 20, exit: (t) => x.stoch(14)[t] > 80 }));
add("WILLIAMS_R 14 -90/-50", (s, x) => ({ enter: (t) => x.stoch(14)[t] < 10, exit: (t) => x.stoch(14)[t] > 50 }));
add("MFI_REVERSION 14 20/50", (s, x) => ({ enter: (t) => x.mfi(14)[t] < 20, exit: (t) => x.mfi(14)[t] > 50 }));
add("VWAP_REVERSION 24 -2%", (s, x) => ({ enter: (t) => s.c[t] < x.vwap(24)[t] * 0.98, exit: (t) => s.c[t] >= x.vwap(24)[t] }));
add("INSIDE_BAR_BREAKOUT 5bars", (s) => ({ enter: (t) => s.h[t - 1] < s.h[t - 2] && s.l[t - 1] > s.l[t - 2] && s.c[t] > s.h[t - 1], exit: (t, e) => t - e >= 5 || s.c[t] < s.l[e - 1] }));
add("NR7_BREAKOUT chandelier3", (s, x) => ({ enter: (t) => { const r = (i) => s.h[i] - s.l[i]; for (let j = t - 7; j < t - 1; j += 1) if (r(j) <= r(t - 1)) return false; return s.c[t] > s.h[t - 1]; }, exit: (t, e, peak) => s.c[t] < peak - 3 * x.atr(14)[t] }));
add("CLOSE_STRENGTH clv0.8 vol1.5x 3bars", (s, x) => ({ enter: (t) => s.h[t] > s.l[t] && (s.c[t] - s.l[t]) / (s.h[t] - s.l[t]) > 0.8 && s.v[t] > 1.5 * x.vsma(20)[t - 1] && s.c[t] > s.o[t], exit: (t, e) => t - e >= 3 }));
add("CAPITULATION_REVERSION vol3x 6bars", (s, x) => ({ enter: (t) => s.c[t] < s.o[t] && s.v[t] > 3 * x.vsma(20)[t - 1] && s.c[t] < x.sma(20)[t], exit: (t, e) => t - e >= 6 }));
add("ADX_TREND 14/25", (s, x) => ({ enter: (t) => { const a = x.adx(14); return a.adx[t] > 25 && a.plus[t] > a.minus[t]; }, exit: (t) => { const a = x.adx(14); return a.plus[t] < a.minus[t]; } }));
add("SUPERTREND 10/3", (s, x) => ({ enter: (t) => x.supertrend(10, 3)[t] === 1 && x.supertrend(10, 3)[t - 1] !== 1, exit: (t) => x.supertrend(10, 3)[t] === -1 }));
add("GAP_UP_CONTINUATION 1% 3bars", (s) => ({ enter: (t) => s.o[t] > s.c[t - 1] * 1.01 && s.c[t] > s.o[t], exit: (t, e) => t - e >= 3 }));
add("VOLUME_MOMENTUM 24 vol1.5x", (s, x) => ({ enter: (t) => s.c[t] > s.c[t - 24] && x.vsma(5)[t] > 1.5 * x.vsma(50)[t], exit: (t) => s.c[t] < s.c[t - 24] }));

function run(rule, s, start, end, fee, slip) {
  const r = []; let entry = null; let at = -1; let peak = 0;
  for (let t = Math.max(start, WARMUP); t < end; t += 1) {
    if (entry === null) { if (rule.enter(t)) { entry = s.c[t] * (1 + slip); at = t; peak = s.c[t]; } }
    else { peak = Math.max(peak, s.c[t]); if (rule.exit(t, at, peak)) { r.push((s.c[t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); entry = null; } }
  }
  if (entry !== null) r.push((s.c[end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return r;
}
const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
function normalSf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; }

(async () => {
  if (process.argv.includes("--fetch")) {
    for (const kind of Object.keys(FILES)) {
      const out = {};
      for (const m of MARKETS) out[m] = await fetchSeries(kind, m);
      fs.writeFileSync(FILES[kind], JSON.stringify(out));
      console.log(`wrote ${FILES[kind]} (${MARKETS.map((m) => out[m].length).join(", ")})`);
    }
    return;
  }
  const K = PRIOR_CATALOG + RULES.length * 2;
  const ALPHA = 0.05 / K;
  console.log(`OHLCV catalog: ${RULES.length * 2} configurations; cumulative K ${K}; holdout p-value bar ${ALPHA.toExponential(2)}`);
  const rows = [];
  for (const [kind, holdoutBars] of [["60m", 120 * 24], ["1d", 365]]) {
    const { times, series } = align(JSON.parse(fs.readFileSync(FILES[kind], "utf8")));
    const bars = times.length; const discoveryEnd = bars - holdoutBars;
    const size = Math.floor((discoveryEnd - WARMUP) / WINDOWS); const offset = discoveryEnd - size * WINDOWS;
    const windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);
    const regime = windows.map(([s, e]) => (mean(MARKETS.map((m) => series[m].c[e - 1] / series[m].c[s] - 1)) > 0 ? "UP" : "DOWN"));
    const day = (i) => new Date(times[i]).toISOString().slice(0, 10);
    console.log(`\n${kind}: ${bars} aligned bars ${day(0)}..${day(bars - 1)}; windows ${windows.map(([s, e], i) => `W${i + 1} ${day(s)}..${day(e - 1)} ${regime[i]}`).join("; ")}; holdout ${day(discoveryEnd)}..${day(bars - 1)}`);
    const ind = Object.fromEntries(MARKETS.map((m) => [m, indicators(series[m])]));
    for (const rule of RULES) {
      const rules = Object.fromEntries(MARKETS.map((m) => [m, rule.make(series[m], ind[m])]));
      const seg = (s, e, fee, slip) => MARKETS.map((m) => run(rules[m], series[m], s, e, fee, slip));
      const base = windows.map(([s, e]) => mean(seg(s, e, 0.0005, 0.0005).map(net)));
      const stress = windows.map(([s, e]) => mean(seg(s, e, 0.001, 0.001).map(net)));
      const up = base.filter((_, i) => regime[i] === "UP"); const down = base.filter((_, i) => regime[i] === "DOWN");
      const discovery = base.filter((v) => v > 0).length >= 4 && up.length > 0 && down.length > 0 && mean(up) > 0 && mean(down) > 0 && stress.filter((v) => v > 0).length >= 4;
      const row = { id: `${kind} ${rule.id}`, positive: base.filter((v) => v > 0).length, up: mean(up), down: mean(down), discovery };
      if (discovery) {
        const trades = seg(discoveryEnd, bars, 0.0005, 0.0005).flat(); const stressed = seg(discoveryEnd, bars, 0.001, 0.001).flat();
        const m = mean(trades); const v = trades.length > 1 ? trades.reduce((a, q) => a + (q - m) ** 2, 0) / (trades.length - 1) : 0;
        const p = normalSf(v > 0 ? m / Math.sqrt(v / trades.length) : 0);
        Object.assign(row, { n: trades.length, m: m * 100, sm: mean(stressed) * 100, p, holdout: m > 0 && trades.length >= 30 && p < ALPHA && mean(stressed) > 0 });
      }
      rows.push(row);
    }
  }
  console.log("\nconfiguration | +windows | UP mean | DOWN mean | discovery | holdout trades | mean/trade | 2x mean/trade | p | holdout");
  for (const r of rows) console.log(`${r.id} | ${r.positive}/6 | ${fmt(r.up)} | ${fmt(r.down)} | ${r.discovery ? "PASS" : "fail"}${r.discovery ? ` | ${r.n} | ${fmt(r.m)} | ${fmt(r.sm)} | ${r.p.toExponential(2)} | ${r.holdout ? "PASS" : "fail"}${r.holdout && r.n < 50 ? " (below the Research 50-trade minimum)" : ""}` : ""}`);
  console.log(`\nSUMMARY: ${rows.length} configurations, ${rows.filter((r) => r.discovery).length} passed discovery, ${rows.filter((r) => r.holdout).length} passed the holdout${rows.some((r) => r.holdout) ? `: ${rows.filter((r) => r.holdout).map((r) => r.id).join(", ")}` : ""}`);
})().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
