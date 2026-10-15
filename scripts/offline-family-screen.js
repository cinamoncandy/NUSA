#!/usr/bin/env node
"use strict";
/**
 * Offline walk-forward screen of three more long-only signal families (docs/RESEARCH_NOTE_2026-10-13_FAMILY_SCREEN.md).
 * Read-only: reads frozen 60-minute close files, prints tables, places no orders and changes no setting.
 *
 * Pre-registered before the first run (committed in WO-RESEARCH-20261013-FAMILY-SCREEN before any result was seen):
 * - BOLLINGER: entry when the close exceeds SMA(20) + 2 standard deviations of the previous 20 closes; exit when the close falls
 *   below SMA(20). Two settings: k = 2.0 and k = 2.5.
 * - SQUEEZE (volatility compression): the 20-bar Bollinger bandwidth (4 sd / SMA) of the previous bar is in the lowest 20% of the
 *   previous 120 bandwidths AND the close exceeds the highest close of the previous 20 bars; exit when the close falls below the
 *   lowest close of the previous 10 bars.
 * - REGIME_BREAKOUT: the Donchian breakout of the earlier note (N in {20, 50, 100}, exit at the lowest of the previous N/2 closes)
 *   but an entry is allowed only when the close is above SMA(200) AND SMA(200) is higher than it was 24 bars earlier (an ex-ante
 *   trend signal, no look-ahead). Exits are unchanged.
 * - Shared: long only, one position per market, fills at the bar close; fee 0.05% per side plus 5 bp slippage per side (base) and a
 *   2x stress; 6 consecutive equal windows per file, each simulated on its own bars with earlier bars used only as warm-up; a
 *   position open at the window end is closed at the last close. A window is UP when the equal-weight buy-and-hold of the markets
 *   over it is positive, otherwise DOWN.
 * - Pass rule (the same as the earlier breakout note): mean net after base costs positive in at least 4 of 6 windows AND positive
 *   for the UP windows and for the DOWN windows taken as groups AND positive under 2x costs in at least 4 of 6 windows.
 *   A setting SURVIVES only when it passes on BOTH frozen files (the 250-day file and the earlier 383-day file).
 * - A survivor is only a candidate for a formal Research experiment and a forward SHADOW test; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "..", "docs", "research-data");
const FILES = [
  path.join(DATA, "2026-10-12-upbit-60m-closes-250d.json"),
  path.join(DATA, "2026-10-13-upbit-60m-closes-prior-383d.json"),
];
const WINDOWS = 6;
const WARMUP = 224; // SMA(200) plus its 24-bar slope

function sma(values, t, n) {
  let sum = 0;
  for (let i = t - n; i < t; i += 1) sum += values[i];
  return sum / n;
}
function sd(values, t, n) {
  const m = sma(values, t, n);
  let sum = 0;
  for (let i = t - n; i < t; i += 1) sum += (values[i] - m) ** 2;
  return Math.sqrt(sum / n);
}
function highest(values, t, n) { let h = -Infinity; for (let i = t - n; i < t; i += 1) h = Math.max(h, values[i]); return h; }
function lowest(values, t, n) { let l = Infinity; for (let i = t - n; i < t; i += 1) l = Math.min(l, values[i]); return l; }

/** Each rule returns { enter(t), exit(t) } over the close array; indicator windows end at t - 1 except where stated. */
const RULES = {
  "BOLLINGER k=2.0": (c) => ({ enter: (t) => c[t] > sma(c, t, 20) + 2 * sd(c, t, 20), exit: (t) => c[t] < sma(c, t, 20) }),
  "BOLLINGER k=2.5": (c) => ({ enter: (t) => c[t] > sma(c, t, 20) + 2.5 * sd(c, t, 20), exit: (t) => c[t] < sma(c, t, 20) }),
  SQUEEZE: (c) => {
    const width = (t) => (4 * sd(c, t, 20)) / sma(c, t, 20);
    return {
      enter: (t) => {
        const now = width(t);
        let below = 0;
        for (let k = t - 120; k < t; k += 1) if (width(k) < now) below += 1;
        return below / 120 <= 0.2 && c[t] > highest(c, t, 20);
      },
      exit: (t) => c[t] < lowest(c, t, 10),
    };
  },
  ...Object.fromEntries([20, 50, 100].map((n) => [`REGIME_BREAKOUT N=${n}`, (c) => ({
    enter: (t) => c[t] > highest(c, t, n) && c[t] > sma(c, t + 1, 200) && sma(c, t + 1, 200) > sma(c, t - 23, 200),
    exit: (t) => c[t] < lowest(c, t, n >> 1),
  })])),
};

