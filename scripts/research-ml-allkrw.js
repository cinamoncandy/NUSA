#!/usr/bin/env node
"use strict";
/**
 * Pre-registered experiment chosen by the research meta-learner (scripts/research-meta-learner.js, first run):
 * OHLCV + INTRADAY + ALL_KRW + ML. Work order WO-RESEARCH-20261013-ML-ALLKRW. Read-only: places no orders, changes no setting.
 *
 *   node scripts/research-ml-allkrw.js --fetch <dir>   download public Upbit 60m candles for every KRW market into <dir>
 *   node scripts/research-ml-allkrw.js <dir>           run the experiment on the downloaded files
 *
 * Fixed before the data was fetched (nothing below may change after this commit):
 * - Universe: every KRW market listed on Upbit at fetch time (survivorship bias: delisted markets are absent; disclosed).
 *   Span: 60m candles from 2025-10-13T00:00Z to 2026-10-13T00:00Z (365 days).
 *   A market is eligible only if it has >= 90% of the hours in the training span and its median daily traded value over the
 *   training span is >= 1,000,000,000 KRW. Eligibility uses training data only.
 * - Splits by time: train = first 60% of days, validation = next 20%, holdout = last 20%. A 1-day embargo is dropped before
 *   validation and before holdout so a 24h label never crosses a boundary.
 * - Decision once a day at 00:00 UTC. Features use only candles that closed at or before the decision time:
 *   returns over 1, 4, 24, 72, 168 hours; realised volatility of hourly returns over 24 and 168 hours; volume ratio
 *   (24h / 168h average); distance from the 168h high close; RSI(14) on hourly closes; KRW-BTC 24h return; the market's
 *   cross-sectional percentile of its 24h return. Standardised with training means and deviations.
 * - Label: the next 24h close-to-close return > 0.2% (round-trip base cost).
 * - Model: L2-regularised logistic regression by full-batch gradient descent (2,000 steps, learning rate 0.1, zero init).
 *   lambda in {0.1, 1, 10}; the one with the best validation mean net return per trade is chosen. Nothing is tuned on holdout.
 * - Trading rule: each decision day, buy the top 5 eligible markets by predicted probability among those with probability > 0.5,
 *   equal weight, hold 24h, exit at the close. Base costs 0.05% fee + 5 bp slippage per side; stress 2x.
 * - Holdout PASS only if all hold: >= 50 trades; mean net return per trade > 0; one-sided z-test p < 0.05 / K where K is the
 *   ledger's cumulative configurations plus the 3 lambdas (173 + 3 = 176); mean net under 2x costs > 0; and the mean net per trade
 *   beats the mean net of buying every eligible market on the same days (skill, not market drift).
 * - A PASS only makes the model eligible for a formal Research experiment; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const START = Date.parse("2025-10-13T00:00:00Z");
const END = Date.parse("2026-10-13T00:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;
const K_CUMULATIVE = 173 + 3;
const LAMBDAS = [0.1, 1, 10];
const TOP = 5;
const FEE = 0.0005;
const SLIP = 0.0005;

async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const markets = (await (await fetch("https://api.upbit.com/v1/market/all")).json()).map((m) => m.market).filter((m) => m.startsWith("KRW-")).sort();
  const manifest = {};
  for (const market of markets) {
    const file = path.join(dir, `${market}.json`);
    if (fs.existsSync(file)) { manifest[market] = sha(fs.readFileSync(file)); continue; }
    const rows = new Map();
    let to = new Date(END).toISOString().slice(0, 19);
    for (let page = 0; page < 60; page += 1) {
      let response;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        response = await fetch(`https://api.upbit.com/v1/candles/minutes/60?market=${market}&count=200&to=${to}`);
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
    process.stdout.write(".");
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ start: START, end: END, markets: manifest }, null, 1));
  console.log(`\nfetched ${markets.length} markets; manifest sha256 ${sha(fs.readFileSync(path.join(dir, "manifest.json")))}`);
}
function sha(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }

function load(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const series = {};
  for (const market of Object.keys(manifest.markets)) {
    const raw = fs.readFileSync(path.join(dir, `${market}.json`));
    if (sha(raw) !== manifest.markets[market]) throw new Error(`MANIFEST_MISMATCH:${market}`);
    const byHour = new Map(JSON.parse(raw).map((r) => [r[0], r]));
    series[market] = byHour;
  }
  return series;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function closeAt(byHour, t) { const r = byHour.get(t); return r ? r[4] : undefined; }

/** Features at decision time d (candles that opened at d-1h and earlier, i.e. closed by d). */
function features(byHour, btc, d) {
  const c = (h) => closeAt(byHour, d - h * H); // close of the candle that opened h hours before d
  const now = c(1);
  if (now === undefined) return undefined;
  const closes = [];
  for (let h = 169; h >= 1; h -= 1) { const v = c(h); if (v === undefined) return undefined; closes.push(v); }
  const rets = closes.slice(1).map((v, i) => v / closes[i] - 1);
  const ret = (h) => now / closes[closes.length - 1 - h] - 1;
  let vol24 = 0; let vol168 = 0;
  for (let h = 1; h <= 168; h += 1) { const r = byHour.get(d - h * H); const v = r ? r[5] : 0; if (h <= 24) vol24 += v; vol168 += v; }
  let gain = 0; let loss = 0;
  for (const r of rets.slice(-14)) { if (r > 0) gain += r; else loss -= r; }
  const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  const btcNow = closeAt(btc, d - H); const btcPast = closeAt(btc, d - 25 * H);
  if (btcNow === undefined || btcPast === undefined) return undefined;
  const hour = new Date(d).getUTCHours();
  return [ret(1), ret(4), ret(24), ret(72), ret(167), std(rets.slice(-24)), std(rets), vol168 > 0 ? (vol24 / 24) / (vol168 / 168) : 1,
    now / Math.max(...closes) - 1, rsi / 100, btcNow / btcPast - 1, Math.sin((2 * Math.PI * hour) / 24), Math.cos((2 * Math.PI * hour) / 24)];
}

