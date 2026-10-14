#!/usr/bin/env node
"use strict";
/**
 * Offline walk-forward and regime screen for the long-only Donchian breakout (docs/RESEARCH_NOTE_2026-10-13_BREAKOUT_WALKFORWARD.md).
 * Read-only: reads the frozen 60-minute close file, prints tables, places no orders and changes no setting.
 *
 * Pre-registered before this run (the settings were already seen in aggregate in the previous note, so this is a robustness
 * check, not an untouched out-of-sample test):
 * - Settings: breakout N in {20, 50, 100}; entry when the close exceeds the highest close of the previous N bars; exit when the
 *   close falls below the lowest close of the previous N/2 bars. Long only, one position, fills at the bar close.
 * - Costs: fee 0.05% per side plus 5 bp slippage per side (base), and a 2x stress.
 * - Windows: 6 consecutive windows of equal bar count; each window is simulated on its own bars with the N bars before it used only
 *   as indicator warm-up, and a position still open at the window end is closed at the last close (a realized, conservative end).
 * - Regime: a window is UP when the equal-weight buy-and-hold of the five markets over it is positive, otherwise DOWN.
 * - Pass rule (fixed in advance): mean net after base costs is positive in at least 4 of 6 windows AND positive in the UP windows
 *   and in the DOWN windows taken as groups AND it survives the 2x cost stress in at least 4 of 6 windows.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_FILE = path.join(__dirname, "..", "docs", "research-data", "2026-10-12-upbit-60m-closes-250d.json");
// Optional first argument: another frozen close file with the same shape (market -> ascending [timestampMs, close]).
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
const WINDOWS = 6;
const SETTINGS = [20, 50, 100];

function simulate(closes, start, end, n, fee, slip) {
  const m = n >> 1;
  const returns = [];
  let entry = null;
  for (let t = Math.max(start, n); t < end; t += 1) {
    const price = closes[t][1];
    const high = Math.max(...closes.slice(t - n, t).map((c) => c[1]));
    const low = Math.min(...closes.slice(t - m, t).map((c) => c[1]));
    if (entry === null && price > high) entry = price * (1 + slip);
    else if (entry !== null && price < low) {
      returns.push((price * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
      entry = null;
    }
  }
  if (entry !== null) {
    const last = closes[end - 1][1];
    returns.push((last * (1 - slip) * (1 - fee)) / (entry * (1 + fee)) - 1);
  }
  return returns;
}
const net = (r) => (r.reduce((p, v) => p * (1 + v), 1) - 1) * 100;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const markets = Object.keys(data);
const bars = Math.min(...markets.map((m) => data[m].length));
const size = Math.floor(bars / WINDOWS);
const offset = bars - size * WINDOWS;
const windows = Array.from({ length: WINDOWS }, (_, i) => [offset + i * size, offset + (i + 1) * size]);

const bh = windows.map(([s, e]) => mean(markets.map((m) => (data[m][e - 1][1] / data[m][s][1] - 1) * 100)));
const regime = bh.map((x) => (x > 0 ? "UP" : "DOWN"));
const span = (i) => `${new Date(data[markets[0]][windows[i][0]][0]).toISOString().slice(0, 10)}..${new Date(data[markets[0]][windows[i][1] - 1][0]).toISOString().slice(0, 10)}`;
console.log(`bars per market ${bars}, window size ${size} bars (about ${(size / 24).toFixed(1)} days)`);
console.log("window | span | regime | equal-weight buy&hold");
windows.forEach((_, i) => console.log(`W${i + 1} | ${span(i)} | ${regime[i]} | ${fmt(bh[i])}`));

const verdicts = [];
for (const n of SETTINGS) {
  console.log(`\nBREAKOUT N=${n}`);
  console.log("window | regime | base mean net | base per-market | trades | 2x-cost mean net");
  const baseMeans = [];
  const stressMeans = [];
  windows.forEach(([s, e], i) => {
    const base = markets.map((m) => simulate(data[m], s, e, n, 0.0005, 0.0005));
    const stress = markets.map((m) => simulate(data[m], s, e, n, 0.001, 0.001));
    const baseNets = base.map(net);
    baseMeans.push(mean(baseNets));
    stressMeans.push(mean(stress.map(net)));
    const trades = base.reduce((a, r) => a + r.length, 0);
    console.log(`W${i + 1} | ${regime[i]} | ${fmt(baseMeans[i])} | [${baseNets.map((x) => x.toFixed(1)).join(", ")}] | ${trades} | ${fmt(stressMeans[i])}`);
  });
  const positive = baseMeans.filter((x) => x > 0).length;
  const stressPositive = stressMeans.filter((x) => x > 0).length;
  const up = baseMeans.filter((_, i) => regime[i] === "UP");
  const down = baseMeans.filter((_, i) => regime[i] === "DOWN");
  const upMean = up.length ? mean(up) : null;
  const downMean = down.length ? mean(down) : null;
  const pass = positive >= 4 && upMean !== null && downMean !== null && upMean > 0 && downMean > 0 && stressPositive >= 4;
  verdicts.push({ n, positive, stressPositive, upMean, downMean, pass });
  console.log(`positive windows ${positive}/${WINDOWS}; 2x-cost positive ${stressPositive}/${WINDOWS}; UP windows mean ${upMean === null ? "n/a" : fmt(upMean)} (${up.length}); DOWN windows mean ${downMean === null ? "n/a" : fmt(downMean)} (${down.length}); PRE-REGISTERED PASS: ${pass}`);
}
console.log("\nSUMMARY");
for (const v of verdicts) console.log(`N=${v.n} pass=${v.pass}`);
