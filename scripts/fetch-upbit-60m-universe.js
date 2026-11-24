"use strict";
/**
 * Broad-universe step 3 tooling (docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md section 5 item 2; looser bar
 * docs/RESEARCH_BROAD_UNIVERSE_LOOSER_FILTER_PREREG_2026-11-24.md). Fetches PUBLIC Upbit 60m candles for a GROUP of markets from the committed
 * 20 bp discovery pool, for the pre-registered windows, into CSV files outside the repository plus a per-group manifest of SHA-256 hashes.
 * Not run by this PR: the real fetch is a later reviewed step on a GitHub-hosted runner (never the PAPER host before 2026-12-10).
 *
 * Differences from scripts/fetch-upbit-60m-history.js (which is untouched): a market list input; a market that fails a data-quality check is EXCLUDED
 * with a recorded reason instead of aborting the group; a market listed inside the window is allowed (the miner applies the 30 day listing wait);
 * the quote traded value (candle_acc_trade_price) is stored as a 7th column; the Remaining-Req header is honoured; three consecutive HTTP 429 stop the
 * group (RATE_LIMITED_STOP, repeat it later); a free-disk precheck; files are written only if the group completes.
 * No API key, no account, no order. Fail closed: HTTP 4xx other than 429 (451 included), malformed rows, duplicates, disorder abort the group.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const base = require("./fetch-upbit-60m-history.js");

const { HistoryError, HOUR_MS, assertOutsideRepository } = base;
const BASE = "https://api.upbit.com";
const MAX_MISSING_SHARE = 0.10;
const MAX_CONSECUTIVE_429 = 3;
const HEADER = "startMs,open,high,low,close,volume,quoteValue\n";
const WINDOWS = Object.freeze({
  discovery: Object.freeze({ from: Date.parse("2021-12-20T00:00:00Z"), to: Date.parse("2023-07-02T00:00:00Z") }),
  holdback: Object.freeze({ from: Date.parse("2023-07-05T00:00:00Z"), to: Date.parse("2024-11-02T00:00:00Z") }),
});
// Markets of the other pre-registered studies never take part in the hold-back (design section 4); XRP is discovery only.
const NO_HOLDBACK = Object.freeze(["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-NEAR", "KRW-XRP"]);
const EXCLUDABLE = Object.freeze(["WINDOW_EMPTY", "MISSING_SHARE_TOO_HIGH", "WINDOW_TOO_SHORT"]);
const MIN_WINDOW_HOURS = 24 * 30 + 24 * 7;
const MARKET_RE = /^KRW-[A-Z0-9]{1,15}$/;

const num = (v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" ? Number(v) : Number.NaN;
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Windows a market takes part in: discovery for all, hold-back for the markets outside NO_HOLDBACK. */
function windowsFor(market) { return NO_HOLDBACK.includes(market) ? ["discovery"] : ["discovery", "holdback"]; }