function forward(byHour, d) {
  const entry = closeAt(byHour, d - H); const exit = closeAt(byHour, d + 23 * H);
  return entry === undefined || exit === undefined ? undefined : exit / entry - 1;
}

function netOf(gross, fee, slip) { return ((1 + gross) * (1 - slip) * (1 - fee)) / ((1 + slip) * (1 + fee)) - 1; }

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
  if (!btc) throw new Error("KRW-BTC missing");
  const days = Math.round((END - START) / DAY);
  const trainEnd = START + Math.floor(days * 0.6) * DAY;
  const validStart = trainEnd + DAY; const validEnd = START + Math.floor(days * 0.8) * DAY;
  const holdStart = validEnd + DAY;
  // Eligibility from training data only.
  const eligible = Object.keys(series).filter((m) => {
    const rows = [...series[m].values()].filter((r) => r[0] < trainEnd);
    if (rows.length < 0.9 * ((trainEnd - START) / H)) return false;
    const daily = new Map();
    for (const r of rows) { const k = Math.floor(r[0] / DAY); daily.set(k, (daily.get(k) ?? 0) + r[6]); }
    return median([...daily.values()]) >= 1e9;
  });
  console.log(`markets fetched ${Object.keys(series).length}; eligible ${eligible.length}`);
  const sample = (from, to) => {
    const rows = [];
    for (let d = from; d < to; d += DAY) {
      const day = [];
      for (const m of eligible) {
        const f = features(series[m], btc, d); const fwd = forward(series[m], d);
        if (f && fwd !== undefined) day.push({ m, d, f, fwd });
      }
      const r24 = day.map((x) => x.f[2]).sort((a, b) => a - b);
      for (const x of day) { x.f.push(r24.length > 1 ? r24.indexOf(x.f[2]) / (r24.length - 1) : 0.5); rows.push(x); }
    }
    return rows;
  };
  const trainRows = sample(START + 8 * DAY, trainEnd - DAY);
  const validRows = sample(validStart, validEnd - DAY);
  const holdRows = sample(holdStart, END - DAY);
  const p = trainRows[0].f.length;
  const mu = Array.from({ length: p }, (_, j) => mean(trainRows.map((r) => r.f[j])));
  const sd = Array.from({ length: p }, (_, j) => std(trainRows.map((r) => r.f[j])) || 1);
  const z = (f) => f.map((v, j) => (v - mu[j]) / sd[j]);
  const X = trainRows.map((r) => z(r.f)); const y = trainRows.map((r) => (r.fwd > 0.002 ? 1 : 0));
  console.log(`samples train ${trainRows.length} (positive ${(mean(y) * 100).toFixed(1)}%), validation ${validRows.length}, holdout ${holdRows.length}`);
  const trade = (rows, model, fee, slip) => {
    const byDay = new Map();
    for (const r of rows) { if (!byDay.has(r.d)) byDay.set(r.d, []); byDay.get(r.d).push(r); }
    const picks = []; const all = [];
    for (const day of byDay.values()) {
      for (const r of day) all.push(netOf(r.fwd, fee, slip));
      day.map((r) => ({ r, p: model(z(r.f)) })).filter((x) => x.p > 0.5).sort((a, b) => b.p - a.p).slice(0, TOP).forEach((x) => picks.push(netOf(x.r.fwd, fee, slip)));
    }
    return { picks, all };
  };
  let best;
  for (const lambda of LAMBDAS) {
    const model = train(X, y, lambda);
    const v = trade(validRows, model, FEE, SLIP);
    console.log(`lambda ${lambda}: validation trades ${v.picks.length}, mean net/trade ${(mean(v.picks) * 100).toFixed(3)}%, universe mean ${(mean(v.all) * 100).toFixed(3)}%`);
    if (v.picks.length > 0 && (best === undefined || mean(v.picks) > best.score)) best = { lambda, model, score: mean(v.picks) };
  }
  if (best === undefined) { console.log("VERDICT FAIL (no validation trades)"); return; }
  const h = trade(holdRows, best.model, FEE, SLIP);
  const s = trade(holdRows, best.model, FEE * 2, SLIP * 2);
  const m = mean(h.picks); const sdev = std(h.picks); const n = h.picks.length;
  const pval = n > 1 && sdev > 0 ? normalSf(m / (sdev / Math.sqrt(n))) : 1;
  const alpha = 0.05 / K_CUMULATIVE;
  const checks = { trades: n >= 50, positive: m > 0, significant: pval < alpha, stress: mean(s.picks) > 0, beatsUniverse: m > mean(h.all) };
  console.log(`\nHOLDOUT (lambda ${best.lambda}): trades ${n}, mean net/trade ${(m * 100).toFixed(3)}%, 2x ${(mean(s.picks) * 100).toFixed(3)}%, universe ${(mean(h.all) * 100).toFixed(3)}%, win rate ${((h.picks.filter((x) => x > 0).length / Math.max(1, n)) * 100).toFixed(1)}%, p ${pval.toExponential(2)} (bar ${alpha.toExponential(2)})`);
  console.log(`checks ${JSON.stringify(checks)}`);
  console.log(`VERDICT ${Object.values(checks).every(Boolean) ? "PASS" : "FAIL"}`);
}

(async () => {
  if (process.argv[2] === "--fetch") await fetchAll(process.argv[3]);
  else run(process.argv[2]);
})().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
