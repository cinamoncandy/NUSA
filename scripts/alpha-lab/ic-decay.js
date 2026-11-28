#!/usr/bin/env node
"use strict";

// Offline, descriptive Alpha Lab measurement. Its only network operation is a
// public Upbit daily-candle GET bounded at 2026-11-04 UTC. It never reads
// order-book data and never registers, selects, or trades a signal.
//
// Usage:
//   node scripts/alpha-lab/ic-decay.js --self-test
//   node scripts/alpha-lab/ic-decay.js --fingerprint
//   node scripts/alpha-lab/ic-decay.js --measure --expect-script-sha256=SHA --expect-spec-sha256=SHA

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_DATE = "2026-11-28";
const HISTORY_CUTOFF_DATE = "2026-11-04";
const HISTORY_CUTOFF_MS = Date.parse(HISTORY_CUTOFF_DATE + "T00:00:00.000Z");
const HISTORY_CUTOFF_EXCLUSIVE = Date.parse("2026-11-05T00:00:00.000Z");
const HISTORY_START_DATE = "2017-01-01";
const HISTORY_START_MS = Date.parse(HISTORY_START_DATE + "T00:00:00.000Z");
const UPBIT_DAILY_CANDLES = "https://api.upbit.com/v1/candles/days";
const MARKET_SNAPSHOT_PATH = "docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json";
const MARKET_SNAPSHOT_SHA256 = "8c145fed3cd2e0d88919418ff7c2c3af0fd1a62e02efa6c1a9c3872211ea330d";
const MIN_PAIRS_PER_DAY = 20;
const BOOTSTRAP = Object.freeze({ method: "circular-moving-block", blockLengthDays: 20, replicates: 5000, confidenceLevel: 0.95, seed: 20261128 });
const HORIZONS_DAYS = Object.freeze([1, 5, 10, 20]);

// Frozen from the 2026-11-24 20 bp discovery pool. This is a measurement cohort,
// not a forward-trading allowlist. The source hash and exact membership are checked.
const MARKETS = Object.freeze([
  "KRW-1INCH", "KRW-A", "KRW-AAVE", "KRW-ADA", "KRW-AHT", "KRW-APT", "KRW-ARB", "KRW-ARK", "KRW-ATOM", "KRW-AVAX",
  "KRW-AWE", "KRW-AXS", "KRW-BCH", "KRW-BSV", "KRW-BTC", "KRW-CBK", "KRW-CELO", "KRW-DKA", "KRW-DOT", "KRW-EGLD",
  "KRW-ETC", "KRW-ETH", "KRW-FCT2", "KRW-GAME2", "KRW-GAS", "KRW-GMT", "KRW-HIVE", "KRW-HUNT", "KRW-IQ", "KRW-KAVA",
  "KRW-KNC", "KRW-LINK", "KRW-LSK", "KRW-MANA", "KRW-MASK", "KRW-MTL", "KRW-MVL", "KRW-NEAR", "KRW-NEO", "KRW-ORBS",
  "KRW-POL", "KRW-PUNDIX", "KRW-QTUM", "KRW-SAND", "KRW-SC", "KRW-SHIB", "KRW-SOL", "KRW-STRAX", "KRW-STX", "KRW-TFUEL",
  "KRW-THETA", "KRW-TOKAMAK", "KRW-WAVES", "KRW-XEC", "KRW-XRP", "KRW-XTZ",
]);

// Each formula and public research source is frozen here before measurement.
// Values are available at close of day t; outcomes are close(t+h)/close(t)-1.
const SIGNALS = Object.freeze([
  Object.freeze({
    id: "momentum_28d",
    source: "docs/RESEARCH_THREE_DIRECTIONS_2026-11-25.md §2.2 (owner-confirmed 28-day cross-sectional trend)",
    formula: "close(t) / close(t-28 UTC days) - 1",
  }),
  Object.freeze({
    id: "short_term_reversal_1d",
    source: "docs/RESEARCH_STRATEGY_COLLECTION_2026-11-25.md §2 row 1 (cross-sectional short-term reversal)",
    formula: "-(close(t) / close(t-1 UTC day) - 1)",
  }),
  Object.freeze({
    id: "low_volatility_20d",
    source: "docs/RESEARCH_STRATEGY_COLLECTION_2026-11-25.md §2 row 3 and docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md §2 (low-volatility hypothesis family)",
    formula: "negative sample standard deviation of the 20 daily log returns ending at t",
  }),
]);

