#!/usr/bin/env node
"use strict";
/**
 * Pre-registered DISCOVERY screen of short-term (5-minute) rules (WO-RESEARCH-20261125-SCALP-SCREEN). Read-only.
 * Usage: node scripts/offline-scalp-screen.js fetch <dir outside repo>   (public Upbit GETs only: 5-minute candles; no key, no order)
 *        node scripts/offline-scalp-screen.js run <dir>
 *
 * Pre-registered (committed before the first fetch and run; nothing below may change after it):
 * - Data: 5-minute candles of KRW-BTC, KRW-ETH, KRW-XRP, KRW-SOL, KRW-DOGE from 2025-11-05T00:00Z up to (not including) 2026-11-05T00:00Z.
 *   Nothing from 2026-11-05 on is fetched or read (the S2-S4 holdout 2026-11-05..2026-12-05 stays unread). No order-book value is used.
 * - Part 1 = the first 275 days (cut into 6 equal windows); part 2 = the last 90 days (second filter, only a filter: 60-minute prices of these markets
 *   were read by earlier screens).
 * - Rules (K = 8). Signal at the close of bar t using bars up to t; entry at the close of t; exit at the close of t+H (fixed hold); one position per
 *   market at a time (a signal while in a trade is skipped); trades that would exit after the end of the data are dropped. sigma = std of the last 288
 *   five-minute returns (one day).
 *   MOM_H6, MOM_H12     enter when the 3-bar return > +2.5 sigma x sqrt(3); hold H bars
 *   REV_H6, REV_H12     enter when the 3-bar return < -2.5 sigma x sqrt(3); hold H bars
 *   BREAK_H12, BREAK_H36 enter when close > highest high of the prior 48 bars and volume >= 2 x mean volume of the prior 48 bars; hold H bars
 *   BBREV_H6, BBREV_H12 enter when close < SMA20 - 2.5 x std20 of closes; hold H bars
 * - Costs per side (long only): base 10 bp (fee 5 + slippage 5), stress 15 bp (round trip 20 and 30 bp). Gross mean is also printed.
 * - Part 1 pass: pooled over markets, in each of the 6 windows the mean net per trade at base cost; >= 4 of 6 windows positive, the mean of up-windows
 *   (market return of the window > 0) and of down-windows both > 0, stress mean > 0 in >= 4 of 6, and at least 300 trades in part 1.
 * - Part 2 filter: >= 100 trades, mean net > 0, one-sided z p < 0.05 / K, stress mean > 0.
 * - Passing both is eligibility for a forward pre-registration only. Maker-fill behaviour and queue position cannot be modelled from candles and are not.
 */
const fs = require("node:fs");
const path = require("node:path");
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"];
const BASE = "https://api.upbit.com"; const BAR = 300000;
const START = Date.parse("2025-11-05T00:00:00Z"); const END = Date.parse("2026-11-05T00:00:00Z");
const K = 8; const WINDOWS = 6; const PART2_BARS = 90 * 288; const SIGMA_N = 288;
const COST = 0.001; const STRESS = 0.0015;

