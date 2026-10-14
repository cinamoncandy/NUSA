#!/usr/bin/env node
"use strict";
/**
 * Pre-registered experiment chosen by the research meta-learner after ML_ALLKRW_DAILY: EXTERNAL + DAILY + ALL_KRW + ML.
 * Work order WO-RESEARCH-20261013-ML-EXTERNAL. Identical to scripts/research-ml-allkrw-daily.js (same daily data and manifest)
 * except three EXTERNAL features and K. Read-only: places no orders, changes no setting.
 *   node scripts/research-ml-external.js --fetch-external <daily-dir>   Coinbase BTC-USD daily closes + ECB USD/KRW into external.json
 *   node scripts/research-ml-external.js <daily-dir>
 * EXTERNAL features for decision day d (all known before d 00:00 UTC): the BTC Korea premium on day d-1
 *   = Upbit KRW-BTC close / (Coinbase BTC-USD close x latest ECB USD/KRW on or before d-1) - 1; its change over 7 days;
 *   and the Coinbase BTC-USD 7-day return. K = 183 + 3 = 186.
 *
 *   node scripts/research-ml-allkrw-daily.js --fetch <dir>   download public Upbit daily candles for every KRW market
 *   node scripts/research-ml-allkrw-daily.js <dir>           run the experiment
 *
 * Fixed before the data was fetched (nothing below may change after this commit):
 * - Universe: every KRW market listed on Upbit at fetch time (survivorship bias disclosed). Daily candles (UTC 00:00) from
 *   2021-10-13 to 2026-10-13. A market is eligible on a decision day only if it has >= 60 prior days and its median daily traded
 *   value over the previous 30 days is >= 1,000,000,000 KRW (point in time, no look-ahead).
 * - Splits by time over decision days: train first 60%, validation next 20%, holdout last 20%, with a 1-day embargo before each.
 * - Decision at each day's open (after the previous daily candle closed). Features: returns over 1, 3, 7, 14, 30 days;
 *   volatility of daily returns over 7 and 30 days; volume ratio (7-day / 30-day average traded value); distance from the 30-day
 *   high close; RSI(14) on daily closes; KRW-BTC 7-day return; cross-sectional percentile of the 7-day return. Standardised with
 *   training statistics.
 * - Label: the next day's close-to-close return > 0.2%.
 * - Model: the same L2 logistic regression as ML_ALLKRW (2,000 steps, rate 0.1), lambda in {0.1, 1, 10} chosen on validation.
 * - Trading rule: each day buy the top 5 eligible markets by predicted probability (no threshold; the v1 lesson), hold one day.
 *   Costs 0.05% fee + 5 bp slippage per side; stress 2x.
 * - Holdout PASS only if: >= 50 trades; mean net per trade > 0; one-sided z p < 0.05 / 186 (ledger 183 + 3 lambdas);
 *   2x-cost mean > 0; and the mean beats buying every eligible market on the same days.
 * - A PASS only makes the model eligible for a formal Research experiment; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const START = Date.parse("2021-10-13T00:00:00Z");
const END = Date.parse("2026-10-13T00:00:00Z");
const DAY = 86_400_000;
const K_CUMULATIVE = 183 + 3;
const LAMBDAS = [0.1, 1, 10];
const TOP = 5;
const FEE = 0.0005;
const SLIP = 0.0005;

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

async function fetchMarket(dir, market, manifest) {
  const file = path.join(dir, `${market}.json`);
  if (fs.existsSync(file)) { manifest[market] = sha(fs.readFileSync(file)); return; }
  const rows = new Map();
  let to = new Date(END).toISOString().slice(0, 19);
  for (let page = 0; page < 20; page += 1) {
    let response;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(`https://api.upbit.com/v1/candles/days?market=${market}&count=200&to=${to}`);
      if (response.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`UPBIT_HTTP_${response.status}:${market}`);
    const batch = await response.json();
    if (batch.length === 0) break;
    for (const r of batch) {
      const at = Date.parse(`${r.candle_date_time_utc}Z`);
      if (at >= START && at < END) rows.set(at, [at, r.opening_price, r.high_price, r.low_price, r.trade_price, r.candle_acc_trade_volume, r.candle_acc_trade_price]);
    }
    const oldest = Date.parse(`${batch[batch.length - 1].candle_date_time_utc}Z`);
    if (batch.length < 200 || oldest <= START) break;
    to = new Date(oldest).toISOString().slice(0, 19);
    await new Promise((r) => setTimeout(r, 120));
  }
  const body = JSON.stringify([...rows.values()].sort((a, b) => a[0] - b[0]));
  fs.writeFileSync(file, body);
  manifest[market] = sha(body);
}

async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const markets = (await (await fetch("https://api.upbit.com/v1/market/all")).json()).map((m) => m.market).filter((m) => m.startsWith("KRW-")).sort();
  const manifest = {};
  const queue = [...markets];
  const worker = async () => { for (let m = queue.shift(); m !== undefined; m = queue.shift()) await fetchMarket(dir, m, manifest); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ start: START, end: END, markets: sorted }, null, 1));
  console.log(`fetched ${markets.length} markets; manifest sha256 ${sha(fs.readFileSync(path.join(dir, "manifest.json")))}`);
}

async function fetchExternal(dir) {
  const coinbase = new Map();
  for (let from = START - 40 * DAY; from < END; from += 290 * DAY) {
    const to = Math.min(END, from + 290 * DAY);
    const response = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}`, { headers: { "User-Agent": "nusa-research/1.0" } });
    if (!response.ok) throw new Error(`COINBASE_HTTP_${response.status}`);
    for (const [t, , , , close] of await response.json()) coinbase.set(t * 1000, close);
    await new Promise((r) => setTimeout(r, 400));
  }
  const fxResponse = await fetch(`https://api.frankfurter.dev/v1/${new Date(START - 40 * DAY).toISOString().slice(0, 10)}..${new Date(END).toISOString().slice(0, 10)}?base=USD&symbols=KRW`);
  if (!fxResponse.ok) throw new Error(`FX_HTTP_${fxResponse.status}`);
  const fx = Object.entries((await fxResponse.json()).rates).map(([date, r]) => [Date.parse(`${date}T00:00:00Z`), r.KRW]).sort((a, b) => a[0] - b[0]);
  const body = JSON.stringify({ coinbaseBtcUsd: [...coinbase.entries()].sort((a, b) => a[0] - b[0]), usdKrw: fx });
  fs.writeFileSync(path.join(dir, "external.json"), body);
  console.log(`external: ${coinbase.size} Coinbase days, ${fx.length} FX days; sha256 ${sha(body)}`);
}

function loadExternal(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "external.json"), "utf8"));
  const cb = new Map(raw.coinbaseBtcUsd);
  const fx = raw.usdKrw;
  const fxOnOrBefore = (t) => { let v; for (const [at, rate] of fx) { if (at > t) break; v = rate; } return v; };
  return { cb, fxOnOrBefore };
}

function load(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const series = {};
  for (const market of Object.keys(manifest.markets)) {
    const raw = fs.readFileSync(path.join(dir, `${market}.json`));
    if (sha(raw) !== manifest.markets[market]) throw new Error(`MANIFEST_MISMATCH:${market}`);
    series[market] = new Map(JSON.parse(raw).map((r) => [r[0], r]));
  }
  return series;
}

/** Features for decision day d: only candles that opened on d-1 or earlier (all closed by d). */
let EXT;
function premium(btc, day) {
  const upbit = btc.get(day); const usd = EXT.cb.get(day); const fx = EXT.fxOnOrBefore(day);
  return upbit && usd && fx ? upbit[4] / (usd * fx) - 1 : undefined;
}
function features(byDay, btc, d) {
  const row = (k) => byDay.get(d - k * DAY);
  const closes = []; const values = [];
  for (let k = 60; k >= 1; k -= 1) { const r = row(k); if (!r) return undefined; closes.push(r[4]); values.push(r[6]); }
  if (median(values.slice(-30)) < 1e9) return undefined;
  const now = closes[closes.length - 1];
  const ret = (k) => now / closes[closes.length - 1 - k] - 1;
  const rets = closes.slice(1).map((v, i) => v / closes[i] - 1);
  let gain = 0; let loss = 0;
  for (const r of rets.slice(-14)) { if (r > 0) gain += r; else loss -= r; }
  const b1 = btc.get(d - DAY); const b8 = btc.get(d - 8 * DAY);
  if (!b1 || !b8) return undefined;
  const p1 = premium(btc, d - DAY); const p8 = premium(btc, d - 8 * DAY);
  const c1 = EXT.cb.get(d - DAY); const c8 = EXT.cb.get(d - 8 * DAY);
  if (p1 === undefined || p8 === undefined || !c1 || !c8) return undefined;
  return [p1, p1 - p8, c1 / c8 - 1, ret(1), ret(3), ret(7), ret(14), ret(30), std(rets.slice(-7)), std(rets.slice(-30)), mean(values.slice(-7)) / Math.max(1, mean(values.slice(-30))),
    now / Math.max(...closes.slice(-30)) - 1, (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)) / 100, b1[4] / b8[4] - 1];
}
function forward(byDay, d) { const a = byDay.get(d - DAY); const b = byDay.get(d); return a && b ? b[4] / a[4] - 1 : undefined; }
const netOf = (g, fee, slip) => ((1 + g) * (1 - slip) * (1 - fee)) / ((1 + slip) * (1 + fee)) - 1;