function makeGetJson(deps) {
  let consecutive429 = 0;
  return async function getJson(pathAndQuery) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response;
      try { response = await deps.fetchImpl(`${BASE}${pathAndQuery}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); } catch { response = null; }
      if (response?.status === 429) {
        consecutive429 += 1;
        if (consecutive429 >= MAX_CONSECUTIVE_429) throw new HistoryError("RATE_LIMITED_STOP");
        await deps.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response?.ok) {
        consecutive429 = 0;
        const remaining = String(response.headers?.get?.("remaining-req") ?? "");
        if (/(^|;\s*)sec=0(\s*;|$)/.test(remaining)) await deps.sleep(1000);
        try { return await response.json(); } catch { response = null; }
      }
      if (response != null && !response.ok && response.status < 500) throw new HistoryError(`HTTP_${response.status}`);
      await deps.sleep(1000 * 2 ** attempt);
    }
    throw new HistoryError("HTTP_RETRY_EXHAUSTED");
  };
}

/** One market and window: { rows (ascending text), listedHours, missingHours, firstMs, lastMs }. */
async function fetchWindow(market, win, getJson, deps) {
  if (win.to > deps.now() - HOUR_MS) throw new HistoryError("WINDOW_NOT_CLOSED");
  const byStart = new Map();
  let cursor = win.to;
  for (;;) {
    const data = await getJson(`/v1/candles/minutes/60?market=${market}&to=${encodeURIComponent(isoZ(cursor))}&count=200`);
    if (!Array.isArray(data)) throw new HistoryError("CANDLES_INVALID");
    if (data.length === 0) break;
    let last = cursor;
    for (const r of data) {
      const start = Date.parse(`${r?.candle_date_time_utc}Z`);
      const [o, h, l, c] = [r?.opening_price, r?.high_price, r?.low_price, r?.trade_price].map(num);
      const v = num(r?.candle_acc_trade_volume); const q = num(r?.candle_acc_trade_price);
      if (r?.market !== market || !Number.isSafeInteger(start) || start % HOUR_MS !== 0) throw new HistoryError("CANDLE_ROW_MALFORMED");
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0) || !Number.isFinite(v) || v < 0 || !Number.isFinite(q) || q < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h)) throw new HistoryError("CANDLE_VALUES_INVALID");
      if (start >= last) throw new HistoryError("CANDLE_DISORDER_OR_DUPLICATE");
      if (start >= win.to) throw new HistoryError("CANDLE_NOT_CLOSED_OR_OUTSIDE_WINDOW");
      last = start;
      if (start < win.from) continue;
      if (byStart.has(start)) throw new HistoryError("CANDLE_DISORDER_OR_DUPLICATE");
      byStart.set(start, `${start},${r.opening_price},${r.high_price},${r.low_price},${r.trade_price},${r.candle_acc_trade_volume},${r.candle_acc_trade_price}`);
    }
    if (last <= win.from) break;
    cursor = last;
    await deps.sleep(150);
  }
  if (byStart.size === 0) throw new HistoryError("WINDOW_EMPTY");
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const listedHours = (win.to - starts[0]) / HOUR_MS;
  if (listedHours < MIN_WINDOW_HOURS) throw new HistoryError("WINDOW_TOO_SHORT");
  const missingHours = listedHours - starts.length;
  if (missingHours / listedHours > MAX_MISSING_SHARE) throw new HistoryError("MISSING_SHARE_TOO_HIGH");
  return { rows: starts.map((s) => byStart.get(s)), listedHours, missingHours, firstMs: starts[0], lastMs: starts[starts.length - 1] };
}

/** Fetches one group in memory. Nothing is written here. `markets` is a list of KRW-XXX codes. */
async function fetchGroup({ group, markets, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  if (typeof group !== "string" || !/^[a-z0-9-]{1,40}$/.test(group)) throw new HistoryError("GROUP_NAME_INVALID");
  if (!Array.isArray(markets) || markets.length === 0 || markets.length > 60 || new Set(markets).size !== markets.length || !markets.every((m) => MARKET_RE.test(m))) throw new HistoryError("MARKET_LIST_INVALID");
  const deps = { fetchImpl, sleep, now }; const getJson = makeGetJson(deps);
  const files = {}; const stats = {}; const excluded = [];
  for (const market of markets) {
    for (const name of windowsFor(market)) {
      try {
        const w = await fetchWindow(market, WINDOWS[name], getJson, deps);
        const file = `${market}_${name}_60m.csv`;
        files[file] = HEADER + w.rows.join("\n") + "\n";
        stats[file] = { rows: w.rows.length, firstStartMs: w.firstMs, lastStartMs: w.lastMs, listedHours: w.listedHours, missingHours: w.missingHours, missingShare: Number((w.missingHours / w.listedHours).toFixed(4)) };
      } catch (error) {
        if (error instanceof HistoryError && EXCLUDABLE.includes(error.code)) excluded.push({ market, window: name, reason: error.code });
        else throw error;
      }
    }
  }
  const manifest = {
    schemaVersion: 1, source: "upbit-public-60m-universe", group, windows: WINDOWS, markets, excluded,
    files: Object.fromEntries(Object.keys(files).sort().map((n) => [n, { sha256: sha256(files[n]), ...stats[n] }])),
  };
  return { files, manifest };
}

/** A reproduction fetch must equal the first one (closed bars are immutable). */
function verify(fresh, committed) {
  const m = fresh?.manifest;
  if (m == null || committed == null || typeof committed !== "object") return { ok: false };
  return { ok: JSON.stringify(m.files) === JSON.stringify(committed.files) && JSON.stringify(m.excluded) === JSON.stringify(committed.excluded) && m.group === committed.group };
}

function assertDiskHeadroom(dir, bytesNeeded) {
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const s = fs.statfsSync(probe);
  if (s.bavail * s.bsize < bytesNeeded * 2) throw new HistoryError("DISK_HEADROOM_TOO_LOW");
}

function write(outDir, { files, manifest }) {
  assertOutsideRepository(outDir);
  assertDiskHeadroom(outDir, Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0));
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) throw new HistoryError("OUT_DIR_NOT_EMPTY");
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
  fs.writeFileSync(path.join(outDir, `manifest.${manifest.group}.json`), JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = { fetchGroup, verify, write, assertDiskHeadroom, windowsFor, HistoryError, WINDOWS, NO_HOLDBACK, HEADER };

if (require.main === module) {
  (async () => {
    try {
      const [outDir, group, ...markets] = process.argv.slice(2);
      if (!outDir) throw new HistoryError("OUT_DIR_REQUIRED");
      assertOutsideRepository(outDir);
      const result = await fetchGroup({ group, markets });
      write(outDir, result);
      for (const [name, f] of Object.entries(result.manifest.files)) console.log(`UNIVERSE_FILE ${name} rows=${f.rows} missingShare=${f.missingShare} sha256=${f.sha256}`);
      for (const e of result.manifest.excluded) console.log(`UNIVERSE_EXCLUDED ${e.market} ${e.window} ${e.reason}`);
      console.log(`UNIVERSE_MANIFEST_SHA256 ${sha256(JSON.stringify(result.manifest.files))}`);
    } catch (error) {
      console.error("UNIVERSE_FETCH_FAILED_CLOSED", error instanceof HistoryError ? error.code : "ERROR");
      process.exitCode = 1;
    }
  })();
}
