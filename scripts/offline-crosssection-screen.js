#!/usr/bin/env node
"use strict";
/**
 * Pre-registered DISCOVERY screen of six cross-sectional daily families (WO-RESEARCH-20261125-CROSSSECTION-SCREEN). Read-only.
 * Usage: node scripts/offline-crosssection-screen.js fetch <dir-outside-repo>   (public Upbit GETs only: daily candles; no key, no order)
 *        node scripts/offline-crosssection-screen.js run <dir>                   (reads the fetched JSON, prints tables)
 *
 * Pre-registered (committed before the first fetch and run; nothing below may change after it):
 * - Universe: union of discoveryPool and forwardPool of docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json (tick <= 20 bp,
 *   median daily value >= 1 bn KRW). Current markets only: SURVIVORSHIP is disclosed. A market is eligible on day D only if it has >= 90 daily
 *   candles before D. Daily candles as returned, at most 1800 days back from the fetch day.
 * - Decision at the close of day D (cohort day); entry at the close of D, exit at the close of D+H (H = the family hold); cohorts do not overlap:
 *   the next cohort day is D+H. Picks: top N=5 by the family score among eligible markets (ties by market code). Equal weight, long only.
 * - Costs per side: 15 bp base (fee 5 + slippage/half spread 10), 30 bp stress. Benchmark: equal-weight basket of all eligible markets, same costs.
 *   Excess = pick return minus benchmark return for the cohort.
 * - Families (K = 6), score defined with candles up to and including D:
 *   LOWVOL      H=7   score = -(std of the last 30 daily log returns)
 *   SHORT_REV   H=3   score = -(close D / close D-1 - 1)  (worst yesterday)
 *   VOLSPIKE_REV H=3  candidates: 1-day return <= -8% and volume >= 3 x mean volume of the prior 20 days; score = -(1-day return); fewer than 5 candidates -> hold those only, none -> no cohort
 *   BTC_LAG     H=2   only on days when KRW-BTC 1-day return >= +3%; score = -(1-day return) among the other eligible markets (laggards)
 *   VOL_CONTRACT H=7  candidates: close > mean close of 50 days; score = -(std of last 10 log returns / std of last 60 log returns)
 *   VOLADJ_MOM  H=7   score = (close D / close D-28 - 1) / std of the last 28 daily log returns
 * - Discovery pass: cohorts in the first part (all but the last 365 days) are cut into 6 consecutive windows of equal cohort count; mean excess net of base cost
 *   > 0 in >= 4 of 6; mean excess net > 0 in UP-benchmark windows and in DOWN-benchmark windows (benchmark window return sign); stress mean excess > 0 in >= 4 of 6.
 * - Second filter (last 365 days, already read by earlier screens, so only a filter): >= 30 cohorts, mean excess > 0, one-sided t p < 0.05 / K,
 *   stress mean excess > 0.
 * - Passing both is eligibility for a FORWARD pre-registration only; it is not evidence of an edge. Prices are never read by the host system.
 */
const fs = require("node:fs");
const path = require("node:path");

const POOL = path.join(__dirname, "..", "docs", "research-data", "broad-universe-filter-count-20bp-2026-11-24.json");
const BASE = "https://api.upbit.com";
const MAX_DAYS = 1800; const MIN_HISTORY = 90; const N = 5; const FEE = 0.0015; const STRESS = 0.003; const K = 6;
const DAY = 86400000;

function markets() { const p = JSON.parse(fs.readFileSync(POOL, "utf8")); return [...new Set([...p.discoveryPool, ...p.forwardPool, "KRW-BTC"])].sort(); }

