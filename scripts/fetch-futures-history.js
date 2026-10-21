"use strict";
/**
 * Data step of the pre-registered futures regime long/short research (docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md §4,
 * WO-FUTURES-20261014-RESEARCH-PREREG). Fetches PUBLIC Binance USD-M 4h klines and funding history for the five pre-registered symbols,
 * 2023-01-01T00:00Z .. 2026-10-14T00:00Z, into CSV files plus a manifest of SHA-256 hashes.
 * No API key, no account, no order. Fail closed: any HTTP error (451/418/403 included), malformed row, gap, duplicate, unordered or
 * unclosed bar aborts the whole run (nothing is written). Historical closed bars are immutable, so a later fetch must reproduce the same
 * hashes; verify() re-fetches and compares against a committed manifest before any evaluation may read the data.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://fapi.binance.com";
const SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"]);
const START = Date.parse("2023-01-01T00:00:00Z");
const END = Date.parse("2026-10-14T00:00:00Z");
const BAR_MS = 4 * 3_600_000;
const KLINE_HEADER = "openTimeMs,open,high,low,close,volume,closeTimeMs\n";
const FUNDING_HEADER = "fundingTimeMs,fundingRate\n";

class HistoryError extends Error { constructor(code) { super(code); this.name = "HistoryError"; this.code = code; } }

async function getJson(fetchImpl, pathAndQuery, sleep) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(`${BASE}${pathAndQuery}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.json();
    // 451 (region), 418/403 (ban/WAF) and other 4xx are final: never retried, never worked around.
    if (response.status !== 429 && response.status < 500) throw new HistoryError(`HTTP_${response.status}`);
    await sleep(1000 * 2 ** attempt);
  }
  throw new HistoryError("HTTP_RETRY_EXHAUSTED");
}

const num = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" ? Number(v) : Number.NaN;

async function fetchKlines(symbol, deps) {
  const rows = [];
  for (let from = START; from < END;) {
    const data = await getJson(deps.fetchImpl, `/fapi/v1/klines?symbol=${symbol}&interval=4h&startTime=${from}&endTime=${END - 1}&limit=1500`, deps.sleep);
    if (!Array.isArray(data) || data.length === 0) throw new HistoryError("KLINES_EMPTY_OR_INVALID");
    for (const r of data) {
      if (!Array.isArray(r) || r.length < 7) throw new HistoryError("KLINE_ROW_MALFORMED");
      const open = Number(r[0]); const close = Number(r[6]);
      const [o, h, l, c, v] = [r[1], r[2], r[3], r[4], r[5]].map(num);
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || !Number.isFinite(v) || v < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h)) throw new HistoryError("KLINE_VALUES_INVALID");
      if (!Number.isSafeInteger(open) || open !== from || close !== open + BAR_MS - 1 || close >= END) throw new HistoryError("KLINE_GAP_OR_UNALIGNED");
      rows.push(`${open},${r[1]},${r[2]},${r[3]},${r[4]},${r[5]},${close}`);
      from = open + BAR_MS;
    }
    await deps.sleep(250);
  }
  const expected = (END - START) / BAR_MS;
  if (rows.length !== expected) throw new HistoryError("KLINE_COUNT_MISMATCH");
  return rows;
}

async function fetchFunding(symbol, deps) {
  const rows = []; let last = START - 1;
  for (let from = START; from < END;) {
    const data = await getJson(deps.fetchImpl, `/fapi/v1/fundingRate?symbol=${symbol}&startTime=${from}&endTime=${END - 1}&limit=1000`, deps.sleep);
    if (!Array.isArray(data)) throw new HistoryError("FUNDING_INVALID");
    if (data.length === 0) break;
    for (const r of data) {
      const t = Number(r?.fundingTime); const rate = num(r?.fundingRate);
      if (r?.symbol !== symbol || !Number.isSafeInteger(t) || !Number.isFinite(rate) || t <= last || t >= END) throw new HistoryError("FUNDING_ROW_INVALID_OR_UNORDERED");
      rows.push(`${t},${r.fundingRate}`); last = t;
    }
    from = last + 1;
    await deps.sleep(250);
  }
  if (rows.length < 3 * 365) throw new HistoryError("FUNDING_TOO_SHORT");
  return rows;
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Fetches everything in memory first; returns { files: {name: text}, manifest }. Nothing is written here. */
async function fetchHistory({ fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deps = { fetchImpl, sleep };
  const files = {};
  for (const symbol of SYMBOLS) {
    files[`klines_${symbol}_4h.csv`] = KLINE_HEADER + (await fetchKlines(symbol, deps)).join("\n") + "\n";
    files[`funding_${symbol}.csv`] = FUNDING_HEADER + (await fetchFunding(symbol, deps)).join("\n") + "\n";
  }
  const manifest = {
    schemaVersion: 1, source: "binance-usdm-public", symbols: SYMBOLS, interval: "4h", startMs: START, endMs: END,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, text]) => [name, { sha256: sha256(text), rows: text.split("\n").length - 2 }])),
  };
  return { files, manifest };
}

/** Compares a fresh fetch with a committed manifest: the evaluation must refuse to run unless this returns ok. */
function verify(fresh, committed) {
  const m = fresh?.manifest;
  if (m == null || committed == null || typeof committed !== "object") return { ok: false, sameRange: false };
  const sameRange = m.startMs === committed.startMs && m.endMs === committed.endMs && m.interval === committed.interval
    && JSON.stringify(m.symbols) === JSON.stringify(committed.symbols);
  const names = Object.keys(m.files).sort();
  const sameFiles = committed.files != null && JSON.stringify(names) === JSON.stringify(Object.keys(committed.files).sort())
    && names.every((n) => committed.files[n]?.sha256 === m.files[n].sha256 && committed.files[n]?.rows === m.files[n].rows);
  return { ok: sameRange && sameFiles, sameRange };
}

function write(outDir, { files, manifest }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = { fetchHistory, verify, write, HistoryError, SYMBOLS, START, END, BAR_MS };

if (require.main === module) {
  (async () => {
    try {
      const outDir = process.argv[2];
      if (!outDir) throw new HistoryError("OUT_DIR_REQUIRED");
      const result = await fetchHistory();
      write(outDir, result);
      for (const [name, f] of Object.entries(result.manifest.files)) console.log(`HISTORY_FILE ${name} rows=${f.rows} sha256=${f.sha256}`);
      console.log(`HISTORY_MANIFEST_SHA256 ${sha256(JSON.stringify(result.manifest.files))}`);
    } catch (error) {
      console.error("HISTORY_FETCH_FAILED_CLOSED", error instanceof HistoryError ? error.code : "ERROR");
      process.exitCode = 1;
    }
  })();
}
