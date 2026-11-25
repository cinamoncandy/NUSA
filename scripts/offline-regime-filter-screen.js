#!/usr/bin/env node
"use strict";
/**
 * Pre-registered screen of a regime filter ("hold the market in an up regime, cash otherwise") (WO-RESEARCH-20261125-REGIME-FILTER). Read-only.
 * Usage: node scripts/offline-regime-filter-screen.js <dir with the daily JSON files fetched by offline-crosssection-screen.js fetch>
 *
 * Pre-registered (committed before the first run; nothing below may change after it):
 * - The goal is NOT excess return. It is: keep most of the market return with a clearly smaller drawdown.
 * - Assets: A1 = KRW-BTC; A2 = equal-weight basket of all eligible markets (>= 90 candles of history that day; at least 10 eligible, else the day is skipped),
 *   daily rebalanced at no cost (optimistic, identical for the benchmark and the filtered versions).
 * - Signal at the close of day D (data up to D only); the position is held over day D+1 (close D to close D+1). Cost 15 bp per side on each switch
 *   in or out (30 bp stress). Cash earns 0.
 * - Regimes (K = 6 = 3 regimes x 2 assets): R200 = BTC close > mean of its last 200 closes; R50 = BTC close > mean of its last 50 closes;
 *   BREADTH = at least 50 percent of eligible markets have close > mean of their own last 50 closes.
 * - Benchmarks: always invested (buy and hold) in the same asset, same days.
 * - First part = all days except the last 365; last part = the last 365 days (already read by earlier screens: only a filter).
 * - Pass in a part: (1) max drawdown of the filtered version <= 0.7 x the benchmark's; (2) net return of the filtered version >= 0.5 x the benchmark's if the
 *   benchmark's return is positive, else the filtered return is >= the benchmark's; (3) stress net return (30 bp) > the benchmark's max drawdown times -1
 *   is not used; instead (3) the filtered version's return per unit of drawdown (return / max drawdown, when both positive) exceeds the benchmark's.
 *   Both parts must pass. A pass is eligibility for a forward pre-registration, not evidence of an edge.
 */
const fs = require("node:fs");
const path = require("node:path");
const POOL = path.join(__dirname, "..", "docs", "research-data", "broad-universe-filter-count-20bp-2026-11-24.json");
const DAY = 86400000; const FEE = 0.0015; const STRESS = 0.003; const K = 6; const MIN_HISTORY = 90; const MIN_ELIGIBLE = 10;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function load(dir) {
  const p = JSON.parse(fs.readFileSync(POOL, "utf8")); const list = [...new Set([...p.discoveryPool, ...p.forwardPool, "KRW-BTC"])].sort();
  const byDay = {}; const first = {}; const days = new Set();
  for (const m of list) { const f = path.join(dir, `${m}.json`); if (!fs.existsSync(f)) continue; const rows = JSON.parse(fs.readFileSync(f, "utf8")); byDay[m] = new Map(rows.map((r) => [r[0], r[4]])); first[m] = rows[0][0]; rows.forEach((r) => days.add(r[0])); }
  return { byDay, first, days: [...days].sort((a, b) => a - b) };
}

function build(store) {
  const { byDay, first, days } = store; const rows = [];
  const sma = (m, t, n) => { let s = 0; for (let k = 0; k < n; k += 1) { const c = byDay[m].get(t - k * DAY); if (c === undefined) return NaN; s += c; } return s / n; };
  for (const t of days) {
    if (t - first["KRW-BTC"] < 200 * DAY) continue;
    const next = t + DAY; const btc = byDay["KRW-BTC"].get(t); const btcN = byDay["KRW-BTC"].get(next); if (btc === undefined || btcN === undefined) continue;
    const el = Object.keys(byDay).filter((m) => t - first[m] >= MIN_HISTORY * DAY && byDay[m].has(t) && byDay[m].has(next));
    if (el.length < MIN_ELIGIBLE) continue;
    const basket = mean(el.map((m) => byDay[m].get(next) / byDay[m].get(t) - 1));
    const breadth = el.filter((m) => { const s = sma(m, t, 50); return Number.isFinite(s) && byDay[m].get(t) > s; }).length / el.length;
    rows.push({ t, btc: btcN / btc - 1, basket, R200: btc > sma("KRW-BTC", t, 200), R50: btc > sma("KRW-BTC", t, 50), BREADTH: breadth >= 0.5 });
  }
  return rows;
}

function simulate(rows, asset, regime, fee) {
  let eq = 1; let peak = 1; let mdd = 0; let pos = false; let switches = 0; let inDays = 0;
  for (const r of rows) {
    const want = regime === null ? true : r[regime];
    if (want !== pos) { eq *= 1 - fee; pos = want; switches += 1; }
    if (pos) { eq *= 1 + r[asset]; inDays += 1; }
    peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
  }
  return { ret: eq - 1, mdd, switches, inShare: inDays / rows.length };
}

const dir = process.argv[2]; if (!dir) { console.error("usage: <dir>"); process.exit(2); }
const all = build(load(dir)); const last = all[all.length - 1].t; const cut = last - 365 * DAY;
const parts = { first: all.filter((r) => r.t < cut), last: all.filter((r) => r.t >= cut) };
console.log(`regime filter screen: ${all.length} days ${new Date(all[0].t).toISOString().slice(0, 10)}..${new Date(last).toISOString().slice(0, 10)}, K=${K}; first part ${parts.first.length} days, last part ${parts.last.length} days`);
const pc = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
const verdicts = [];
console.log("asset regime | part | filtered return | filtered maxDD | bench return | bench maxDD | in-market | switches | stress return | part pass");
for (const asset of ["btc", "basket"]) for (const regime of ["R200", "R50", "BREADTH"]) {
  let pass = true;
  for (const [name, rows] of Object.entries(parts)) {
    const f = simulate(rows, asset, regime, FEE); const b = simulate(rows, asset, null, FEE); const s = simulate(rows, asset, regime, STRESS);
    const c1 = f.mdd <= 0.7 * b.mdd;
    const c2 = b.ret > 0 ? f.ret >= 0.5 * b.ret : f.ret >= b.ret;
    const c3 = f.ret > 0 && b.ret > 0 ? f.ret / f.mdd > b.ret / b.mdd : f.ret >= b.ret;
    const ok = c1 && c2 && c3; pass = pass && ok;
    console.log(`${asset} ${regime} | ${name} | ${pc(f.ret)} | ${pc(f.mdd)} | ${pc(b.ret)} | ${pc(b.mdd)} | ${(f.inShare * 100).toFixed(0)}% | ${f.switches} | ${pc(s.ret)} | ${ok ? "PASS" : "fail"} (dd ${c1 ? "y" : "n"} ret ${c2 ? "y" : "n"} ratio ${c3 ? "y" : "n"})`);
  }
  verdicts.push({ id: `${asset} ${regime}`, pass });
}
console.log(`\nSUMMARY: ${K} filters, ${verdicts.filter((v) => v.pass).length} passed both parts${verdicts.some((v) => v.pass) ? `: ${verdicts.filter((v) => v.pass).map((v) => v.id).join(", ")}` : ""}`);