function train(X, y, lambda) {
  const n = X.length; const p = X[0].length; const w = new Array(p).fill(0); let b = 0;
  for (let step = 0; step < 2000; step += 1) {
    const gw = new Array(p).fill(0); let gb = 0;
    for (let i = 0; i < n; i += 1) {
      let z = b; for (let j = 0; j < p; j += 1) z += w[j] * X[i][j];
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < p; j += 1) gw[j] += e * X[i][j];
      gb += e;
    }
    for (let j = 0; j < p; j += 1) w[j] -= 0.1 * (gw[j] / n + (lambda * w[j]) / n);
    b -= 0.1 * (gb / n);
  }
  return (x) => { let z = b; for (let j = 0; j < p; j += 1) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)); };
}
function normalSf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; }

function run(dir) {
  const series = load(dir);
  const btc = series["KRW-BTC"];
  const firstDecision = START + 61 * DAY;
  const days = Math.round((END - firstDecision) / DAY);
  const trainEnd = firstDecision + Math.floor(days * 0.6) * DAY;
  const validStart = trainEnd + DAY; const validEnd = firstDecision + Math.floor(days * 0.8) * DAY; const holdStart = validEnd + DAY;
  const sample = (from, to) => {
    const rows = [];
    for (let d = from; d < to; d += DAY) {
      const day = [];
      for (const m of Object.keys(series)) { const f = features(series[m], btc, d); const fwd = forward(series[m], d); /* close of day d-1 (decision) to close of day d */ if (f && fwd !== undefined) day.push({ m, d, f, fwd }); }
      const r7 = day.map((x) => x.f[5]).sort((a, b) => a - b);
      for (const x of day) { x.f.push(r7.length > 1 ? r7.indexOf(x.f[5]) / (r7.length - 1) : 0.5); rows.push(x); }
    }
    return rows;
  };
  const trainRows = sample(firstDecision, trainEnd - DAY); const validRows = sample(validStart, validEnd - DAY); const holdRows = sample(holdStart, END - DAY);
  const p = trainRows[0].f.length;
  const mu = Array.from({ length: p }, (_, j) => mean(trainRows.map((r) => r.f[j])));
  const sd = Array.from({ length: p }, (_, j) => std(trainRows.map((r) => r.f[j])) || 1);
  const z = (f) => f.map((v, j) => (v - mu[j]) / sd[j]);
  const X = trainRows.map((r) => z(r.f)); const y = trainRows.map((r) => (r.fwd > 0.002 ? 1 : 0));
  console.log(`markets ${Object.keys(series).length}; samples train ${trainRows.length} (positive ${(mean(y) * 100).toFixed(1)}%), validation ${validRows.length}, holdout ${holdRows.length}`);
  console.log(`spans: train ${new Date(firstDecision).toISOString().slice(0, 10)}..${new Date(trainEnd).toISOString().slice(0, 10)}, holdout ${new Date(holdStart).toISOString().slice(0, 10)}..${new Date(END).toISOString().slice(0, 10)}`);
  const trade = (rows, model, fee, slip) => {
    const byDay = new Map();
    for (const r of rows) { if (!byDay.has(r.d)) byDay.set(r.d, []); byDay.get(r.d).push(r); }
    const picks = []; const all = [];
    for (const day of byDay.values()) {
      for (const r of day) all.push(netOf(r.fwd, fee, slip));
      day.map((r) => ({ r, p: model(z(r.f)) })).sort((a, b) => b.p - a.p).slice(0, TOP).forEach((x) => picks.push(netOf(x.r.fwd, fee, slip)));
    }
    return { picks, all };
  };
  let best;
  for (const lambda of LAMBDAS) {
    const model = train(X, y, lambda);
    const v = trade(validRows, model, FEE, SLIP);
    console.log(`lambda ${lambda}: validation trades ${v.picks.length}, mean net/trade ${(mean(v.picks) * 100).toFixed(3)}%, universe ${(mean(v.all) * 100).toFixed(3)}%`);
    if (v.picks.length > 0 && (best === undefined || mean(v.picks) > best.score)) best = { lambda, model, score: mean(v.picks) };
  }
  const h = trade(holdRows, best.model, FEE, SLIP); const s = trade(holdRows, best.model, FEE * 2, SLIP * 2);
  const m = mean(h.picks); const n = h.picks.length; const sdev = std(h.picks);
  const pval = n > 1 && sdev > 0 ? normalSf(m / (sdev / Math.sqrt(n))) : 1; const alpha = 0.05 / K_CUMULATIVE;
  const checks = { trades: n >= 50, positive: m > 0, significant: pval < alpha, stress: mean(s.picks) > 0, beatsUniverse: m > mean(h.all) };
  console.log(`\nHOLDOUT (lambda ${best.lambda}): trades ${n}, mean net/trade ${(m * 100).toFixed(3)}%, 2x ${(mean(s.picks) * 100).toFixed(3)}%, universe ${(mean(h.all) * 100).toFixed(3)}%, win rate ${((h.picks.filter((x) => x > 0).length / Math.max(1, n)) * 100).toFixed(1)}%, p ${pval.toExponential(2)} (bar ${alpha.toExponential(2)})`);
  console.log(`checks ${JSON.stringify(checks)}`);
  console.log(`VERDICT ${Object.values(checks).every(Boolean) ? "PASS" : "FAIL"}`);
}

(async () => {
  if (process.argv[2] === "--fetch-external") await fetchExternal(process.argv[3]);
  else { EXT = loadExternal(process.argv[2]); run(process.argv[2]); }
})().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
