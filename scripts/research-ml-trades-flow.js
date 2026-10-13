#!/usr/bin/env node
"use strict";
/**
 * Meta-learner recommendation TRADES+INTRADAY+ALL_KRW+ML (docs/NUSA_RECURSIVE_SELF_IMPROVEMENT.md), work order
 * WO-RESEARCH-20261013-TRADES-FLOW. Read-only: downloads public Upbit trade ticks, places no orders, changes no setting.
 *
 *   node scripts/research-ml-trades-flow.js --fetch <dir>   download public trade ticks into <dir>
 *   node scripts/research-ml-trades-flow.js <dir>           run the experiment on the downloaded files
 *
 * Fixed before any trade tick was fetched (nothing below may change after this commit):
 * - Universe: the 30 KRW markets with the highest 24h traded value on Upbit at fetch time (selection uses the fetch-time
 *   ticker, i.e. information from after the span: a disclosed bias that can only flatter results).
 * - Span: the seven complete UTC days 2026-10-06 .. 2026-10-12 (Upbit keeps 7 days of public ticks; daysAgo 7..1).
 * - Bars: 15-minute buckets of ticks. Taker side from ask_bid: BID = buyer-initiated, ASK = seller-initiated.
 * - Splits by day: train = 10-06..10-09, validation = 10-10, holdout = 10-11..10-12. The last hour before validation and before
 *   holdout is dropped so a 60m label never crosses a boundary.
 * - Decision every hour on the hour. Features use only ticks before the decision time: log return over 15, 60, 240 minutes;
 *   order-flow imbalance (buy - sell volume) / (buy + sell volume) over 15, 60, 240 minutes; traded-value ratio 60m / 240m
 *   average; trade-count ratio 60m / 240m average; KRW-BTC order-flow imbalance over 60 minutes; the market's cross-sectional
 *   percentile of its 60m return. A market-hour needs at least one trade in each of the previous 16 buckets. Standardised with
 *   training means and deviations.
 * - Price at a time = the last trade price before it. Label: next 60m return > 0.2% (round-trip base cost).
 * - Model: L2-regularised logistic regression by full-batch gradient descent (2,000 steps, learning rate 0.1, zero init),
 *   lambda in {0.1, 1, 10}; the lambda with the best validation mean net return per trade is chosen. Nothing is tuned on holdout.
 * - Trading rule: each decision hour, buy the top 3 eligible markets by predicted probability, equal weight, hold 60m.
 *   Base costs 0.05% fee + 5 bp slippage per side; stress 2x.
 * - Discovery PASS (validation): mean net per trade > 0 AND above the mean net of buying every eligible market at the same hours.
 * - Holdout PASS only if all hold: >= 50 trades; mean net per trade > 0; one-sided z-test p < 0.05 / K with K = ledger
 *   configurations before this experiment plus the 3 lambdas (189 + 3 = 192); mean net under 2x costs > 0; and the mean net per
 *   trade beats the mean net of buying every eligible market at the same hours (skill, not drift).
 * - A PASS only makes the model eligible for a formal Research experiment and a forward SHADOW test; it is not promotion evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const M15 = 15 * 60_000;
const H = 3_600_000;
const DAY = 24 * H;
const SPAN_START = Date.parse("2026-10-06T00:00:00Z");
const SPAN_END = Date.parse("2026-10-13T00:00:00Z");
const VAL_START = Date.parse("2026-10-10T00:00:00Z");
const HOLD_START = Date.parse("2026-10-11T00:00:00Z");
const K_CUMULATIVE = 189 + 3;
const TOP_MARKETS = 30;
const PICKS = 3;
const FEE = 0.0005;
const SLIP = 0.0005;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`rate limited ${url}`);
}

async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const markets = (await getJson("https://api.upbit.com/v1/market/all")).map((m) => m.market).filter((m) => m.startsWith("KRW-"));
  const tickers = [];
  for (let i = 0; i < markets.length; i += 100) tickers.push(...await getJson(`https://api.upbit.com/v1/ticker?markets=${markets.slice(i, i + 100).join(",")}`));
  const universe = tickers.sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h).slice(0, TOP_MARKETS).map((t) => t.market);
  if (!universe.includes("KRW-BTC")) universe[universe.length - 1] = "KRW-BTC";
  const manifest = { fetchedAt: new Date().toISOString(), universe, files: {} };
  for (const market of universe) {
    const rows = [];
    for (let daysAgo = 7; daysAgo >= 1; daysAgo -= 1) {
      let cursor;
      for (;;) {
        const url = `https://api.upbit.com/v1/trades/ticks?market=${market}&count=500&daysAgo=${daysAgo}${cursor === undefined ? "" : `&cursor=${cursor}`}`;
        const page = await getJson(url);
        await sleep(120);
        if (!Array.isArray(page) || page.length === 0) break;
        for (const t of page) rows.push([t.timestamp, t.trade_price, t.trade_volume, t.ask_bid === "BID" ? 1 : 0]);
        cursor = page[page.length - 1].sequential_id;
        if (page.length < 500) break;
      }
    }
    const kept = rows.filter((r) => r[0] >= SPAN_START && r[0] < SPAN_END).sort((a, b) => a[0] - b[0]);
    const body = JSON.stringify(kept);
    fs.writeFileSync(path.join(dir, `${market}.json`), body);
    manifest.files[market] = { ticks: kept.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
    console.log(`${market} ${kept.length} ticks`);
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
}

/** 15m buckets: [lastPrice, buyVol, sellVol, value, count] per bucket index from SPAN_START; lastPrice carries forward. */
function buckets(ticks) {
  const n = (SPAN_END - SPAN_START) / M15;
  const out = Array.from({ length: n }, () => [NaN, 0, 0, 0, 0]);
  for (const [ts, price, vol, buy] of ticks) {
    const b = out[Math.floor((ts - SPAN_START) / M15)];
    b[0] = price; b[buy ? 1 : 2] += vol; b[3] += price * vol; b[4] += 1;
  }
  return out;
}