function simulate(rule, closes, start, end, fee, slip) {
  const returns = [];
  let entry = null;
  for (let t = Math.max(start, WARMUP); t < end; t += 1) {
    const price = closes[t];
    if (entry === null && rule.enter(t)) entry = price * (1 + slip);
    else if (entry !== null && rule.exit(t)) {
      returns.push((price * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
      entry = null;
    }
  }
  if (entry !== null) returns.push((closes[end - 1] * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  return returns;
}
const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";

const results = {};
for (const file of FILES) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const markets = Object.keys(data);
  const bars = Math.min(...markets.map((m) => data[m].length));
  const size = Math.floor((bars - WARMUP) / WINDOWS);
  const offset = bars - size * WINDOWS;
  const windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);
  const closes = Object.fromEntries(markets.map((m) => [m, data[m].slice(data[m].length - bars).map((c) => c[1])]));
  const times = data[markets[0]].slice(data[markets[0]].length - bars).map((c) => c[0]);
  const bh = windows.map(([s, e]) => mean(markets.map((m) => (closes[m][e - 1] / closes[m][s] - 1) * 100)));
  const regime = bh.map((x) => (x > 0 ? "UP" : "DOWN"));
  console.log(`\n=== ${path.basename(file)}: ${bars} bars per market, window ${size} bars (about ${(size / 24).toFixed(1)} days)`);
  windows.forEach(([s, e], i) => console.log(`W${i + 1} ${new Date(times[s]).toISOString().slice(0, 10)}..${new Date(times[e - 1]).toISOString().slice(0, 10)} ${regime[i]} ${fmt(bh[i])}`));
  for (const [name, make] of Object.entries(RULES)) {
    const rules = Object.fromEntries(markets.map((m) => [m, make(closes[m])]));
    const baseMeans = [];
    const stressMeans = [];
    let trades = 0;
    for (const [s, e] of windows) {
      const base = markets.map((m) => simulate(rules[m], closes[m], s, e, 0.0005, 0.0005));
      trades += base.reduce((a, r) => a + r.length, 0);
      baseMeans.push(mean(base.map(net)));
      stressMeans.push(mean(markets.map((m) => net(simulate(rules[m], closes[m], s, e, 0.001, 0.001)))));
    }
    const positive = baseMeans.filter((x) => x > 0).length;
    const stressPositive = stressMeans.filter((x) => x > 0).length;
    const up = baseMeans.filter((_, i) => regime[i] === "UP");
    const down = baseMeans.filter((_, i) => regime[i] === "DOWN");
    const upMean = up.length ? mean(up) : null;
    const downMean = down.length ? mean(down) : null;
    const pass = positive >= 4 && upMean !== null && downMean !== null && upMean > 0 && downMean > 0 && stressPositive >= 4;
    (results[name] ??= []).push(pass);
    console.log(`${name} | ${baseMeans.map(fmt).join(" ")} | trades ${trades} | +${positive}/6 | 2x +${stressPositive}/6 | UP ${upMean === null ? "n/a" : fmt(upMean)} DOWN ${downMean === null ? "n/a" : fmt(downMean)} | pass ${pass}`);
  }
}
console.log("\nSUMMARY (survives = passes on both files)");
for (const [name, passes] of Object.entries(results)) console.log(`${name}: ${passes.join(" / ")} -> survives ${passes.every(Boolean)}`);