const ROOT_DIR = path.resolve(__dirname, "../..");
const RESULT_JSON_REL = "docs/research-data/alpha-lab-ic-decay-" + RUN_DATE + ".json";
const RESULT_NOTE_REL = "docs/ALPHA_LAB_IC_DECAY_RESULT_" + RUN_DATE + ".md";
const LOCK_REL = RESULT_JSON_REL + ".lock";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function readScriptSha256() {
  return sha256(fs.readFileSync(__filename));
}

function assertFrozenUniverse() {
  const snapshotPath = path.join(ROOT_DIR, MARKET_SNAPSHOT_PATH);
  const raw = fs.readFileSync(snapshotPath);
  const digest = sha256(raw);
  if (digest !== MARKET_SNAPSHOT_SHA256) throw new Error("UNIVERSE_SOURCE_SHA256_MISMATCH:" + digest);
  const snapshot = JSON.parse(raw.toString("utf8"));
  const sourceMarkets = snapshot.discoveryPool;
  if (!Array.isArray(sourceMarkets)) throw new Error("UNIVERSE_SOURCE_POOL_MISSING");
  const expected = MARKETS.slice().sort();
  const actual = sourceMarkets.slice().sort();
  if (expected.length !== 56 || actual.length !== 56 || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("UNIVERSE_MEMBERSHIP_MISMATCH");
  }
  return digest;
}

function measurementSpec(universeSha256) {
  return {
    schemaVersion: 1,
    purpose: "descriptive historical rank-IC decay measurement only; no signal registration, winner selection, or trading",
    source: { name: "Upbit public daily candles", endpoint: UPBIT_DAILY_CANDLES, marketSnapshotPath: MARKET_SNAPSHOT_PATH, marketSnapshotSha256: universeSha256 },
    universe: { snapshotDate: "2026-11-24", filter: "existing 20 bp discoveryPool", count: MARKETS.length, markets: MARKETS },
    history: { startAtOrAfterUtcDate: HISTORY_START_DATE, lastCandleUtcDateInclusive: HISTORY_CUTOFF_DATE, forbiddenDatesUtcInclusive: ["2026-11-05", "2026-12-05"], orderBookValues: "not requested or read" },
    signalAvailability: "signal uses closes through day t; the daily candle dated t is complete at 00:00 UTC on t+1",
    signals: SIGNALS,
    horizonsDays: HORIZONS_DAYS,
    dailyCrossSection: {
      minimumPairs: MIN_PAIRS_PER_DAY,
      minimumPairsSource: "docs/RESEARCH_THREE_DIRECTIONS_2026-11-25.md §2.1 (minimum 20 usable markets in a 30-market forward universe)",
      method: "Spearman rank correlation; average daily IC over valid dates",
    },
    interval: { method: BOOTSTRAP.method, blockLengthDays: BOOTSTRAP.blockLengthDays, replicates: BOOTSTRAP.replicates, confidenceLevel: BOOTSTRAP.confidenceLevel, seed: BOOTSTRAP.seed, interval: "two-sided percentile interval over the mean daily IC" },
    runDateUtc: RUN_DATE,
  };
}

function fingerprint() {
  const universeSha256 = assertFrozenUniverse();
  const spec = measurementSpec(universeSha256);
  return { spec, specSha256: sha256(stableStringify(spec)), scriptSha256: readScriptSha256() };
}

function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const u1 = Math.max(Number.MIN_VALUE, random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random());
}

function averageRanks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start + 1;
    while (end < order.length && order[end].value === order[start].value) end += 1;
    const average = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[order[index].index] = average;
    start = end;
  }
  return ranks;
}

function spearmanRankIc(signalValues, returnValues) {
  if (signalValues.length !== returnValues.length || signalValues.length < 3) return null;
  if (![...signalValues, ...returnValues].every(Number.isFinite)) return null;
  const x = averageRanks(signalValues);
  const y = averageRanks(returnValues);
  const xMean = x.reduce((sum, item) => sum + item, 0) / x.length;
  const yMean = y.reduce((sum, item) => sum + item, 0) / y.length;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index] - xMean;
    const dy = y[index] - yMean;
    xy += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  if (xx === 0 || yy === 0) return null;
  return xy / Math.sqrt(xx * yy);
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const fraction = index - lower;
  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