function features(bk, i, btc) {
  // i = decision bucket index (decision at the START of bucket i, so buckets < i are known)
  for (let k = i - 16; k < i; k += 1) if (k < 0 || bk[k][4] === 0) return null;
  const px = (k) => bk[k][0];
  const sum = (from, f) => { let s = 0; for (let k = i - from; k < i; k += 1) s += f(bk[k]); return s; };
  const ofi = (from, b = bk) => { let buy = 0; let sell = 0; for (let k = i - from; k < i; k += 1) { buy += b[k][1]; sell += b[k][2]; } return buy + sell > 0 ? (buy - sell) / (buy + sell) : 0; };
  const last = px(i - 1);
  return [
    Math.log(last / px(i - 2)), Math.log(last / px(i - 5)), Math.log(last / px(i - 16)),
    ofi(1), ofi(4), ofi(16),
    sum(4, (b) => b[3]) / (sum(16, (b) => b[3]) / 4 || 1),
    sum(4, (b) => b[4]) / (sum(16, (b) => b[4]) / 4 || 1),
    btc == null ? 0 : ofi(4, btc),
  ];
}

function priceAt(bk, i) { for (let k = i - 1; k >= 0; k -= 1) if (!Number.isNaN(bk[k][0])) return bk[k][0]; return NaN; }

function train(X, y, lambda) {
  const d = X[0].length; const w = new Array(d + 1).fill(0);
  for (let step = 0; step < 2000; step += 1) {
    const g = new Array(d + 1).fill(0);
    for (let r = 0; r < X.length; r += 1) {
      let z = w[d]; for (let j = 0; j < d; j += 1) z += w[j] * X[r][j];
      const e = 1 / (1 + Math.exp(-z)) - y[r];
      for (let j = 0; j < d; j += 1) g[j] += e * X[r][j];
      g[d] += e;
    }
    for (let j = 0; j < d; j += 1) w[j] -= 0.1 * (g[j] / X.length + lambda * w[j] / X.length);
    w[d] -= 0.1 * g[d] / X.length;
  }
  return (x) => { let z = w[d]; for (let j = 0; j < d; j += 1) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)); };
}

function evaluate(rows, model, costMult) {
  const byHour = new Map();
  for (const r of rows) { if (!byHour.has(r.t)) byHour.set(r.t, []); byHour.get(r.t).push(r); }
  const trades = []; const universe = [];
  for (const group of byHour.values()) {
    const net = (r) => (r.exit * (1 - SLIP * costMult) * (1 - FEE * costMult)) / (r.entry * (1 + SLIP * costMult) * (1 + FEE * costMult)) - 1;
    for (const r of group) universe.push(net(r));
    [...group].sort((a, b) => model(b.x) - model(a.x)).slice(0, PICKS).forEach((r) => trades.push(net(r)));
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const m = mean(trades);
  const sd = Math.sqrt(trades.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, trades.length - 1));
  const z = sd > 0 ? m / (sd / Math.sqrt(trades.length)) : 0;
  const p = 0.5 * erfc(z / Math.SQRT2);
  return { trades: trades.length, mean: m, universe: mean(universe), win: trades.filter((v) => v > 0).length / (trades.length || 1), p };
}
function erfc(x) { const t = 1 / (1 + 0.5 * Math.abs(x)); const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851547 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; }

