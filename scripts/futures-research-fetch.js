#!/usr/bin/env node
"use strict";

/**
 * Downloads the public Binance USD-M history pre-registered in
 * docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md (4h klines and funding rates, five symbols,
 * 2023-01-01 to 2026-10-14) and writes it with a SHA-256 manifest so the evaluation can refuse changed files.
 *
 * Read-only and credential-free: plain GETs of public market-data paths, no headers, no key, no order endpoint.
 * The range and symbols are fixed constants (the pre-registration), not inputs. Network access is injected so the
 * pagination is tested without the network.
 *
 * Usage: node scripts/futures-research-fetch.js <out-dir>
 */

const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const BASE = "https://fapi.binance.com";
const SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"]);
const START_MS = Date.UTC(2023, 0, 1);
const END_MS = Date.UTC(2026, 9, 14);
const BAR_MS = 4 * 60 * 60 * 1000;
const KLINE_LIMIT = 1500;
const FUNDING_LIMIT = 1000;
const ALLOWED_PATHS = new Set(["/fapi/v1/klines", "/fapi/v1/fundingRate"]);
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2_000_000;

function publicUrl(path, params) {
  if (!ALLOWED_PATHS.has(path)) throw new Error(`FUTURES_FETCH_PATH_NOT_ALLOWED:${path}`);
  const query = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
  return `${BASE}${path}?${query}`;
}

/** Pages forward through 4h klines until endMs; returns [openTime, open, high, low, close, volume] rows. */
async function fetchKlines(getJson, symbol, startMs = START_MS, endMs = END_MS) {
  const rows = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const page = await getJson(publicUrl("/fapi/v1/klines", { symbol, interval: "4h", startTime: cursor, endTime: endMs - 1, limit: KLINE_LIMIT }));
    if (!Array.isArray(page)) throw new Error(`FUTURES_FETCH_BAD_PAGE:${symbol}:klines`);
    if (page.length === 0) break;
    for (const row of page) {
      const openTime = Number(row[0]);
      if (!Number.isSafeInteger(openTime) || openTime < cursor || openTime >= endMs) continue;
      const values = row.slice(1, 6).map(Number);
      if (!values.every(Number.isFinite)) throw new Error(`FUTURES_FETCH_BAD_ROW:${symbol}:${openTime}`);
      rows.push([openTime, ...values]);
    }
    const last = Number(page[page.length - 1][0]);
    if (!Number.isSafeInteger(last) || last + BAR_MS <= cursor) break;
    cursor = last + BAR_MS;
  }
  return rows;
}

/** Pages forward through funding history; returns [fundingTime, fundingRate, markPrice|null] rows. */
async function fetchFunding(getJson, symbol, startMs = START_MS, endMs = END_MS) {
  const rows = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const page = await getJson(publicUrl("/fapi/v1/fundingRate", { symbol, startTime: cursor, endTime: endMs - 1, limit: FUNDING_LIMIT }));
    if (!Array.isArray(page)) throw new Error(`FUTURES_FETCH_BAD_PAGE:${symbol}:funding`);
    if (page.length === 0) break;
    for (const item of page) {
      const time = Number(item.fundingTime);
      const rate = Number(item.fundingRate);
      if (!Number.isSafeInteger(time) || time < cursor || time >= endMs) continue;
      if (!Number.isFinite(rate)) throw new Error(`FUTURES_FETCH_BAD_ROW:${symbol}:${time}`);
      const mark = item.markPrice === undefined || item.markPrice === "" ? null : Number(item.markPrice);
      rows.push([time, rate, Number.isFinite(mark) ? mark : null]);
    }
    const last = Number(page[page.length - 1].fundingTime);
    if (!Number.isSafeInteger(last) || last + 1 <= cursor) break;
    cursor = last + 1;
  }
  return rows;
}

/** Strictly increasing, de-duplicated; counts missing 4h bars instead of filling them. */
function summarizeKlines(rows) {
  const sorted = [...new Map(rows.map((row) => [row[0], row])).values()].sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i += 1) gaps += Math.max(0, Math.round((sorted[i][0] - sorted[i - 1][0]) / BAR_MS) - 1);
  return { rows: sorted, missingBars: gaps };
}

/** Funding settles every 8 hours on these symbols: count expected settlement times the history does not contain. */
function missingFundingTimes(rows, startMs = START_MS, endMs = END_MS) {
  const have = new Set(rows.map((row) => Math.round(row[0] / FUNDING_INTERVAL_MS)));
  let missing = 0;
  for (let t = Math.ceil(startMs / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS; t < endMs; t += FUNDING_INTERVAL_MS) if (!have.has(t / FUNDING_INTERVAL_MS)) missing += 1;
  return missing;
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

async function run(outDir, getJson, pauseMs = 250) {
  mkdirSync(outDir, { recursive: true });
  const manifest = { preregistration: "docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md", source: BASE, startMs: START_MS, endMs: END_MS, interval: "4h", files: {} };
  const paced = async (url) => { await new Promise((resolve) => setTimeout(resolve, pauseMs)); return getJson(url); };
  for (const symbol of SYMBOLS) {
    const klines = summarizeKlines(await fetchKlines(paced, symbol));
    const funding = await fetchFunding(paced, symbol);
    for (const [name, rows, extra] of [[`${symbol}-4h.json`, klines.rows, { missingBars: klines.missingBars }], [`${symbol}-funding.json`, funding, { missingFundingTimes: missingFundingTimes(funding) }]]) {
      const text = `${JSON.stringify(rows)}\n`;
      writeFileSync(join(outDir, name), text);
      manifest.files[name] = { rows: rows.length, firstMs: rows[0]?.[0] ?? null, lastMs: rows.at(-1)?.[0] ?? null, sha256: sha256(text), ...extra };
    }
  }
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** One bounded GET; a 429 or 5xx is retried once after the server's Retry-After (capped) or 5 s, anything else fails. */
async function httpGetJson(url, attempt = 1) {
  const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if ((response.status === 429 || response.status >= 500) && attempt === 1) {
    const retryAfter = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 5));
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return httpGetJson(url, 2);
  }
  if (!response.ok) throw new Error(`FUTURES_FETCH_HTTP_${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("FUTURES_FETCH_BODY_TOO_LARGE");
  return JSON.parse(text);
}

if (require.main === module) {
  if (Number(process.versions.node.split(".")[0]) < 18) { console.error(`FUTURES_FETCH_NODE_TOO_OLD:${process.versions.node}`); process.exit(2); }
  const outDir = process.argv[2];
  if (!outDir) { console.error("usage: node scripts/futures-research-fetch.js <out-dir>"); process.exit(2); }
  run(outDir, httpGetJson).then((manifest) => {
    for (const [name, file] of Object.entries(manifest.files)) console.log(`${name} rows=${file.rows} sha256=${file.sha256}${file.missingBars === undefined ? "" : ` missingBars=${file.missingBars}`}${file.missingFundingTimes === undefined ? "" : ` missingFundingTimes=${file.missingFundingTimes}`}`);
    console.log("FUTURES_RESEARCH_FETCH OK");
  }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}

module.exports = { SYMBOLS, START_MS, END_MS, publicUrl, fetchKlines, fetchFunding, summarizeKlines, missingFundingTimes, run };