function blockBootstrapMeanInterval(rows, config) {
  const values = rows.map((row) => row.ic);
  const validCount = values.filter(Number.isFinite).length;
  if (values.length === 0 || validCount === 0) throw new Error("BOOTSTRAP_REQUIRES_FINITE_DAILY_SERIES");
  const random = mulberry32(config.seed);
  const samples = [];
  const blockLength = Math.min(config.blockLengthDays, rows.length);
  let attempts = 0;
  while (samples.length < config.replicates) {
    attempts += 1;
    if (attempts > config.replicates * 10) throw new Error("BOOTSTRAP_TOO_MANY_EMPTY_RESAMPLES");
    let sum = 0;
    let sampled = 0;
    let sampledValid = 0;
    while (sampled < rows.length) {
      const start = Math.floor(random() * rows.length);
      for (let offset = 0; offset < blockLength && sampled < rows.length; offset += 1, sampled += 1) {
        const value = values[(start + offset) % rows.length];
        if (Number.isFinite(value)) { sum += value; sampledValid += 1; }
      }
    }
    if (sampledValid > 0) samples.push(sum / sampledValid);
  }
  samples.sort((a, b) => a - b);
  const alpha = (1 - config.confidenceLevel) / 2;
  return { lower: quantile(samples, alpha), upper: quantile(samples, 1 - alpha) };
}

function trailingSampleStd(values) {
  if (values.length < 2) return null;
  const center = mean(values);
  const sumSquares = values.reduce((sum, value) => sum + (value - center) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

function makeSignalValue(seriesByDate, signalId, dayMs) {
  const current = seriesByDate.get(dayMs);
  if (!Number.isFinite(current) || current <= 0) return null;
  if (signalId === "momentum_28d") {
    const prior = seriesByDate.get(dayMs - 28 * DAY_MS);
    return Number.isFinite(prior) && prior > 0 ? current / prior - 1 : null;
  }
  if (signalId === "short_term_reversal_1d") {
    const prior = seriesByDate.get(dayMs - DAY_MS);
    return Number.isFinite(prior) && prior > 0 ? -(current / prior - 1) : null;
  }
  if (signalId === "low_volatility_20d") {
    const returns = [];
    for (let offset = 0; offset < 20; offset += 1) {
      const end = dayMs - offset * DAY_MS;
      const close = seriesByDate.get(end);
      const previous = seriesByDate.get(end - DAY_MS);
      if (!(Number.isFinite(close) && close > 0 && Number.isFinite(previous) && previous > 0)) return null;
      returns.push(Math.log(close / previous));
    }
    const volatility = trailingSampleStd(returns);
    return Number.isFinite(volatility) ? -volatility : null;
  }
  throw new Error("UNKNOWN_SIGNAL:" + signalId);
}

function buildDailyIcRows(allSeries, signalId, horizonDays) {
  const dateSet = new Set();
  for (const series of allSeries.values()) for (const row of series) dateSet.add(row.dayMs);
  const dates = [...dateSet].sort((a, b) => a - b).filter((day) => day <= HISTORY_CUTOFF_MS - horizonDays * DAY_MS);
  if (dates.length === 0) return [];
  const indexed = new Map();
  for (const [market, rows] of allSeries) indexed.set(market, new Map(rows.map((row) => [row.dayMs, row.close])));
  const calendarRows = [];
  for (let dayMs = dates[0]; dayMs <= dates[dates.length - 1]; dayMs += DAY_MS) {
    const signalValues = [];
    const forwardReturns = [];
    for (const byDate of indexed.values()) {
      const signal = makeSignalValue(byDate, signalId, dayMs);
      const current = byDate.get(dayMs);
      const future = byDate.get(dayMs + horizonDays * DAY_MS);
      if (Number.isFinite(signal) && Number.isFinite(current) && current > 0 && Number.isFinite(future) && future > 0) {
        signalValues.push(signal);
        forwardReturns.push(future / current - 1);
      }
    }
    const ic = signalValues.length >= MIN_PAIRS_PER_DAY ? spearmanRankIc(signalValues, forwardReturns) : null;
    calendarRows.push({
      date: new Date(dayMs).toISOString().slice(0, 10),
      pairs: signalValues.length,
      ic: Number.isFinite(ic) ? ic : null,
    });
  }
  const firstValid = calendarRows.findIndex((row) => Number.isFinite(row.ic));
  let lastValid = -1;
  for (let index = calendarRows.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(calendarRows[index].ic)) { lastValid = index; break; }
  }
  return firstValid >= 0 && lastValid >= firstValid ? calendarRows.slice(firstValid, lastValid + 1) : [];
}

function round(value, digits) {
  return Number(value.toFixed(digits === undefined ? 8 : digits));
}

function summarize(rows) {
  const meanIc = mean(rows.map((row) => row.ic));
  const interval = blockBootstrapMeanInterval(rows, BOOTSTRAP);
  const validRows = rows.filter((row) => Number.isFinite(row.ic));
  const pairCounts = validRows.map((row) => row.pairs);
  return {
    validDays: validRows.length,
    firstDate: validRows[0] ? validRows[0].date : null,
    lastDate: validRows[validRows.length - 1] ? validRows[validRows.length - 1].date : null,
    meanDailyRankIc: round(meanIc),
    blockBootstrap95PercentileInterval: { lower: round(interval.lower), upper: round(interval.upper) },
    intervalExcludesZero: interval.lower > 0 || interval.upper < 0,
    meanMarketsPerDay: round(mean(pairCounts), 4),
    minMarketsPerDay: Math.min(...pairCounts),
    maxMarketsPerDay: Math.max(...pairCounts),
    daily: rows.map((row) => ({ date: row.date, pairs: row.pairs, rankIc: Number.isFinite(row.ic) ? round(row.ic) : null })),
  };
}

function utcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) throw new Error("UPBIT_CANDLE_TIMESTAMP_INVALID");
  const parsed = Date.parse(value + "Z");
  if (!Number.isFinite(parsed) || parsed % DAY_MS !== 0) throw new Error("UPBIT_CANDLE_UTC_DAY_INVALID");
  return parsed;
}