async function fetchAll(dir) {
  if (path.resolve(dir).startsWith(path.resolve(__dirname, ".."))) throw new Error("dir must be outside the repository");
  fs.mkdirSync(dir, { recursive: true });
  for (const m of MARKETS) {
    const rows = new Map(); let to = new Date(END).toISOString().replace(".000Z", "Z");
    for (;;) {
      const url = `${BASE}/v1/candles/minutes/5?market=${m}&count=200&to=${encodeURIComponent(to)}`;
      let res; for (let a = 0; a < 5; a += 1) { res = await fetch(url); if (res.status !== 429) break; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
      if (!res.ok) throw new Error(`${m} HTTP ${res.status}`);
      const page = await res.json(); if (!page.length) break;
      for (const c of page) { const t = Date.parse(c.candle_date_time_utc + "Z"); if (t >= START && t < END) rows.set(t, [t, c.opening_price, c.high_price, c.low_price, c.trade_price, c.candle_acc_trade_volume]); }
      const oldest = Date.parse(page[page.length - 1].candle_date_time_utc + "Z"); if (oldest <= START) break;
      to = new Date(oldest).toISOString().replace(".000Z", "Z"); await new Promise((r) => setTimeout(r, 120));
    }
    const sorted = [...rows.values()].sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(path.join(dir, `${m}.json`), JSON.stringify(sorted));
    console.log(`${m}: ${sorted.length} bars ${new Date(sorted[0][0]).toISOString()} .. ${new Date(sorted[sorted.length - 1][0]).toISOString()}`);
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function normalSf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; }

function signals(rows) {
  const n = rows.length; const c = rows.map((r) => r[4]); const h = rows.map((r) => r[2]); const v = rows.map((r) => r[5]);
  const ret = c.map((x, i) => (i ? x / c[i - 1] - 1 : 0));
  const out = { MOM: new Array(n).fill(false), REV: new Array(n).fill(false), BREAK: new Array(n).fill(false), BBREV: new Array(n).fill(false) };
  let sumR = 0; let sumR2 = 0; let sumC20 = 0; let sumC20sq = 0; let sumV48 = 0;
  for (let i = 0; i < n; i += 1) {
    sumR += ret[i]; sumR2 += ret[i] ** 2; if (i >= SIGMA_N) { sumR -= ret[i - SIGMA_N]; sumR2 -= ret[i - SIGMA_N] ** 2; }
    sumC20 += c[i]; sumC20sq += c[i] ** 2; if (i >= 20) { sumC20 -= c[i - 20]; sumC20sq -= c[i - 20] ** 2; }
    sumV48 += v[i]; if (i >= 48) sumV48 -= v[i - 48];
    if (i < SIGMA_N + 3) continue;
    const m = sumR / SIGMA_N; const sig = Math.sqrt(Math.max(0, sumR2 / SIGMA_N - m * m)); const r3 = c[i] / c[i - 3] - 1;
    if (sig > 0) { out.MOM[i] = r3 > 2.5 * sig * Math.sqrt(3); out.REV[i] = r3 < -2.5 * sig * Math.sqrt(3); }
    let hh = -Infinity; for (let j = i - 48; j < i; j += 1) hh = Math.max(hh, h[j]);
    const vMeanPrev = (sumV48 - v[i]) / 48; out.BREAK[i] = c[i] > hh && v[i] >= 2 * vMeanPrev;
    const mean20 = sumC20 / 20; const sd20 = Math.sqrt(Math.max(0, sumC20sq / 20 - mean20 * mean20)); out.BBREV[i] = sd20 > 0 && c[i] < mean20 - 2.5 * sd20;
  }
  return { sig: out, c };
}

const RULES = [["MOM", 6], ["MOM", 12], ["REV", 6], ["REV", 12], ["BREAK", 12], ["BREAK", 36], ["BBREV", 6], ["BBREV", 12]];

function run(dir) {
  const data = {}; for (const m of MARKETS) data[m] = signals(JSON.parse(fs.readFileSync(path.join(dir, `${m}.json`), "utf8")));
  const times = JSON.parse(fs.readFileSync(path.join(dir, "KRW-BTC.json"), "utf8")).map((r) => r[0]);
  const bars = Math.min(...MARKETS.map((m) => data[m].c.length)); const cut = bars - PART2_BARS;
  const size = Math.floor(cut / WINDOWS); const winOf = (i) => Math.min(WINDOWS - 1, Math.floor(i / size));
  const winRet = Array.from({ length: WINDOWS }, (_, w) => mean(MARKETS.map((m) => data[m].c[Math.min(cut, (w + 1) * size) - 1] / data[m].c[w * size] - 1)));
  console.log(`scalp screen: ${bars} bars per market (${new Date(times[0]).toISOString().slice(0, 10)} .. ${new Date(times[bars - 1]).toISOString().slice(0, 10)}), part 1 ${cut} bars in ${WINDOWS} windows, part 2 ${PART2_BARS} bars, K=${K}, part-2 p bar ${(0.05 / K).toExponential(2)}`);
  console.log("rule | trades p1 | gross/trade p1 | net/trade p1 | +windows | UP | DOWN | part1 | trades p2 | net/trade p2 | stress p2 | p | part2");
  const pc = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(3) + "%"; const verdicts = [];
  for (const [fam, H] of RULES) {
    const tr = []; // {i, gross}
    for (const m of MARKETS) {
      const { sig, c } = data[m]; let free = 0;
      for (let i = 0; i + H < bars; i += 1) { if (i < free || !sig[fam][i]) continue; tr.push({ i, gross: c[i + H] / c[i] - 1 }); free = i + H; }
    }
    const net = (t, fee) => t.gross - 2 * fee - 2 * fee * t.gross; // approx round-trip proportional cost
    const p1 = tr.filter((t) => t.i + H < cut); const p2 = tr.filter((t) => t.i >= cut);
    const wins = Array.from({ length: WINDOWS }, (_, w) => p1.filter((t) => winOf(t.i) === w));
    const wNet = wins.map((x) => mean(x.map((t) => net(t, COST)))); const wSt = wins.map((x) => mean(x.map((t) => net(t, STRESS))));
    const upM = wNet.filter((_, w) => winRet[w] > 0); const dnM = wNet.filter((_, w) => winRet[w] <= 0);
    const part1 = p1.length >= 300 && wins.every((x) => x.length > 0) && wNet.filter((x) => x > 0).length >= 4 && upM.length > 0 && dnM.length > 0 && mean(upM) > 0 && mean(dnM) > 0 && wSt.filter((x) => x > 0).length >= 4;
    const n2 = p2.map((t) => net(t, COST)); const m2 = mean(n2); const z = n2.length > 1 && sd(n2) > 0 ? m2 / (sd(n2) / Math.sqrt(n2.length)) : 0; const pv = normalSf(z);
    const part2 = p2.length >= 100 && m2 > 0 && pv < 0.05 / K && mean(p2.map((t) => net(t, STRESS))) > 0;
    verdicts.push({ id: `${fam}_H${H}`, part1, part2 });
    console.log(`${fam}_H${H} | ${p1.length} | ${pc(mean(p1.map((t) => t.gross)))} | ${pc(mean(p1.map((t) => net(t, COST))))} | ${wNet.filter((x) => x > 0).length}/6 | ${pc(mean(upM))} | ${pc(mean(dnM))} | ${part1 ? "PASS" : "fail"} | ${p2.length} | ${pc(m2)} | ${pc(mean(p2.map((t) => net(t, STRESS))))} | ${pv.toExponential(2)} | ${part2 ? "PASS" : "fail"}`);
  }
  const both = verdicts.filter((v) => v.part1 && v.part2);
  console.log(`\nSUMMARY: ${K} rules, ${verdicts.filter((v) => v.part1).length} passed part 1, ${both.length} passed both${both.length ? `: ${both.map((v) => v.id).join(", ")}` : ""}`);
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "fetch" && dir) fetchAll(dir).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === "run" && dir) run(dir);
else { console.error("usage: fetch|run <dir outside repo>"); process.exit(2); }