async function fetchAll(dir) {
  if (path.resolve(dir).startsWith(path.resolve(__dirname, ".."))) throw new Error("dir must be outside the repository");
  fs.mkdirSync(dir, { recursive: true });
  const list = markets(); let failed = 0;
  for (const m of list) {
    const rows = []; let to = null;
    while (rows.length < MAX_DAYS) {
      const url = `${BASE}/v1/candles/days?market=${m}&count=200${to ? `&to=${encodeURIComponent(to)}` : ""}`;
      let res; for (let a = 0; a < 4; a += 1) { res = await fetch(url); if (res.status !== 429) break; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
      if (!res.ok) { failed += 1; console.log(`FAIL ${m} HTTP ${res.status}`); break; }
      const page = await res.json(); if (!page.length) break;
      for (const c of page) rows.push([Date.parse(c.candle_date_time_utc + "Z"), c.opening_price, c.high_price, c.low_price, c.trade_price, c.candle_acc_trade_volume]);
      to = page[page.length - 1].candle_date_time_utc; await new Promise((r) => setTimeout(r, 130));
    }
    rows.sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(path.join(dir, `${m}.json`), JSON.stringify(rows));
  }
  console.log(`fetched ${list.length - failed}/${list.length} markets into ${dir}`);
}

const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function normalSf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; }

function load(dir) {
  const data = {}; for (const m of markets()) { const f = path.join(dir, `${m}.json`); if (fs.existsSync(f)) data[m] = JSON.parse(fs.readFileSync(f, "utf8")); }
  const byDay = {}; const days = new Set();
  for (const [m, rows] of Object.entries(data)) { byDay[m] = new Map(rows.map((r) => [r[0], r])); rows.forEach((r) => days.add(r[0])); }
  return { byDay, days: [...days].sort((a, b) => a - b), first: Object.fromEntries(Object.entries(data).map(([m, r]) => [m, r[0][0]])) };
}

const FAMILIES = [
  { id: "LOWVOL", H: 7, pick: (f) => f.c.map((x) => ({ m: x.m, s: -x.std30 })) },
  { id: "SHORT_REV", H: 3, pick: (f) => f.c.map((x) => ({ m: x.m, s: -x.r1 })) },
  { id: "VOLSPIKE_REV", H: 3, pick: (f) => f.c.filter((x) => x.r1 <= -0.08 && x.volRatio >= 3).map((x) => ({ m: x.m, s: -x.r1 })) },
  { id: "BTC_LAG", H: 2, pick: (f) => (f.btcR1 >= 0.03 ? f.c.filter((x) => x.m !== "KRW-BTC").map((x) => ({ m: x.m, s: -x.r1 })) : []) },
  { id: "VOL_CONTRACT", H: 7, pick: (f) => f.c.filter((x) => x.close > x.sma50).map((x) => ({ m: x.m, s: -(x.std10 / x.std60) })) },
  { id: "VOLADJ_MOM", H: 7, pick: (f) => f.c.map((x) => ({ m: x.m, s: x.r28 / x.std28 })) },
];

function features(store, t) {
  const c = []; let btcR1 = NaN;
  for (const m of Object.keys(store.byDay)) {
    const g = (k) => store.byDay[m].get(t - k * DAY);
    const today = g(0); if (!today) continue;
    if (t - store.first[m] < MIN_HISTORY * DAY) continue;
    const closes = []; let ok = true;
    for (let k = 60; k >= 0; k -= 1) { const r = g(k); if (!r) { ok = false; break; } closes.push(r[4]); }
    if (!ok) continue;
    const lr = []; for (let i = 1; i < closes.length; i += 1) lr.push(Math.log(closes[i] / closes[i - 1]));
    const vols = []; for (let k = 20; k >= 1; k -= 1) vols.push(g(k)[5]);
    const sma50 = mean(closes.slice(-50));
    const x = { m, close: closes[60], r1: closes[60] / closes[59] - 1, r28: closes[60] / closes[32] - 1, std30: std(lr.slice(-30)), std28: std(lr.slice(-28)), std10: std(lr.slice(-10)), std60: std(lr), sma50, volRatio: today[5] / mean(vols) };
    if (m === "KRW-BTC") btcR1 = x.r1;
    c.push(x);
  }
  return { c, btcR1 };
}