function normalizeCandle(row) {
  const dayMs = utcDay(row.candle_date_time_utc);
  if (dayMs >= HISTORY_CUTOFF_EXCLUSIVE) throw new Error("CUTOFF_VIOLATION:" + new Date(dayMs).toISOString().slice(0, 10));
  const candle = [
    dayMs,
    Number(row.opening_price),
    Number(row.high_price),
    Number(row.low_price),
    Number(row.trade_price),
    Number(row.candle_acc_trade_volume),
    Number(row.candle_acc_trade_price),
  ];
  if (!candle.slice(1).every(Number.isFinite) || candle.slice(1, 5).some((value) => value <= 0) || candle[5] < 0 || candle[6] < 0) {
    throw new Error("UPBIT_CANDLE_VALUE_INVALID");
  }
  return candle;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestStartedAt = 0;
async function paceRequest() {
  const wait = Math.max(0, 150 - (Date.now() - lastRequestStartedAt));
  if (wait > 0) await sleep(wait);
  lastRequestStartedAt = Date.now();
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await paceRequest();
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "NUSA-Alpha-Lab-IC-Decay/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return await response.json();
      if (response.status !== 429 && response.status < 500) throw new Error("UPBIT_HTTP_" + response.status);
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt));
      lastError = new Error("UPBIT_HTTP_" + response.status);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.startsWith("UPBIT_HTTP_") && !/^UPBIT_HTTP_(429|5\d\d)$/.test(error.message)) throw error;
      if (attempt < 3) await sleep(500 * (2 ** attempt));
    }
  }
  throw new Error("UPBIT_FETCH_FAILED:" + (lastError instanceof Error ? lastError.message : String(lastError)));
}

function upbitTo(dayMs) {
  return new Date(dayMs).toISOString().slice(0, 19);
}