function run(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const bks = {};
  for (const market of manifest.universe) bks[market] = buckets(JSON.parse(fs.readFileSync(path.join(dir, `${market}.json`), "utf8")));
  const btc = bks["KRW-BTC"];
  const rows = [];
  for (let i = 16; i + 4 <= bks[manifest.universe[0]].length; i += 4) {
    const t = SPAN_START + i * M15;
    const hour = [];
    for (const market of manifest.universe) {
      const x = features(bks[market], i, btc);
      const entry = priceAt(bks[market], i); const exit = priceAt(bks[market], i + 4);
      if (x == null || !(entry > 0) || !(exit > 0)) continue;
      hour.push({ t, market, x, entry, exit, y: exit / entry - 1 > 0.002 ? 1 : 0 });
    }
    const sorted = [...hour].sort((a, b) => a.x[1] - b.x[1]);
    sorted.forEach((r, k) => r.x.push(sorted.length > 1 ? k / (sorted.length - 1) : 0.5));
    rows.push(...hour);
  }
  const inSplit = (r, from, to) => r.t >= from && r.t + H <= to - H;
  const trainRows = rows.filter((r) => inSplit(r, SPAN_START, VAL_START));
  const valRows = rows.filter((r) => r.t >= VAL_START && r.t + H <= HOLD_START - H);
  const holdRows = rows.filter((r) => r.t >= HOLD_START && r.t + H <= SPAN_END);
  const d = trainRows[0].x.length;
  const mu = Array.from({ length: d }, (_, j) => trainRows.reduce((s, r) => s + r.x[j], 0) / trainRows.length);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(trainRows.reduce((s, r) => s + (r.x[j] - mu[j]) ** 2, 0) / trainRows.length) || 1);
  for (const r of rows) r.x = r.x.map((v, j) => (v - mu[j]) / sd[j]);
  console.log(`rows train ${trainRows.length} validation ${valRows.length} holdout ${holdRows.length}; positive rate ${(trainRows.reduce((s, r) => s + r.y, 0) / trainRows.length * 100).toFixed(1)}%`);
  let best;
  for (const lambda of [0.1, 1, 10]) {
    const model = train(trainRows.map((r) => r.x), trainRows.map((r) => r.y), lambda);
    const v = evaluate(valRows, model, 1);
    console.log(`lambda ${lambda}: validation ${v.trades} trades mean ${(v.mean * 100).toFixed(3)}% vs universe ${(v.universe * 100).toFixed(3)}% win ${(v.win * 100).toFixed(1)}%`);
    if (best == null || v.mean > best.v.mean) best = { lambda, model, v };
  }
  const discovery = best.v.mean > 0 && best.v.mean > best.v.universe;
  const h = evaluate(holdRows, best.model, 1);
  const s = evaluate(holdRows, best.model, 2);
  const alpha = 0.05 / K_CUMULATIVE;
  const pass = h.trades >= 50 && h.mean > 0 && h.p < alpha && s.mean > 0 && h.mean > h.universe;
  console.log(`chosen lambda ${best.lambda}; discovery ${discovery ? "PASS" : "FAIL"}`);
  console.log(`holdout ${h.trades} trades mean ${(h.mean * 100).toFixed(3)}% vs universe ${(h.universe * 100).toFixed(3)}% win ${(h.win * 100).toFixed(1)}% p ${h.p.toExponential(2)} (bar ${alpha.toExponential(2)}); 2x costs ${(s.mean * 100).toFixed(3)}%`);
  console.log(`HOLDOUT ${pass ? "PASS" : "FAIL"}`);
}

if (process.argv[2] === "--fetch") fetchAll(process.argv[3]).catch((e) => { console.error(e.message); process.exit(1); });
else if (process.argv[2]) run(process.argv[2]);
else { console.error("usage: --fetch <dir> | <dir>"); process.exit(2); }
