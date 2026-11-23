"use strict";
/**
 * Data step of the offline-history mining design (docs/RESEARCH_HISTORY_MINING_OFFLINE_HISTORY_DESIGN_2026-11-23.md §4).
 * Fetches PUBLIC Upbit 60-minute candles (no key, no account, no order) for the pre-registered windows and writes frozen CSV files plus a
 * manifest of SHA-256 hashes, row counts, first/last timestamps and missing share. The CSV files belong OUTSIDE the repository; only the
 * manifest is committed. It prints counts and hashes only, never a price.
 *
 * Fail closed (nothing written): HTTP error (429/5xx retried 3 times, other 4xx final), malformed row, duplicate, disorder, a bar outside
 * its window or not yet closed, or a market whose missing hours exceed 10 percent of its listed span inside a window.
 * Hole hours (Upbit omits a candle in an hour without a trade) are stored as absent and never filled.
 * Mapping: a 60m candle starting at s becomes the hourly close row at s + 1 h (interval_ms 60000, as in the host store).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://api.upbit.com";
const HOUR_MS = 3_600_000;
const MAX_MISSING_SHARE = 0.10;
const HEADER = "startMs,open,high,low,close,volume\n";
// Candle start times, [from, to) in UTC. Discovery and hold-back are separate files; the 96 h purge between them is never fetched.
const WINDOWS = Object.freeze({
  discovery: Object.freeze({ from: Date.parse("2021-12-20T00:00:00Z"), to: Date.parse("2023-07-01T00:00:00Z") }),
  holdback: Object.freeze({ from: Date.parse("2023-07-05T00:00:00Z"), to: Date.parse("2024-11-01T00:00:00Z") }),
});
const MARKETS = Object.freeze({
  "KRW-BTC": ["discovery", "holdback"], "KRW-ETH": ["discovery", "holdback"], "KRW-SOL": ["discovery", "holdback"],
  "KRW-NEAR": ["discovery", "holdback"], "KRW-XRP": ["discovery"],
});

class HistoryError extends Error { constructor(code) { super(code); this.name = "HistoryError"; this.code = code; } }

async function getJson(fetchImpl, pathAndQuery, sleep) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(`${BASE}${pathAndQuery}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new HistoryError(`HTTP_${response.status}`);
    await sleep(1000 * 2 ** attempt);
  }
  throw new HistoryError("HTTP_RETRY_EXHAUSTED");
}

const num = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" ? Number(v) : Number.NaN;
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Returns { rows (ascending, text), missingHours, listedHours, firstMs, lastMs } for one market and window. */
async function fetchWindow(market, win, deps) {
  if (win.to > deps.now() - HOUR_MS) throw new HistoryError("WINDOW_NOT_CLOSED");
  const byStart = new Map();
  let cursor = win.to; // exclusive upper bound; Upbit returns candles strictly before `to`, newest first
  for (;;) {
    const data = await getJson(deps.fetchImpl, `/v1/candles/minutes/60?market=${market}&to=${encodeURIComponent(isoZ(cursor))}&count=200`, deps.sleep);
    if (!Array.isArray(data)) throw new HistoryError("CANDLES_INVALID");
    if (data.length === 0) break;
    let last = Infinity;
    for (const r of data) {
      const start = Date.parse(`${r?.candle_date_time_utc}Z`);
      const [o, h, l, c] = [r?.opening_price, r?.high_price, r?.low_price, r?.trade_price].map(num);
      const v = num(r?.candle_acc_trade_volume);
      if (r?.market !== market || !Number.isSafeInteger(start) || start % HOUR_MS !== 0) throw new HistoryError("CANDLE_ROW_MALFORMED");
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || !Number.isFinite(v) || v < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h)) throw new HistoryError("CANDLE_VALUES_INVALID");
      if (start >= last) throw new HistoryError("CANDLE_DISORDER_OR_DUPLICATE");
      if (start >= win.to) throw new HistoryError("CANDLE_NOT_CLOSED_OR_OUTSIDE_WINDOW");
      last = start;
      if (start < win.from) continue;
      if (byStart.has(start)) throw new HistoryError("CANDLE_DISORDER_OR_DUPLICATE");
      byStart.set(start, `${start},${r.opening_price},${r.high_price},${r.low_price},${r.trade_price},${r.candle_acc_trade_volume}`);
    }
    if (last <= win.from) break;
    cursor = last;
    await deps.sleep(150);
  }
  if (byStart.size === 0) throw new HistoryError("WINDOW_EMPTY");
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const listedHours = (win.to - starts[0]) / HOUR_MS; // the listed span starts at the first candle that exists in the window
  const missingHours = listedHours - starts.length;
  if (missingHours / listedHours > MAX_MISSING_SHARE) throw new HistoryError("MISSING_SHARE_TOO_HIGH");
  return { rows: starts.map((s) => byStart.get(s)), missingHours, listedHours, firstMs: starts[0], lastMs: starts[starts.length - 1] };
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Fetches everything in memory first; nothing is written here. */
async function fetchHistory({ fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const deps = { fetchImpl, sleep, now };
  const files = {}; const stats = {};
  for (const [market, windows] of Object.entries(MARKETS)) {
    for (const name of windows) {
      const w = await fetchWindow(market, WINDOWS[name], deps);
      const file = `${market}_${name}_60m.csv`;
      files[file] = HEADER + w.rows.join("\n") + "\n";
      stats[file] = { rows: w.rows.length, firstStartMs: w.firstMs, lastStartMs: w.lastMs, listedHours: w.listedHours, missingHours: w.missingHours, missingShare: Number((w.missingHours / w.listedHours).toFixed(4)) };
    }
  }
  const manifest = {
    schemaVersion: 1, source: "upbit-public-60m", windows: WINDOWS, markets: Object.keys(MARKETS),
    files: Object.fromEntries(Object.keys(files).sort().map((n) => [n, { sha256: sha256(files[n]), ...stats[n] }])),
  };
  return { files, manifest };
}

/** A fresh fetch must reproduce the committed manifest exactly (closed bars are immutable). */
function verify(fresh, committed) {
  const m = fresh?.manifest;
  if (m == null || committed == null || typeof committed !== "object") return { ok: false };
  return { ok: JSON.stringify(m.files) === JSON.stringify(committed.files) && JSON.stringify(m.windows) === JSON.stringify(committed.windows) };
}

function write(outDir, { files, manifest }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Maps one CSV text to host-store rows: close row at start + 1 h, interval_ms 60000, non-null checksum, volume kept (nullable column).
 * Pure; the SQLite writer below only inserts these.
 */
function toStoreRows(market, csvText) {
  return csvText.trim().split("\n").slice(1).map((line) => {
    const [start, open, high, low, close, volume] = line.split(",");
    const closeTimeMs = Number(start) + HOUR_MS;
    return { market, intervalMs: 60_000, closeTimeMs, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume),
      checksum: sha256(`${market}|${closeTimeMs}|${open}|${high}|${low}|${close}`) };
  });
}

/** Builds a local SQLite file (outside the repository) with the research_closed_candles shape. Uses node:sqlite. */
function buildStore(dbPath, files) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS research_closed_candles (market TEXT NOT NULL, interval_ms INTEGER NOT NULL CHECK (interval_ms > 0), close_time_ms INTEGER NOT NULL CHECK (close_time_ms > 0), open REAL NOT NULL CHECK (open > 0), high REAL NOT NULL CHECK (high > 0), low REAL NOT NULL CHECK (low > 0), close REAL NOT NULL CHECK (close > 0), checksum TEXT NOT NULL, volume REAL CHECK (volume IS NULL OR volume >= 0), PRIMARY KEY (market, interval_ms, close_time_ms))");
  const insert = db.prepare("INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, open, high, low, close, checksum, volume) VALUES (?,?,?,?,?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    for (const [name, text] of Object.entries(files)) {
      const market = name.split("_")[0];
      for (const r of toStoreRows(market, text)) insert.run(r.market, r.intervalMs, r.closeTimeMs, r.open, r.high, r.low, r.close, r.checksum, r.volume);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; } finally { db.close(); }
}

module.exports = { fetchHistory, verify, write, toStoreRows, buildStore, HistoryError, WINDOWS, MARKETS, HOUR_MS };

if (require.main === module) {
  (async () => {
    try {
      const outDir = process.argv[2];
      if (!outDir || path.resolve(outDir).startsWith(path.resolve(__dirname, ".."))) throw new HistoryError("OUT_DIR_MUST_BE_OUTSIDE_THE_REPOSITORY");
      const result = await fetchHistory();
      write(outDir, result);
      for (const [name, f] of Object.entries(result.manifest.files)) console.log(`HISTORY_FILE ${name} rows=${f.rows} missingShare=${f.missingShare} sha256=${f.sha256}`);
      console.log(`HISTORY_MANIFEST_SHA256 ${sha256(JSON.stringify(result.manifest.files))}`);
    } catch (error) {
      console.error("HISTORY_FETCH_FAILED_CLOSED", error instanceof HistoryError ? error.code : "ERROR");
      process.exitCode = 1;
    }
  })();
}