async function fetchMarket(market) {
  const fetchStartedAt = new Date().toISOString();
  const rows = new Map();
  let toMs = HISTORY_CUTOFF_EXCLUSIVE;
  let pages = 0;
  let reachedStart = false;
  while (pages < 100) {
    const query = new URLSearchParams({ market, count: "200", to: upbitTo(toMs) });
    const batch = await fetchJson(UPBIT_DAILY_CANDLES + "?" + query.toString());
    pages += 1;
    if (!Array.isArray(batch)) throw new Error("UPBIT_RESPONSE_NOT_ARRAY:" + market);
    if (batch.length === 0) { reachedStart = true; break; }
    let oldestMs = Infinity;
    for (const item of batch) {
      const candle = normalizeCandle(item);
      if (item.market !== market) throw new Error("UPBIT_MARKET_MISMATCH:" + market);
      oldestMs = Math.min(oldestMs, candle[0]);
      if (candle[0] >= HISTORY_START_MS) {
        const previous = rows.get(candle[0]);
        if (previous && stableStringify(previous) !== stableStringify(candle)) throw new Error("UPBIT_DUPLICATE_CANDLE_CONFLICT:" + market);
        rows.set(candle[0], candle);
      }
    }
    if (oldestMs >= toMs) throw new Error("UPBIT_PAGINATION_NOT_PROGRESSING:" + market);
    if (batch.length < 200 || oldestMs <= HISTORY_START_MS) { reachedStart = true; break; }
    toMs = oldestMs;
  }
  if (!reachedStart) throw new Error("UPBIT_PAGE_LIMIT:" + market);
  if (rows.size === 0) throw new Error("UPBIT_NO_HISTORY:" + market);
  const candles = [...rows.values()].sort((a, b) => a[0] - b[0]);
  const fetchFinishedAt = new Date().toISOString();
  return {
    market,
    candles: candles.map((row) => ({ dayMs: row[0], close: row[4] })),
    manifest: {
      market,
      source: UPBIT_DAILY_CANDLES,
      requestParameters: { interval: "day", pageSize: 200, fromUtcDateInclusive: HISTORY_START_DATE, throughUtcDateInclusive: HISTORY_CUTOFF_DATE },
      fetchStartedAt,
      fetchFinishedAt,
      pages,
      candleCount: candles.length,
      firstCandleUtcDate: new Date(candles[0][0]).toISOString().slice(0, 10),
      lastCandleUtcDate: new Date(candles[candles.length - 1][0]).toISOString().slice(0, 10),
      normalizedOhlcvSha256: sha256(stableStringify(candles)),
    },
  };
}

async function fetchUniverse() {
  const result = new Map();
  const manifest = [];
  const fetchStartedAt = new Date().toISOString();
  for (let index = 0; index < MARKETS.length; index += 1) {
    const fetched = await fetchMarket(MARKETS[index]);
    result.set(fetched.market, fetched.candles);
    manifest.push(fetched.manifest);
    process.stdout.write("fetched " + (index + 1) + "/" + MARKETS.length + " " + fetched.market + " (" + fetched.manifest.candleCount + " daily candles)\n");
  }
  return { result, manifest, fetchStartedAt, fetchFinishedAt: new Date().toISOString() };
}