function run(dir) {
  const store = load(dir); const days = store.days; const last = days[days.length - 1];
  const cut = last - 365 * DAY;
  console.log(`crosssection screen: ${Object.keys(store.byDay).length} markets, ${days.length} days up to ${new Date(last).toISOString().slice(0, 10)}, K=${K}, second-filter p bar ${(0.05 / K).toExponential(2)}`);
  const rows = [];
  for (const fam of FAMILIES) {
    const cohorts = [];
    for (let i = 0; i < days.length; i += 1) {
      // cohort days follow the family hold: take every H-th calendar day starting at the first day with enough history
      const t = days[i]; if ((t / DAY) % fam.H !== 0) continue;
      const exit = t + fam.H * DAY; if (exit > last) continue;
      const f = features(store, t); if (f.c.length < 20) continue;
      const picks = fam.pick(f).sort((a, b) => b.s - a.s || (a.m < b.m ? -1 : 1)).slice(0, N);
      if (!picks.length) continue;
      const ret = (m, fee) => { const e = store.byDay[m].get(exit); const en = store.byDay[m].get(t); if (!e) return null; return (e[4] * (1 - fee)) / (en[4] * (1 + fee)) - 1; };
      const avg = (ms, fee) => { const v = ms.map((m) => ret(m, fee)).filter((x) => x !== null); return v.length ? mean(v) : null; };
      const all = f.c.map((x) => x.m);
      const p = avg(picks.map((x) => x.m), FEE); const b = avg(all, FEE); const ps = avg(picks.map((x) => x.m), STRESS); const bs = avg(all, STRESS);
      if (p === null || b === null || ps === null) continue;
      cohorts.push({ t, ex: p - b, exStress: ps - bs, bench: b });
    }
    const first = cohorts.filter((c) => c.t < cut); const lastPart = cohorts.filter((c) => c.t >= cut);
    const size = Math.floor(first.length / 6); const wins = [];
    for (let w = 0; w < 6; w += 1) { const part = first.slice(w * size, (w + 1) * size); wins.push({ ex: mean(part.map((c) => c.ex)), st: mean(part.map((c) => c.exStress)), up: mean(part.map((c) => c.bench)) > 0 }); }
    const upW = wins.filter((w) => w.up); const dnW = wins.filter((w) => !w.up);
    const discovery = size >= 10 && wins.filter((w) => w.ex > 0).length >= 4 && upW.length > 0 && dnW.length > 0 && mean(upW.map((w) => w.ex)) > 0 && mean(dnW.map((w) => w.ex)) > 0 && wins.filter((w) => w.st > 0).length >= 4;
    const ex = lastPart.map((c) => c.ex); const m = mean(ex); const sd = ex.length > 1 ? std(ex) : 0;
    const p = sd > 0 ? normalSf(m / (sd / Math.sqrt(ex.length))) : 1;
    const second = lastPart.length >= 30 && m > 0 && p < 0.05 / K && mean(lastPart.map((c) => c.exStress)) > 0;
    rows.push({ id: fam.id, cohorts: cohorts.length, pos: wins.filter((w) => w.ex > 0).length, up: mean(upW.map((w) => w.ex)), dn: mean(dnW.map((w) => w.ex)), discovery, lastN: lastPart.length, m, p, second });
  }
  const pc = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
  console.log("family | cohorts | +windows | UP excess | DOWN excess | discovery | last-365d cohorts | mean excess/cohort | p | second filter");
  for (const r of rows) console.log(`${r.id} | ${r.cohorts} | ${r.pos}/6 | ${pc(r.up)} | ${pc(r.dn)} | ${r.discovery ? "PASS" : "fail"} | ${r.lastN} | ${pc(r.m)} | ${r.p.toExponential(2)} | ${r.second ? "PASS" : "fail"}`);
  const both = rows.filter((r) => r.discovery && r.second);
  console.log(`\nSUMMARY: ${K} families, ${rows.filter((r) => r.discovery).length} passed discovery, ${both.length} passed both${both.length ? `: ${both.map((r) => r.id).join(", ")}` : ""}`);
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "fetch" && dir) fetchAll(dir).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === "run" && dir) run(dir);
else { console.error("usage: fetch|run <dir outside repo>"); process.exit(2); }
