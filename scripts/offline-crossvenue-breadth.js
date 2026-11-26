#!/usr/bin/env node
"use strict";
// OFFLINE RESEARCH ONLY (not host code, not a workflow). Pre-registered in
// docs/RESEARCH_PREREG_2026-11-26_CROSSVENUE_BREADTH.md. Two commands:
//   node scripts/offline-crossvenue-breadth.js fetch <dir>   (public daily candles, writes files + manifest)
//   node scripts/offline-crossvenue-breadth.js run <dir>     (the one evaluation; prints the result table)
// Nothing here is fitted: every number comes from the pre-registration.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");

const HOST = "data-api.binance.vision";
const DAY = 86400000;
const START_MS = Date.UTC(2017, 7, 1);
const END_MS = Date.UTC(2026, 10, 26); // exclusive: last candle used is the UTC day 2026-11-25
const LISTED_BY = Date.UTC(2019, 0, 1);
const MIN_CANDLES = 1500;
const STABLE_BASES = new Set(["USDC", "TUSD", "BUSD", "DAI", "USDP", "PAX", "USDS", "FDUSD", "AEUR", "EUR", "GBP", "TRY", "BRL", "UST", "USTC", "SUSD", "EURI", "XUSD", "USD1", "PAXG", "WBTC", "BTCB", "WBETH"]);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;
const SPAN_START = Date.UTC(2018, 0, 1); // first signal day
const BEAR_WINDOWS = [["2018", Date.UTC(2018, 0, 1), Date.UTC(2018, 11, 31)], ["2021-11..2022", Date.UTC(2021, 10, 1), Date.UTC(2022, 11, 31)]];
const COST = 0.0015, STRESS = 0.003, SEED = 20261126, PLACEBOS = 10000;

function getOnce(p) {
  return new Promise((resolve, reject) => {
    https.get({ host: HOST, path: p, headers: { "user-agent": "research-offline" } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { if (res.statusCode === 200) resolve(JSON.parse(b)); else { const e = new Error(`HTTP ${res.statusCode} ${p}`); e.status = res.statusCode; reject(e); } });
    }).on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Bounded retry (5 attempts, growing wait) for 429/418/5xx and network errors; 451 or any other 4xx fails at once.
async function get(p) {
  for (let a = 1; ; a++) {
    try { return await getOnce(p); } catch (e) {
      const retry = e.status === undefined || e.status === 429 || e.status === 418 || e.status >= 500;
      if (!retry || a >= 5) throw e;
      await sleep(1000 * a * a);
    }
  }
}

async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, "manifest.json"))) throw new Error("manifest.json exists: the first complete fetch is frozen, no refetch");
  const info = await get("/api/v3/exchangeInfo");
  const usdt = info.symbols.filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed);
  const excluded = usdt.filter((s) => STABLE_BASES.has(s.baseAsset) || LEVERAGED.test(s.baseAsset)).map((s) => s.symbol).sort();
  const syms = usdt.filter((s) => !STABLE_BASES.has(s.baseAsset) && !LEVERAGED.test(s.baseAsset)).map((s) => s.symbol).sort();
  const kept = [];
  for (const sym of syms) {
    const first = await get(`/api/v3/klines?symbol=${sym}&interval=1d&startTime=${START_MS}&limit=1`);
    await sleep(60);
    if (!first.length || first[0][0] > LISTED_BY) continue;
    const rows = [];
    let from = START_MS;
    while (from < END_MS) {
      const page = await get(`/api/v3/klines?symbol=${sym}&interval=1d&startTime=${from}&endTime=${END_MS - 1}&limit=1000`);
      await sleep(60);
      if (!page.length) break;
      for (const k of page) rows.push([k[0], Number(k[4])]);
      from = page[page.length - 1][0] + DAY;
      if (page.length < 1000) break;
    }
    if (rows.length < MIN_CANDLES) continue;
    if (rows[rows.length - 1][0] !== END_MS - DAY) continue; // must reach the UTC day 2026-11-25 (symbols delisted earlier are not in exchangeInfo TRADING anyway)
    fs.writeFileSync(path.join(dir, `${sym}.json`), JSON.stringify(rows));
    kept.push(sym);
  }
  const manifest = { fetchedAt: new Date().toISOString(), listed: syms.length, kept, excluded, files: {} };
  for (const sym of kept) manifest.files[sym] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, `${sym}.json`))).digest("hex");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`CROSSVENUE_FETCH listed=${syms.length} kept=${kept.length} excludedByName=${excluded.length}`);
}

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function loadMarkets(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const m = {};
  for (const sym of manifest.kept) {
    const buf = fs.readFileSync(path.join(dir, `${sym}.json`));
    if (crypto.createHash("sha256").update(buf).digest("hex") !== manifest.files[sym]) throw new Error(`hash mismatch ${sym}`);
    const map = new Map(); for (const [t, c] of JSON.parse(buf)) map.set(t, c);
    m[sym] = map;
  }
  return m;
}