function renderNote(result, artifactSha256) {
  const tableRows = result.signals.map((signal) => {
    const cells = result.horizonsDays.map((horizon) => {
      const stat = result.results[signal.id][String(horizon)];
      const interval = stat.blockBootstrap95PercentileInterval;
      return stat.meanDailyRankIc.toFixed(4) + " [" + interval.lower.toFixed(4) + ", " + interval.upper.toFixed(4) + "]";
    });
    return "| " + signal.id + " | " + cells.join(" | ") + " |";
  });
  const validDates = Object.values(result.results)
    .flatMap((byHorizon) => Object.values(byHorizon).flatMap((summary) => [summary.firstDate, summary.lastDate]))
    .filter(Boolean)
    .sort();
  const dateRange = validDates.length ? validDates[0] + " through " + validDates[validDates.length - 1] : "none";
  return [
    "# Alpha Lab IC-decay measurement — " + RUN_DATE,
    "",
    "Status: **descriptive measurement only**. No signal was registered, selected as a winner, or traded. This does not qualify a candidate or authorize PAPER/production behavior.",
    "",
    "- History cutoff: daily candles dated through **" + HISTORY_CUTOFF_DATE + " UTC**, inclusive. Dates 2026-11-05..2026-12-05 and all order-book values were excluded by the request boundary and row validation.",
    "- Source: public Upbit daily candles; request started " + result.dataManifest.fetchStartedAt + " and finished " + result.dataManifest.fetchFinishedAt + ".",
    "- Universe: " + MARKETS.length + " markets from " + MARKET_SNAPSHOT_PATH + " (SHA-256 " + result.universeSnapshotSha256 + "); fixed membership from the existing 2026-11-24 discovery pool.",
    "- Script SHA-256: " + result.scriptSha256 + "; frozen-spec SHA-256: " + result.specSha256 + "; result-payload SHA-256: " + result.integrity.payloadSha256 + "; manifest SHA-256: " + result.integrity.manifestSha256 + "; JSON file SHA-256: " + artifactSha256 + ".",
    "- Valid date range across reported rows: " + dateRange + ".",
    "",
    "Each cell is mean daily cross-sectional Spearman rank IC with a two-sided 95% circular moving-block bootstrap percentile interval (20 calendar-day blocks, 5,000 replicates, seed 20261128). Forward return is close(t+h)/close(t)-1; signal values use only closes through day t. Dates with fewer than 20 usable markets are omitted, following the existing 20-market minimum in the weekly-trend design. The daily series, pair counts, and per-market OHLCV SHA-256 manifest are in the adjacent JSON artifact.",
    "",
    "The work order points to section 7 of the V3 design, but the current cited file ends at section 6. The candidate families and sources here are therefore taken from its existing sections and the existing research-family collection; no hold decision is inferred.",
    "",
    "| Signal | 1 day | 5 days | 10 days | 20 days |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...tableRows,
    "",
    "Limitations: this is historical descriptive research on an already-read history, not a blind test. The current filtered universe can introduce survivorship and membership bias; no fees, costs, portfolio returns, or execution are evaluated. The intervals do not correct for looking across multiple signals and horizons. No hold period or strategy is recommended from these numbers.",
    "",
  ].join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error("SELF_TEST_FAILED:" + message);
}

function makeSyntheticIcRows(options) {
  const random = mulberry32(options.seed);
  const rho = options.targetSpearman === null ? 0 : 2 * Math.sin(Math.PI * options.targetSpearman / 6);
  const rows = [];
  for (let day = 0; day < options.days; day += 1) {
    const target = Array.from({ length: MARKETS.length }, () => normal(random));
    const signal = target.map((value) => rho * value + Math.sqrt(1 - rho * rho) * normal(random));
    const date = new Date(Date.UTC(2020, 0, 1) + day * DAY_MS).toISOString().slice(0, 10);
    rows.push({ date, horizonDays: options.horizonDays, pairs: MARKETS.length, ic: spearmanRankIc(signal, target) });
  }
  return rows;
}

