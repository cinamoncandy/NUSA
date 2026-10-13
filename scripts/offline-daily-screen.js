#!/usr/bin/env node
"use strict";
/**
 * Offline walk-forward screen of daily-bar trend families (WO-RESEARCH-20261013-FAMILY-SCREEN, part 3).
 * Read-only. `--fetch` downloads public Upbit daily candles into the frozen file once; without it the frozen file is read.
 *
 * Pre-registered before the data was fetched or any result seen:
 * - Markets KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE; daily closes (UTC 00:00 candles) up to 2026-10-13 exclusive; the common
 *   span where every market has data.
 * - DONCHIAN_D N in {20, 55}: entry when the close exceeds the highest close of the previous N days; exit below the lowest of N/2.
 * - REGIME_DONCHIAN_D N in {20, 55}: the same, entry only when the close is above SMA(200 days).
 * - GOLDEN_CROSS_D: hold while SMA(50) > SMA(200) of the previous closes; enter/exit at the close when that flips.
 * - TSMOM_D: hold while the close is above the close 90 days earlier.
 * - Shared: long only, fills at the close, 0.05% fee + 5 bp slippage per side (base), 2x stress, 200-day warm-up, 6 consecutive
 *   windows; a position open at a window end is closed at its last close. UP/DOWN regime by equal-weight buy-and-hold.
 * - Pass rule: base mean net positive in >= 4 of 6 windows AND UP-window mean > 0 AND DOWN-window mean > 0 AND 2x-cost positive in
 *   >= 4 of 6. A pass only makes a rule eligible for a formal Research experiment; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "docs", "research-data", "2026-10-13-upbit-1d-closes.json");
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const CUTOFF = Date.parse("2026-10-13T00:00:00Z");
const WINDOWS = 6;
const WARMUP = 200;

async function fetchAll() {
  const data = {};
  for (const market of MARKETS) {
    const rows = new Map();
    let to = new Date(CUTOFF).toISOString().slice(0, 19);
    for (let page = 0; page < 50; page += 1) {
      const response = await fetch(`https://api.upbit.com/v1/candles/days?market=${market}&count=200&to=${to}`);
      if (!response.ok) throw new Error(`UPBIT_HTTP_${response.status}`);
      const batch = await response.json();
      if (batch.length === 0) break;
      for (const row of batch) { const at = Date.parse(`${row.candle_date_time_utc}Z`); if (at < CUTOFF) rows.set(at, [at, row.trade_price]); }
      to = new Date(Date.parse(`${batch[batch.length - 1].candle_date_time_utc}Z`)).toISOString().slice(0, 19);
      if (batch.length < 200) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    data[market] = [...rows.values()].sort((a, b) => a[0] - b[0]);
  }
  fs.writeFileSync(FILE, JSON.stringify(data));
}

const sma = (c, t, n) => { let s = 0; for (let i = t - n; i < t; i += 1) s += c[i]; return s / n; };
const highest = (c, t, n) => { let h = -Infinity; for (let i = t - n; i < t; i += 1) h = Math.max(h, c[i]); return h; };
const lowest = (c, t, n) => { let l = Infinity; for (let i = t - n; i < t; i += 1) l = Math.min(l, c[i]); return l; };
const RULES = {
  ...Object.fromEntries([20, 55].map((n) => [`DONCHIAN_D N=${n}`, (c) => ({ enter: (t) => c[t] > highest(c, t, n), exit: (t) => c[t] < lowest(c, t, n >> 1) })])),
  ...Object.fromEntries([20, 55].map((n) => [`REGIME_DONCHIAN_D N=${n}`, (c) => ({ enter: (t) => c[t] > highest(c, t, n) && c[t] > sma(c, t + 1, 200), exit: (t) => c[t] < lowest(c, t, n >> 1) })])),
  GOLDEN_CROSS_D: (c) => ({ enter: (t) => sma(c, t, 50) > sma(c, t, 200), exit: (t) => sma(c, t, 50) <= sma(c, t, 200) }),
  TSMOM_D: (c) => ({ enter: (t) => c[t] > c[t - 90], exit: (t) => c[t] <= c[t - 90] }),
};
function simulate(rule, c, start, end, fee, slip) {
  const returns = [];
  let entry = null;
  for (let t = Math.max(start, WARMUP); t < end; t += 1) {
    if (entry === null && rule.enter(t)) entry = c[t] * (1 + slip);
    else if (entry !== null && rule.exit(t)) { returns.push((c[t] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1); entry = null; }
  }
  if (entry !== null) returns.push((c[end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return returns;
}
const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";

(async () => {
  if (process.argv.includes("--fetch")) { await fetchAll(); console.log(`wrote ${FILE}`); return; }
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const first = Math.max(...MARKETS.map((m) => data[m][0][0]));
  const series = Object.fromEntries(MARKETS.map((m) => [m, data[m].filter((row) => row[0] >= first)]));
  const bars = Math.min(...MARKETS.map((m) => series[m].length));
  const times = series[MARKETS[0]].slice(0, bars).map((row) => row[0]);
  for (const m of MARKETS) if (series[m].slice(0, bars).some((row, i) => row[0] !== times[i])) throw new Error(`DATES_MISALIGNED:${m}`);
  const closes = Object.fromEntries(MARKETS.map((m) => [m, series[m].slice(0, bars).map((row) => row[1])]));
  const size = Math.floor((bars - WARMUP) / WINDOWS);
  const offset = bars - size * WINDOWS;
  const windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);
  const bh = windows.map(([s, e]) => mean(MARKETS.map((m) => (closes[m][e - 1] / closes[m][s] - 1) * 100)));
  const regime = bh.map((x) => (x > 0 ? "UP" : "DOWN"));
  console.log(`${bars} common days from ${new Date(times[0]).toISOString().slice(0, 10)}; window ${size} days`);
  windows.forEach(([s, e], i) => console.log(`W${i + 1} ${new Date(times[s]).toISOString().slice(0, 10)}..${new Date(times[e - 1]).toISOString().slice(0, 10)} ${regime[i]} ${fmt(bh[i])}`));
  for (const [name, make] of Object.entries(RULES)) {
    const rules = Object.fromEntries(MARKETS.map((m) => [m, make(closes[m])]));
    const baseMeans = [];
    const stressMeans = [];
    let trades = 0;
    for (const [s, e] of windows) {
      const base = MARKETS.map((m) => simulate(rules[m], closes[m], s, e, 0.0005, 0.0005));
      trades += base.reduce((a, r) => a + r.length, 0);
      baseMeans.push(mean(base.map(net)));
      stressMeans.push(mean(MARKETS.map((m) => net(simulate(rules[m], closes[m], s, e, 0.001, 0.001)))));
    }
    const positive = baseMeans.filter((x) => x > 0).length;
    const stressPositive = stressMeans.filter((x) => x > 0).length;
    const up = baseMeans.filter((_, i) => regime[i] === "UP");
    const down = baseMeans.filter((_, i) => regime[i] === "DOWN");
    const upMean = up.length ? mean(up) : null;
    const downMean = down.length ? mean(down) : null;
    const pass = positive >= 4 && upMean !== null && downMean !== null && upMean > 0 && downMean > 0 && stressPositive >= 4;
    console.log(`${name} | ${baseMeans.map(fmt).join(" ")} | trades ${trades} | +${positive}/6 | 2x +${stressPositive}/6 | UP ${upMean === null ? "n/a" : fmt(upMean)} DOWN ${downMean === null ? "n/a" : fmt(downMean)} | pass ${pass}`);
  }
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