// Per signal day D (UTC ms): eligible markets, breadth, the equal-weight return over D+1, and the held flag.
function buildSeries(markets, endMs) {
  const names = Object.keys(markets).sort();
  const sortedKeys = {}, ptr = {};
  for (const n of names) { sortedKeys[n] = [...markets[n].keys()].sort((a, b) => a - b); ptr[n] = 0; }
  const days = [];
  for (let d = SPAN_START; d + DAY < endMs; d += DAY) {
    const elig = [];
    for (const n of names) {
      const mk = markets[n];
      if (!mk.has(d)) continue;
      let count = 0, sum = 0, ok = true;
      for (let i = 0; i < 50; i++) { const c = mk.get(d - i * DAY); if (c === undefined) { ok = false; break; } sum += c; count++; }
      if (!ok) continue;
      const ks = sortedKeys[n]; while (ptr[n] < ks.length && ks[ptr[n]] <= d) ptr[n]++;
      if (ptr[n] < 90) continue;
      if (!(mk.get(d) > 0)) continue;
      elig.push({ n, above: mk.get(d) > sum / 50, c0: mk.get(d), c1: mk.get(d + DAY) });
    }
    if (elig.length < 10) { days.push({ d, ok: false, nElig: elig.length }); continue; }
    const breadth = elig.filter((e) => e.above).length / elig.length;
    let r = 0; for (const e of elig) r += (e.c1 === undefined ? 0 : e.c1 / e.c0 - 1);
    r /= elig.length;
    days.push({ d, ok: true, hold: breadth >= 0.5, r, nElig: elig.length });
  }
  return days;
}

function curve(days, mask, cost) {
  // mask[i] true = invested on held day i (day D+1). Cost = cost * |position change|. Returns equity per day.
  let eq = 1, pos = 0; const out = [];
  for (let i = 0; i < days.length; i++) {
    const x = days[i];
    const want = x.ok && mask[i] ? 1 : 0;
    eq *= 1 - cost * Math.abs(want - pos);
    pos = want;
    if (pos) eq *= 1 + x.r;
    out.push(eq);
  }
  return out;
}
function mdd(eq, from = 0, to = eq.length) { let peak = from > 0 ? eq[from - 1] : 1, w = 0; for (let i = from; i < to; i++) { if (eq[i] > peak) peak = eq[i]; w = Math.max(w, 1 - eq[i] / peak); } return w; }
function net(eq, from = 0, to = eq.length) { return eq[to - 1] / (from > 0 ? eq[from - 1] : 1) - 1; }

function sampleSchedule(rand, N, H, S, startOn) {
  // Uniform random binary schedule with exactly H on-days and exactly S switches, first state = startOn.
  const runs = S + 1;
  const onRuns = startOn ? Math.ceil(runs / 2) : Math.floor(runs / 2);
  const offRuns = runs - onRuns;
  const comp = (total, parts) => {
    if (parts === 0) return total === 0 ? [] : null;
    if (total < parts) return null;
    const gaps = []; for (let i = 1; i < total; i++) gaps.push(i);
    for (let i = 0; i < parts - 1; i++) { const j = i + Math.floor(rand() * (gaps.length - i)); const t = gaps[i]; gaps[i] = gaps[j]; gaps[j] = t; }
    const cuts = gaps.slice(0, parts - 1).sort((a, b) => a - b);
    const out = []; let prev = 0; for (const c of cuts) { out.push(c - prev); prev = c; } out.push(total - prev); return out;
  };
  const on = comp(H, onRuns), off = comp(N - H, offRuns);
  if (!on || !off) return null;
  const mask = []; let state = startOn, io = 0, jo = 0;
  for (let r = 0; r < runs; r++) { const len = state ? on[io++] : off[jo++]; for (let k = 0; k < len; k++) mask.push(state); state = !state; }
  return mask;
}