function runSelfTest() {
  const universeSha256 = assertFrozenUniverse();
  assert(MARKETS.length === 56, "fixed 56-market universe");
  assert(SIGNALS.length <= 10 && SIGNALS.every((signal) => signal.source && signal.formula), "bounded sourced signal list");
  assert(JSON.stringify(HORIZONS_DAYS) === JSON.stringify([1, 5, 10, 20]), "frozen horizons");
  assert(Math.abs(spearmanRankIc([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12, "Spearman positive perfect rank");
  assert(Math.abs(spearmanRankIc([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-12, "Spearman negative perfect rank");
  const targetRows = makeSyntheticIcRows({ days: 800, seed: 20261128, horizonDays: 5, targetSpearman: 0.05 });
  const targetInterval = blockBootstrapMeanInterval(targetRows, BOOTSTRAP);
  const targetMean = mean(targetRows.map((row) => row.ic));
  assert(targetRows.every((row) => row.horizonDays === 5), "synthetic target is horizon 5");
  assert(targetInterval.lower <= 0.05 && targetInterval.upper >= 0.05, "synthetic horizon-5 IC 0.05 is inside the interval");
  const randomRows = makeSyntheticIcRows({ days: 800, seed: 20261129, horizonDays: 5, targetSpearman: null });
  const randomInterval = blockBootstrapMeanInterval(randomRows, BOOTSTRAP);
  assert(randomInterval.lower <= 0 && randomInterval.upper >= 0, "random signal interval includes zero");
  const inCutoff = normalizeCandle({
    candle_date_time_utc: "2026-11-04T00:00:00",
    opening_price: 1, high_price: 1, low_price: 1, trade_price: 1,
    candle_acc_trade_volume: 0, candle_acc_trade_price: 0,
  });
  assert(inCutoff[0] === HISTORY_CUTOFF_MS, "inclusive final history day");
  let rejectedFuture = false;
  try {
    normalizeCandle({
      candle_date_time_utc: "2026-11-05T00:00:00",
      opening_price: 1, high_price: 1, low_price: 1, trade_price: 1,
      candle_acc_trade_volume: 0, candle_acc_trade_price: 0,
    });
  } catch (error) {
    rejectedFuture = error instanceof Error && error.message.startsWith("CUTOFF_VIOLATION:");
  }
  assert(rejectedFuture, "first forbidden history date is rejected");
  const syntheticSeries = new Map();
  const firstDay = Date.UTC(2026, 0, 1);
  for (let marketIndex = 0; marketIndex < MARKETS.length; marketIndex += 1) {
    const rows = [];
    for (let offset = 0; offset <= 45; offset += 1) {
      const dayMs = firstDay + offset * DAY_MS;
      const close = 100 + marketIndex * 0.2 + offset * (marketIndex + 1) * 0.01 + Math.sin(offset + marketIndex) * 0.001;
      rows.push({ dayMs, close });
    }
    syntheticSeries.set(MARKETS[marketIndex], rows);
  }
  const syntheticDecay = buildDailyIcRows(syntheticSeries, "momentum_28d", 5);
  assert(syntheticDecay.length === 13 && syntheticDecay.every((row) => row.pairs === 56), "daily IC uses exact signal lookback and forward horizon");
  const series = new Map([[Date.UTC(2020, 0, 1), 100], [Date.UTC(2020, 0, 2), 101], [Date.UTC(2020, 0, 3), 102]]);
  assert(makeSignalValue(series, "short_term_reversal_1d", Date.UTC(2020, 0, 2)) < 0, "reversal sign for an up day");
  assert(universeSha256 === MARKET_SNAPSHOT_SHA256, "universe source pin");
  process.stdout.write(
    "IC_DECAY_SELF_TEST PASS; synthetic_h5_mean=" + targetMean.toFixed(5) +
    " interval=[" + targetInterval.lower.toFixed(5) + "," + targetInterval.upper.toFixed(5) +
    "]; random_interval=[" + randomInterval.lower.toFixed(5) + "," + randomInterval.upper.toFixed(5) + "]\n",
  );
}

function buildPayload(frozen, dataManifest, outputResults) {
  const manifestPayload = {
    source: UPBIT_DAILY_CANDLES,
    fetchedAt: { started: dataManifest.fetchStartedAt, finished: dataManifest.fetchFinishedAt },
    history: { fromUtcDateInclusive: HISTORY_START_DATE, throughUtcDateInclusive: HISTORY_CUTOFF_DATE },
    marketSnapshotPath: MARKET_SNAPSHOT_PATH,
    marketSnapshotSha256: frozen.spec.source.marketSnapshotSha256,
    markets: dataManifest.manifest,
  };
  const manifestSha256 = sha256(stableStringify(manifestPayload));
  const payload = {
    schemaVersion: 1,
    kind: "nusa-alpha-lab-ic-decay-descriptive-measurement",
    recordedAt: new Date().toISOString(),
    historyCutoffUtcDateInclusive: HISTORY_CUTOFF_DATE,
    scriptSha256: frozen.scriptSha256,
    specSha256: frozen.specSha256,
    universeSnapshotSha256: frozen.spec.source.marketSnapshotSha256,
    signals: SIGNALS,
    horizonsDays: HORIZONS_DAYS,
    bootstrap: BOOTSTRAP,
    dataManifest: manifestPayload,
    results: outputResults,
    safety: { paperOnly: true, liveAuthority: "NONE", productionMutationAllowed: false, realOrderAuthority: false, aiAuthority: "ZERO_AUTHORITY", measurementOnly: true },
    limitation: "Historical history was already read; descriptive only; no signal winner, hold period, strategy registration, or trading authority follows.",
  };
  payload.integrity = {
    specSha256: frozen.specSha256,
    scriptSha256: frozen.scriptSha256,
    manifestSha256,
    payloadSha256: sha256(stableStringify(payload)),
  };
  return payload;
}

async function runMeasurement(expectedScriptSha256, expectedSpecSha256) {
  const frozen = fingerprint();
  if (frozen.scriptSha256 !== expectedScriptSha256) throw new Error("SCRIPT_SHA256_CHANGED:" + frozen.scriptSha256);
  if (frozen.specSha256 !== expectedSpecSha256) throw new Error("SPEC_SHA256_CHANGED:" + frozen.specSha256);
  if (new Date().toISOString().slice(0, 10) !== RUN_DATE) throw new Error("FROZEN_RUN_DATE_MISMATCH_NEW_WORK_ORDER_REQUIRED");
  runSelfTest();
  const jsonPath = path.join(ROOT_DIR, RESULT_JSON_REL);
  const notePath = path.join(ROOT_DIR, RESULT_NOTE_REL);
  const lockPath = path.join(ROOT_DIR, LOCK_REL);
  for (const file of [jsonPath, notePath, lockPath]) {
    if (fs.existsSync(file)) throw new Error("RESULT_ALREADY_EXISTS_NEW_WORK_ORDER_REQUIRED:" + path.relative(ROOT_DIR, file));
  }
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  const lockFd = fs.openSync(lockPath, "wx");
  fs.writeFileSync(lockFd, new Date().toISOString() + " " + process.pid + "\n");
  fs.closeSync(lockFd);
  try {
    const dataManifest = await fetchUniverse();
    const allSeries = new Map(dataManifest.result);
    const outputResults = {};
    for (const signal of SIGNALS) {
      outputResults[signal.id] = {};
      for (const horizon of HORIZONS_DAYS) {
        const rows = buildDailyIcRows(allSeries, signal.id, horizon);
        if (rows.length === 0) throw new Error("NO_VALID_DAILY_IC:" + signal.id + ":" + horizon);
        outputResults[signal.id][String(horizon)] = summarize(rows);
      }
    }
    const payload = buildPayload(frozen, dataManifest, outputResults);
    const jsonText = JSON.stringify(payload, null, 2) + "\n";
    const artifactSha256 = sha256(jsonText);
    fs.writeFileSync(jsonPath, jsonText, { flag: "wx" });
    fs.writeFileSync(notePath, renderNote(payload, artifactSha256), { flag: "wx" });
    process.stdout.write("IC_DECAY_MEASUREMENT_WRITTEN " + RESULT_JSON_REL + "\n");
    process.stdout.write("IC_DECAY_NOTE_WRITTEN " + RESULT_NOTE_REL + "\n");
    process.stdout.write("manifestSha256=" + payload.integrity.manifestSha256 + "\nartifactSha256=" + artifactSha256 + "\n");
    for (const signal of SIGNALS) for (const horizon of HORIZONS_DAYS) {
      const summary = outputResults[signal.id][String(horizon)];
      const interval = summary.blockBootstrap95PercentileInterval;
      process.stdout.write(signal.id + " h=" + horizon + "d mean=" + summary.meanDailyRankIc + " ci=[" + interval.lower + "," + interval.upper + "] n=" + summary.validDays + "\n");
    }
  } finally {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function getFlag(prefix) {
  const match = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return runSelfTest();
  if (args.length === 1 && args[0] === "--fingerprint") {
    process.stdout.write(JSON.stringify(fingerprint(), null, 2) + "\n");
    return;
  }
  if (args[0] === "--measure" && args.length === 3) {
    const expectedScript = getFlag("--expect-script-sha256=");
    const expectedSpec = getFlag("--expect-spec-sha256=");
    if (!expectedScript || !expectedSpec) throw new Error("MEASURE_REQUIRES_FROZEN_SCRIPT_AND_SPEC_SHA256");
    return runMeasurement(expectedScript, expectedSpec);
  }
  throw new Error("USAGE: --self-test | --fingerprint | --measure --expect-script-sha256=SHA --expect-spec-sha256=SHA");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { averageRanks, blockBootstrapMeanInterval, buildDailyIcRows, makeSignalValue, spearmanRankIc };