function evaluate(allDays) {
  // Days with fewer than 10 eligible markets are removed from EVERY curve (filter, benchmark, stress, placebo, windows):
  // the evaluation runs on the eligible days only, so no cost is charged at those gaps for either side.
  const days = allDays.filter((x) => x.ok);
  const filt = days.map((x) => x.ok && x.hold);
  const bench = days.map((x) => x.ok);
  const ev = (mask, cost) => curve(days, mask, cost);
  const F = ev(filt, COST), B = ev(bench, COST), Fs = ev(filt, STRESS), Bs = ev(bench, STRESS);
  const okDays = days.length;
  const out = { signalDays: allDays.length, eligibleDays: okDays };
  out.informative = okDays / allDays.length >= 0.8;
  const fm = mdd(F), bm = mdd(B), fn = net(F), bn = net(B);
  const c = {};
  c[1] = fm <= 0.7 * bm;
  c[2] = bn > 0 ? fn >= 0.5 * bn : fn >= bn;
  const rpd = (n, m) => (m > 0 ? n / m : n > 0 ? Infinity : -Infinity);
  c[3] = bn > 0 && fn > 0 ? rpd(fn, fm) > rpd(bn, bm) : fn >= bn;
  c[4] = net(Fs) >= net(Bs);
  // placebo over the eligible days only (days with fewer than 10 eligible markets are cash for both and are removed)
  const e = days;
  const eMask = e.map((x) => x.hold);
  const H = eMask.filter(Boolean).length; let S = 0; for (let i = 1; i < eMask.length; i++) if (eMask[i] !== eMask[i - 1]) S++;
  const eF = curve(e, eMask, COST); const fmE = mdd(eF);
  const rand = mulberry32(SEED); let wins = 0, drawn = 0;
  for (let p = 0; p < PLACEBOS; p++) { const m = sampleSchedule(rand, e.length, H, S, eMask[0]); if (!m) continue; drawn++; if (fmE < mdd(curve(e, m, COST))) wins++; }
  c[5] = drawn === PLACEBOS && wins >= 9500;
  const act = H / e.length; c[6] = act >= 0.2 && act <= 0.9;
  c[7] = bn >= 0 ? true : fn > -0.5 * Math.abs(bn);
  out.full = { filteredMDD: fm, benchMDD: bm, filteredNet: fn, benchNet: bn, stressF: net(Fs), stressB: net(Bs), activity: act, switches: S, placeboWins: wins, placeboDrawn: drawn, conditions: c };
  out.bear = {};
  for (const [label, a, b] of BEAR_WINDOWS) {
    const i0 = days.findIndex((x) => x.d >= a), i1 = days.reduce((k, x, i) => (x.d <= b ? i + 1 : k), 0);
    const fw = mdd(F, i0, i1), bw = mdd(B, i0, i1);
    const win = days.slice(i0, i1);
    out.bear[label] = { eligibleDays: win.length, minEligibleMarkets: Math.min(...win.map((x) => x.nElig)), maxEligibleMarkets: Math.max(...win.map((x) => x.nElig)), filteredMDD: fw, benchMDD: bw, ok: bw >= 0.2 && fw <= 0.7 * bw, benchInformative: bw >= 0.2 };
  }
  const bearOk = Object.values(out.bear).every((x) => x.ok);
  out.defensiveOnly = bn < 0;
  out.verdict = !out.informative ? "NOT_INFORMATIVE" : Object.values(c).every(Boolean) && bearOk ? "PASS" : "FAIL";
  return out;
}

async function main() {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === "fetch" && dir) return fetchAll(dir);
  if (cmd === "run" && dir) {
    const markets = loadMarkets(dir);
    const days = buildSeries(markets, END_MS);
    const out = evaluate(days);
    console.log("CROSSVENUE_BREADTH " + JSON.stringify(out, null, 1));
    return;
  }
  console.error("usage: fetch <dir> | run <dir>");
  process.exit(2);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { mulberry32, sampleSchedule, buildSeries, evaluate, curve, mdd };
