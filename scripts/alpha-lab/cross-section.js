#!/usr/bin/env node
"use strict";

// Forward-only Alpha Lab cross-section recorder. Public daily candles are read
// only for a frozen hypothesis already present in the registry. This module
// has no trading, account, host, secret, or release integration.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REGISTRY = path.join(ROOT, "research/alpha-lab/registry/events.jsonl");
const RECORD_FILE = "observations.jsonl";
const STATUS_FILE = "status.json";
const ZERO_SHA256 = "0".repeat(64);
const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOOK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MARKET_RE = /^KRW-[A-Z0-9]{2,12}$/;
const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const MIN_FETCH_AT = Date.parse("2026-12-10T00:00:00.000Z");
const DAILY_CLOSE_SETTLE_MS = 15 * 60 * 1000;
const BASE_LAMBDAS = Object.freeze([0.02, 0.05, 0.1, 0.2, 0.35, 0.5]);
const ADAPTIVE_MAX_LAMBDA = 0.99;
const BET_BURN_IN_DAYS = 20;
const CLIP_SD_MULTIPLIER = 4;
const ONE_WAY_TURNOVER_COST = 0.0015;
const UPBIT_CANDLES_URL = "https://api.upbit.com/v1/candles/days";
const HYPOTHESIS_KEYS = [
  "schemaVersion", "id", "shortNameKo", "kContribution", "alphaSpent",
  "hold", "universe", "signal", "looks",
];
const REGISTRY_ROW_KEYS = ["schemaVersion", "sequence", "rowType", "id", "recordedAtUtc", "previousRowSha256", "payload", "rowSha256"];
const REGISTRATION_PAYLOAD_KEYS = [
  "hypothesisSha256", "kContribution", "alphaSpent", "hold", "universe",
  "firstEvaluableDate", "shortNameKo", "signal", "looks",
];
const REGISTRATION_ROW_TYPES = new Set(["REGISTERED", "VERDICT", "RETIRED"]);
const REGISTRY_RESULT_CODES = new Set(["PASS", "FAIL", "FAIL_EARLY", "NOT_INFORMATIVE", "NO_INFORMATION_YET"]);
const TERMINAL_RESULTS = new Set(["PASS", "FAIL", "FAIL_EARLY"]);
const OBSERVATION_KEYS = [
  "schemaVersion", "sequence", "rowType", "id", "signalDate", "recordedAtUtc",
  "hypothesisSha256", "firstEvaluableDate", "previousRowSha256", "payload", "rowSha256",
];
const OBSERVATION_PAYLOAD_KEYS = [
  "rebalance", "ranks", "weights", "lookbackCloseDate", "signalCloseDate",
  "outcomeCloseDate", "lookbackCloses", "signalCloses", "outcomeCloses",
  "dailyReturns", "portfolioReturn", "equalWeightReturn", "turnover",
  "transactionCost", "grossExcess", "netExcess",
];

function fail(code) {
  throw new Error(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function sameKeys(value, expected) {
  return isRecord(value) && JSON.stringify(sortedKeys(value)) === JSON.stringify([...expected].sort());
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key]);
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireId(value, code = "HYPOTHESIS_ID_INVALID") {
  if (typeof value !== "string" || !ID_RE.test(value)) fail(code);
  return value;
}

function requireDate(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code);
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(code);
  return value;
}

function requireUtcTimestamp(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(code);
  return value;
}

function addUtcDays(dateString, amount) {
  const date = new Date(requireDate(dateString, "UTC_DATE_INVALID") + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function utcDate(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) fail("CLOCK_INVALID");
  return value.toISOString().slice(0, 10);
}

function requireFinite(value, code) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

function nearlyEqual(left, right, tolerance = 1e-12) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function supportsCrossSection(spec) {
  return Array.isArray(spec.universe) && spec.universe.length >= 3 && spec.universe.length <= 56 &&
    sameKeys(spec.signal, ["kind", "lookbackDays"]) && spec.signal.kind === "momentum" &&
    Number.isSafeInteger(spec.signal.lookbackDays) && spec.signal.lookbackDays >= 1 && spec.signal.lookbackDays <= 3650;
}

function validateHypothesis(spec, options = {}) {
  if (!sameKeys(spec, HYPOTHESIS_KEYS) || spec.schemaVersion !== 1) fail("HYPOTHESIS_SCHEMA_INVALID");
  requireId(spec.id);
  if (typeof spec.shortNameKo !== "string" || spec.shortNameKo.trim() !== spec.shortNameKo || spec.shortNameKo.length < 1 || spec.shortNameKo.length > 80) {
    fail("HYPOTHESIS_SHORT_NAME_INVALID");
  }
  if (!Number.isSafeInteger(spec.kContribution) || spec.kContribution < 1) fail("HYPOTHESIS_K_CONTRIBUTION_INVALID");
  if (typeof spec.alphaSpent !== "number" || !Number.isFinite(spec.alphaSpent) || spec.alphaSpent <= 0 || spec.alphaSpent >= 1) {
    fail("HYPOTHESIS_ALPHA_INVALID");
  }
  if (!Number.isSafeInteger(spec.hold) || spec.hold < 1 || spec.hold > 3650) fail("HYPOTHESIS_HOLD_INVALID");
  if (!Array.isArray(spec.universe) || spec.universe.length < 1 || spec.universe.length > 1000) fail("HYPOTHESIS_UNIVERSE_INVALID");
  for (let index = 0; index < spec.universe.length; index += 1) {
    const market = spec.universe[index];
    if (typeof market !== "string" || !MARKET_RE.test(market)) fail("HYPOTHESIS_MARKET_INVALID");
    if (index > 0 && spec.universe[index - 1] >= market) fail("HYPOTHESIS_UNIVERSE_MUST_BE_SORTED_UNIQUE");
  }
  if (!isRecord(spec.signal) || typeof spec.signal.kind !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(spec.signal.kind)) fail("HYPOTHESIS_SIGNAL_INVALID");
  if (!Array.isArray(spec.looks) || spec.looks.length === 0 || spec.looks.length > 64) fail("HYPOTHESIS_LOOKS_INVALID");
  const lookIds = new Set();
  let previousDate = null;
  for (const look of spec.looks) {
    if (!sameKeys(look, ["id", "date"])) fail("HYPOTHESIS_LOOK_INVALID");
    if (typeof look.id !== "string" || !LOOK_ID_RE.test(look.id)) fail("HYPOTHESIS_LOOK_ID_INVALID");
    requireDate(look.date, "HYPOTHESIS_LOOK_DATE_INVALID");
    if (lookIds.has(look.id) || (previousDate !== null && look.date <= previousDate)) fail("HYPOTHESIS_LOOK_ORDER_INVALID");
    lookIds.add(look.id);
    previousDate = look.date;
  }
  if (!supportsCrossSection(spec) && options.allowUnsupported !== true) fail("HYPOTHESIS_SIGNAL_OR_UNIVERSE_UNSUPPORTED");
  return spec;
}

function registrationPayloadToSpec(id, payload, recordedAtUtc, rowSha256) {
  if (!sameKeys(payload, REGISTRATION_PAYLOAD_KEYS)) fail("REGISTRY_REGISTRATION_PAYLOAD_INVALID");
  const spec = {
    schemaVersion: 1,
    id,
    shortNameKo: payload.shortNameKo,
    kContribution: payload.kContribution,
    alphaSpent: payload.alphaSpent,
    hold: payload.hold,
    universe: payload.universe,
    signal: payload.signal,
    looks: payload.looks,
  };
  validateHypothesis(spec, { allowUnsupported: true });
  requireDate(payload.firstEvaluableDate, "REGISTRY_FIRST_EVALUABLE_DATE_INVALID");
  if (typeof payload.hypothesisSha256 !== "string" || !HASH_RE.test(payload.hypothesisSha256)) fail("REGISTRY_HYPOTHESIS_HASH_INVALID");
  const expectedHash = sha256(Buffer.from(canonicalJson(spec) + "\n", "utf8"));
  if (payload.hypothesisSha256 !== expectedHash) fail("REGISTRY_HYPOTHESIS_HASH_MISMATCH");
  const earliestFirstDate = addUtcDays(recordedAtUtc.slice(0, 10), 1);
  if (payload.firstEvaluableDate < earliestFirstDate) fail("REGISTRY_FIRST_EVALUABLE_DATE_TOO_EARLY");
  if (spec.looks.some((look) => look.date < payload.firstEvaluableDate)) fail("REGISTRY_LOOK_BEFORE_FIRST_EVALUABLE_DATE");
  return {
    spec,
    firstEvaluableDate: payload.firstEvaluableDate,
    hypothesisSha256: expectedHash,
    registeredAtUtc: recordedAtUtc,
    registrationRowSha256: rowSha256,
    verdicts: [],
    retired: false,
    active: true,
    supported: supportsCrossSection(spec),
  };
}

function validateRegistryRow(row, expectedSequence, expectedPreviousHash) {
  if (!sameKeys(row, REGISTRY_ROW_KEYS)) fail("REGISTRY_ROW_KEYS_INVALID");
  if (row.schemaVersion !== 1 || row.sequence !== expectedSequence || !REGISTRATION_ROW_TYPES.has(row.rowType)) fail("REGISTRY_ROW_TYPE_OR_SEQUENCE_INVALID");
  requireId(row.id, "REGISTRY_ID_INVALID");
  requireUtcTimestamp(row.recordedAtUtc, "REGISTRY_TIMESTAMP_INVALID");
  if (!isRecord(row.payload)) fail("REGISTRY_PAYLOAD_INVALID");
  if (row.previousRowSha256 !== expectedPreviousHash) fail("REGISTRY_CHAIN_LINK_INVALID");
  if (typeof row.rowSha256 !== "string" || !HASH_RE.test(row.rowSha256)) fail("REGISTRY_ROW_HASH_INVALID");
  const { rowSha256, ...body } = row;
  if (sha256(Buffer.from(canonicalJson(body), "utf8")) !== rowSha256) fail("REGISTRY_ROW_HASH_MISMATCH");
}

function applyRegistryRow(state, row) {
  const registration = state.hypotheses.get(row.id);
  if (!isRecord(row.payload)) fail("REGISTRY_PAYLOAD_INVALID");
  if (row.rowType === "REGISTERED") {
    if (registration) fail("REGISTRY_DUPLICATE_HYPOTHESIS_ID:" + row.id);
    const item = registrationPayloadToSpec(row.id, row.payload, row.recordedAtUtc, row.rowSha256);
    if (state.hashes.has(item.hypothesisSha256)) fail("REGISTRY_DUPLICATE_HYPOTHESIS_HASH");
    state.hashes.set(item.hypothesisSha256, row.id);
    state.hypotheses.set(row.id, item);
    return;
  }
  if (!registration) fail("REGISTRY_EVENT_BEFORE_REGISTRATION:" + row.id);
  if (row.rowType === "VERDICT") {
    if (registration.retired || registration.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode))) fail("REGISTRY_VERDICT_AFTER_TERMINAL_STATE");
    if (!sameKeys(row.payload, ["evidenceEvaluatedAtUtc", "evidenceSha256", "look", "lookDate", "resultCode"])) fail("REGISTRY_VERDICT_PAYLOAD_INVALID");
    const look = registration.spec.looks.find((candidate) => candidate.id === row.payload.look);
    if (!look || look.date !== row.payload.lookDate) fail("REGISTRY_VERDICT_LOOK_INVALID");
    requireDate(row.payload.lookDate, "REGISTRY_VERDICT_LOOK_DATE_INVALID");
    if (row.recordedAtUtc.slice(0, 10) < row.payload.lookDate) fail("REGISTRY_VERDICT_RECORDED_BEFORE_LOOK");
    requireUtcTimestamp(row.payload.evidenceEvaluatedAtUtc, "REGISTRY_VERDICT_EVIDENCE_TIME_INVALID");
    if (row.payload.evidenceEvaluatedAtUtc.slice(0, 10) < row.payload.lookDate || row.payload.evidenceEvaluatedAtUtc > row.recordedAtUtc) fail("REGISTRY_VERDICT_EVIDENCE_TIME_INVALID");
    if (!REGISTRY_RESULT_CODES.has(row.payload.resultCode)) fail("REGISTRY_VERDICT_RESULT_INVALID");
    if (typeof row.payload.evidenceSha256 !== "string" || !HASH_RE.test(row.payload.evidenceSha256)) fail("REGISTRY_VERDICT_EVIDENCE_HASH_INVALID");
    if (row.payload.lookDate < registration.firstEvaluableDate) fail("REGISTRY_VERDICT_BEFORE_FIRST_EVALUABLE");
    if (registration.verdicts.some((verdict) => verdict.look === row.payload.look)) fail("REGISTRY_DUPLICATE_LOOK_VERDICT");
    registration.verdicts.push({
      look: row.payload.look,
      lookDate: row.payload.lookDate,
      resultCode: row.payload.resultCode,
      evidenceSha256: row.payload.evidenceSha256,
    });
    if (TERMINAL_RESULTS.has(row.payload.resultCode) || registration.verdicts.length >= registration.spec.looks.length) registration.active = false;
    return;
  }
  if (row.rowType === "RETIRED") {
    if (!sameKeys(row.payload, ["reason"]) || typeof row.payload.reason !== "string" || row.payload.reason.trim() !== row.payload.reason || row.payload.reason.length < 1 || row.payload.reason.length > 1000) {
      fail("REGISTRY_RETIRED_PAYLOAD_INVALID");
    }
    if (registration.retired) fail("REGISTRY_DUPLICATE_RETIREMENT");
    registration.retired = true;
    registration.active = false;
    return;
  }
  fail("REGISTRY_ROW_TYPE_INVALID");
}

function assertRegularFileOrMissing(filePath, codePrefix) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(codePrefix + "_PATH_NOT_REGULAR_FILE");
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  return true;
}

function readRegularBytes(filePath, codePrefix, maximumBytes, missingAllowed = false) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error && error.code === "ENOENT" && missingAllowed) return null;
    if (error && error.code === "ELOOP") fail(codePrefix + "_PATH_NOT_REGULAR_FILE");
    if (error && error.code === "ENOENT") fail(codePrefix + "_FILE_NOT_FOUND");
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail(codePrefix + "_PATH_NOT_REGULAR_FILE");
    if (stat.size > maximumBytes) fail(codePrefix + "_FILE_TOO_LARGE");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readRegistry(filePath = DEFAULT_REGISTRY) {
  let registryModule;
  try {
    registryModule = require("./registry.js");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND" || !String(error.message).includes("./registry.js")) throw error;
  }
  if (registryModule && typeof registryModule.readRegistry === "function") {
    const state = registryModule.readRegistry(path.resolve(filePath));
    if (!state || !(state.hypotheses instanceof Map) || !Array.isArray(state.rows)) fail("E1_REGISTRY_PROJECTION_INVALID");
    const registrations = [];
    for (const item of state.hypotheses.values()) {
      const spec = validateHypothesis({
        schemaVersion: 1,
        id: item.id,
        shortNameKo: item.shortNameKo,
        kContribution: item.kContribution,
        alphaSpent: item.alphaSpent,
        hold: item.hold,
        universe: item.universe,
        signal: item.signal,
        looks: item.looks,
      }, { allowUnsupported: true });
      const hypothesisSha256 = sha256(Buffer.from(canonicalJson(spec) + "\n", "utf8"));
      if (hypothesisSha256 !== item.hypothesisSha256) fail("E1_REGISTRY_HYPOTHESIS_HASH_MISMATCH");
      const registrationRow = state.rows.find((row) => row.rowType === "REGISTERED" && row.id === item.id);
      if (!registrationRow) fail("E1_REGISTRY_REGISTERED_ROW_MISSING");
      const active = !item.retired &&
        !item.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode)) &&
        item.verdicts.length < item.looks.length;
      registrations.push({
        spec,
        firstEvaluableDate: item.firstEvaluableDate,
        hypothesisSha256,
        registeredAtUtc: item.registeredAtUtc,
        registrationRowSha256: registrationRow.rowSha256,
        verdicts: item.verdicts,
        retired: Boolean(item.retired),
        active,
        supported: supportsCrossSection(spec),
      });
    }
    return registrations;
  }
  const registryPath = path.resolve(filePath);
  const bytes = readRegularBytes(registryPath, "REGISTRY", MAX_REGISTRY_BYTES, true);
  if (bytes === null) return [];
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0x0a || bytes.includes(0x0d)) fail("REGISTRY_JSONL_INVALID");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("REGISTRY_UTF8_INVALID");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) fail("REGISTRY_BLANK_ROW_INVALID");
  const state = { rows: [], hypotheses: new Map(), hashes: new Map() };
  let previousHash = ZERO_SHA256;
  for (let index = 0; index < lines.length; index += 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      fail("REGISTRY_JSON_INVALID_AT_LINE:" + (index + 1));
    }
    if (canonicalJson(row) !== lines[index]) fail("REGISTRY_ROW_NOT_CANONICAL_AT_LINE:" + (index + 1));
    validateRegistryRow(row, index + 1, previousHash);
    applyRegistryRow(state, row);
    state.rows.push(row);
    previousHash = row.rowSha256;
  }
  return [...state.hypotheses.values()];
}

function readHypothesisFile(filePath) {
  const bytes = readRegularBytes(filePath, "HYPOTHESIS", 1024 * 1024);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("HYPOTHESIS_FILE_UTF8_INVALID");
  }
  if (text.includes("\r")) fail("HYPOTHESIS_FILE_MUST_USE_LF");
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    fail("HYPOTHESIS_FILE_JSON_INVALID");
  }
  validateHypothesis(spec);
  const canonicalText = canonicalJson(spec) + "\n";
  if (text !== canonicalText) fail("HYPOTHESIS_FILE_NOT_CANONICAL");
  const hypothesisSha256 = sha256(bytes);
  return { spec, hypothesisSha256 };
}

function findRegistration(spec, hypothesisSha256, registryPath = DEFAULT_REGISTRY) {
  const registration = readRegistry(registryPath).find((item) => item.spec.id === spec.id);
  if (!registration) fail("HYPOTHESIS_NOT_REGISTERED:" + spec.id);
  if (registration.hypothesisSha256 !== hypothesisSha256 || canonicalJson(registration.spec) !== canonicalJson(spec)) {
    fail("HYPOTHESIS_REGISTRATION_HASH_OR_CONTENT_MISMATCH");
  }
  return registration;
}

function readDateFromUpbit(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) fail("UPBIT_CANDLE_TIMESTAMP_INVALID");
  return requireDate(value.slice(0, 10), "UPBIT_CANDLE_DATE_INVALID");
}

function normalizeCandleRows(rows, todayUtc, target = new Map()) {
  if (!Array.isArray(rows) || rows.length === 0) fail("UPBIT_CANDLES_EMPTY");
  for (const row of rows) {
    if (!isRecord(row)) fail("UPBIT_CANDLE_INVALID");
    const date = readDateFromUpbit(row.candle_date_time_utc);
    const close = requireFinite(row.trade_price, "UPBIT_CLOSE_INVALID");
    if (close <= 0) fail("UPBIT_CLOSE_INVALID");
    if (date >= todayUtc) continue; // The current UTC day is incomplete.
    if (target.has(date)) {
      if (target.get(date) !== close) fail("UPBIT_CANDLE_CONFLICTING_DUPLICATE_DATE");
      continue;
    }
    target.set(date, close);
  }
  if (target.size === 0) fail("UPBIT_NO_COMPLETED_CANDLES");
  return target;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRateLimitedFetcher(fetchImpl = globalThis.fetch, clock = () => Date.now()) {
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE");
  let nextStartAt = 0;
  return async function fetchMarketCandles(market, count, to) {
    const waitMs = Math.max(0, nextStartAt - clock());
    nextStartAt = Math.max(nextStartAt, clock()) + 125;
    if (waitMs > 0) await delay(waitMs);
    const url = new URL(UPBIT_CANDLES_URL);
    url.searchParams.set("market", market);
    url.searchParams.set("count", String(count));
    if (to) url.searchParams.set("to", to);
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response || response.ok !== true) fail("UPBIT_HTTP_ERROR:" + (response ? response.status : "NO_RESPONSE"));
    let body;
    try {
      body = await response.json();
    } catch {
      fail("UPBIT_JSON_INVALID");
    }
    return body;
  };
}

async function fetchUniverseCandles(spec, now, fetcher = createRateLimitedFetcher()) {
  const todayUtc = utcDate(now);
  const minimumCompletedRows = spec.signal.lookbackDays + 2;
  const result = new Map();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, spec.universe.length) }, async () => {
    while (cursor < spec.universe.length) {
      const market = spec.universe[cursor];
      cursor += 1;
      const byDate = new Map();
      let to = new Date(now).toISOString().slice(0, 19) + "Z";
      let previousOldestDate = null;
      const maximumPages = Math.ceil(minimumCompletedRows / 199) + 2;
      for (let page = 0; page < maximumPages && byDate.size < minimumCompletedRows; page += 1) {
        const rows = await fetcher(market, 200, to);
        normalizeCandleRows(rows, todayUtc, byDate);
        const pageDates = rows.map((row) => readDateFromUpbit(row.candle_date_time_utc));
        const oldestDate = pageDates.sort()[0];
        if (!oldestDate || (previousOldestDate !== null && oldestDate >= previousOldestDate)) fail("UPBIT_CANDLE_PAGE_DID_NOT_ADVANCE");
        previousOldestDate = oldestDate;
        to = oldestDate + "T00:00:00Z";
        if (rows.length < 200 && byDate.size < minimumCompletedRows) break;
      }
      if (byDate.size < minimumCompletedRows) fail("UPBIT_COMMON_HISTORY_INSUFFICIENT:" + market);
      result.set(market, byDate);
    }
  });
  await Promise.all(workers);
  const dateSets = [...result.values()].map((byDate) => new Set(byDate.keys()));
  const commonDates = [...dateSets[0]].filter((date) => dateSets.every((set) => set.has(date))).sort();
  if (commonDates.length < minimumCompletedRows) fail("UPBIT_COMMON_HISTORY_INSUFFICIENT");
  return { candlesByMarket: result, commonDates };
}

function candidateSignalDate(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) fail("CLOCK_INVALID");
  const midnight = new Date(value.toISOString().slice(0, 10) + "T00:00:00.000Z");
  // A candle labelled D closes at the start of D+1. The observation for D-1
  // becomes available only after the completed D candle is published.
  midnight.setUTCDate(midnight.getUTCDate() - 2);
  return midnight.toISOString().slice(0, 10);
}

function assertFetchWindow(now) {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) fail("CLOCK_INVALID");
  if (time < MIN_FETCH_AT) return { allowed: false, reason: "FETCH_DATE_NOT_REACHED" };
  const value = new Date(time);
  const midnight = Date.parse(value.toISOString().slice(0, 10) + "T00:00:00.000Z");
  if (time < midnight + DAILY_CLOSE_SETTLE_MS) return { allowed: false, reason: "DAILY_CLOSE_SETTLING" };
  return { allowed: true, reason: null };
}

function topWeightsFromRanks(ranks, universe) {
  const weights = new Map(universe.map((market) => [market, 0]));
  const topCount = Math.round(universe.length / 3);
  for (const row of ranks.slice(0, topCount)) weights.set(row.market, 1 / topCount);
  return weights;
}

function exactNumericRows(universe, rows, code) {
  if (!Array.isArray(rows) || rows.length !== universe.length) fail(code);
  const result = new Map();
  for (let index = 0; index < universe.length; index += 1) {
    const row = rows[index];
    if (!sameKeys(row, ["market", "value"]) || row.market !== universe[index]) fail(code);
    const value = requireFinite(row.value, code);
    result.set(row.market, value);
  }
  return result;
}

function mapToWeightRows(universe, weights) {
  return universe.map((market) => ({ market, weight: weights.get(market) }));
}

function rankMomentum(spec, lookbackCloses, signalCloses) {
  const ranks = spec.universe.map((market) => ({
    market,
    score: signalCloses.get(market) / lookbackCloses.get(market) - 1,
  })).sort((left, right) => right.score - left.score || left.market.localeCompare(right.market));
  for (let index = 0; index < ranks.length; index += 1) ranks[index].rank = index + 1;
  return ranks;
}

function rankRowsEqual(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((row, index) =>
    sameKeys(row, ["market", "score", "rank"]) && row.market === expected[index].market &&
    row.rank === expected[index].rank && nearlyEqual(row.score, expected[index].score));
}

function mapFromWeightRows(universe, rows, code) {
  if (!Array.isArray(rows) || rows.length !== universe.length) fail(code);
  const result = new Map();
  for (let index = 0; index < universe.length; index += 1) {
    const row = rows[index];
    if (!sameKeys(row, ["market", "weight"]) || row.market !== universe[index]) fail(code);
    const weight = requireFinite(row.weight, code);
    if (weight < 0 || weight > 1) fail(code);
    result.set(row.market, weight);
  }
  return result;
}

function mapClosesToRows(universe, values) {
  return universe.map((market) => ({ market, value: values.get(market) }));
}

function closeMapForDate(candlesByMarket, universe, date) {
  const result = new Map();
  for (const market of universe) {
    const byDate = candlesByMarket.get(market);
    if (!byDate || !byDate.has(date)) fail("UPBIT_CLOSE_MISSING:" + market + ":" + date);
    result.set(market, byDate.get(date));
  }
  return result;
}

function makeObservation(registration, signalDate, recordedAtUtc, sequence, previousHash, candlesByMarket, previousObservation) {
  const { spec, firstEvaluableDate, hypothesisSha256 } = registration;
  requireDate(signalDate, "OBSERVATION_SIGNAL_DATE_INVALID");
  if (signalDate < firstEvaluableDate) fail("OBSERVATION_BEFORE_FIRST_EVALUABLE_DATE");
  const lookbackDate = addUtcDays(signalDate, -spec.signal.lookbackDays);
  const outcomeDate = addUtcDays(signalDate, 1);
  const lookbackCloses = closeMapForDate(candlesByMarket, spec.universe, lookbackDate);
  const signalCloses = closeMapForDate(candlesByMarket, spec.universe, signalDate);
  const outcomeCloses = closeMapForDate(candlesByMarket, spec.universe, outcomeDate);
  const ranks = rankMomentum(spec, lookbackCloses, signalCloses);
  const priorSequence = sequence - 1;
  const rebalance = priorSequence % spec.hold === 0;
  const previousWeights = previousObservation
    ? mapFromWeightRows(spec.universe, previousObservation.payload.weights, "weight")
    : new Map(spec.universe.map((market) => [market, 0]));
  const newWeights = rebalance ? topWeightsFromRanks(ranks, spec.universe) : previousWeights;
  const dailyReturns = new Map(spec.universe.map((market) => [market, outcomeCloses.get(market) / signalCloses.get(market) - 1]));
  const portfolioReturn = spec.universe.reduce((sum, market) => sum + newWeights.get(market) * dailyReturns.get(market), 0);
  const equalWeightReturn = spec.universe.reduce((sum, market) => sum + dailyReturns.get(market), 0) / spec.universe.length;
  const turnover = rebalance
    ? spec.universe.reduce((sum, market) => sum + Math.abs(newWeights.get(market) - previousWeights.get(market)), 0)
    : 0;
  const transactionCost = ONE_WAY_TURNOVER_COST * turnover;
  const grossExcess = portfolioReturn - equalWeightReturn;
  const netExcess = grossExcess - transactionCost;
  const payload = {
    rebalance,
    ranks,
    weights: mapToWeightRows(spec.universe, newWeights),
    lookbackCloseDate: lookbackDate,
    signalCloseDate: signalDate,
    outcomeCloseDate: outcomeDate,
    lookbackCloses: mapClosesToRows(spec.universe, lookbackCloses),
    signalCloses: mapClosesToRows(spec.universe, signalCloses),
    outcomeCloses: mapClosesToRows(spec.universe, outcomeCloses),
    dailyReturns: mapClosesToRows(spec.universe, dailyReturns),
    portfolioReturn,
    equalWeightReturn,
    turnover,
    transactionCost,
    grossExcess,
    netExcess,
  };
  const body = {
    schemaVersion: 1,
    sequence,
    rowType: "OBSERVATION",
    id: spec.id,
    signalDate,
    recordedAtUtc,
    hypothesisSha256,
    firstEvaluableDate,
    previousRowSha256: previousHash,
    payload,
  };
  return { ...body, rowSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) };
}

function validateObservation(row, registration, expectedSequence, expectedPreviousHash, previousObservation) {
  if (!sameKeys(row, OBSERVATION_KEYS) || row.schemaVersion !== 1 || row.sequence !== expectedSequence || row.rowType !== "OBSERVATION") fail("OBSERVATION_ROW_INVALID");
  if (row.id !== registration.spec.id || row.hypothesisSha256 !== registration.hypothesisSha256 || row.firstEvaluableDate !== registration.firstEvaluableDate) fail("OBSERVATION_REGISTRATION_BINDING_INVALID");
  requireDate(row.signalDate, "OBSERVATION_SIGNAL_DATE_INVALID");
  requireUtcTimestamp(row.recordedAtUtc, "OBSERVATION_TIMESTAMP_INVALID");
  if (row.signalDate < registration.firstEvaluableDate) fail("OBSERVATION_BEFORE_FIRST_EVALUABLE_DATE");
  if (row.signalDate >= registration.spec.looks[registration.spec.looks.length - 1].date) fail("OBSERVATION_AFTER_DECLARED_LOOK_WINDOW");
  if (expectedSequence === 1 && row.signalDate !== registration.firstEvaluableDate) fail("OBSERVATION_FIRST_DATE_MISMATCH");
  if (previousObservation && row.signalDate !== addUtcDays(previousObservation.signalDate, 1)) fail("OBSERVATION_DATE_GAP_OR_REORDER");
  if (row.previousRowSha256 !== expectedPreviousHash || typeof row.rowSha256 !== "string" || !HASH_RE.test(row.rowSha256)) fail("OBSERVATION_CHAIN_LINK_INVALID");
  const { rowSha256, ...body } = row;
  if (sha256(Buffer.from(canonicalJson(body), "utf8")) !== rowSha256) fail("OBSERVATION_ROW_HASH_MISMATCH");
  const payload = row.payload;
  if (!sameKeys(payload, OBSERVATION_PAYLOAD_KEYS)) fail("OBSERVATION_PAYLOAD_INVALID");
  const spec = registration.spec;
  const expectedLookbackDate = addUtcDays(row.signalDate, -spec.signal.lookbackDays);
  const expectedOutcomeDate = addUtcDays(row.signalDate, 1);
  if (payload.lookbackCloseDate !== expectedLookbackDate || payload.signalCloseDate !== row.signalDate || payload.outcomeCloseDate !== expectedOutcomeDate) fail("OBSERVATION_CLOSE_DATE_INVALID");
  const lookbackCloses = exactNumericRows(spec.universe, payload.lookbackCloses, "OBSERVATION_CLOSES_INVALID");
  const signalCloses = exactNumericRows(spec.universe, payload.signalCloses, "OBSERVATION_CLOSES_INVALID");
  const outcomeCloses = exactNumericRows(spec.universe, payload.outcomeCloses, "OBSERVATION_CLOSES_INVALID");
  if ([...lookbackCloses.values(), ...signalCloses.values(), ...outcomeCloses.values()].some((value) => value <= 0)) fail("OBSERVATION_CLOSES_INVALID");
  const expectedRanks = rankMomentum(spec, lookbackCloses, signalCloses);
  if (!rankRowsEqual(payload.ranks, expectedRanks)) fail("OBSERVATION_RANKS_INVALID");
  const expectedRebalance = (expectedSequence - 1) % spec.hold === 0;
  if (payload.rebalance !== expectedRebalance) fail("OBSERVATION_REBALANCE_INVALID");
  const previousWeights = previousObservation
    ? mapFromWeightRows(spec.universe, previousObservation.payload.weights, "weight")
    : new Map(spec.universe.map((market) => [market, 0]));
  const expectedWeights = expectedRebalance ? topWeightsFromRanks(expectedRanks, spec.universe) : previousWeights;
  const actualWeights = mapFromWeightRows(spec.universe, payload.weights, "OBSERVATION_WEIGHTS_INVALID");
  for (const market of spec.universe) if (!nearlyEqual(actualWeights.get(market), expectedWeights.get(market))) fail("OBSERVATION_WEIGHTS_INVALID");
  const dailyReturns = exactNumericRows(spec.universe, payload.dailyReturns, "OBSERVATION_RETURNS_INVALID");
  for (const market of spec.universe) {
    if (!nearlyEqual(dailyReturns.get(market), outcomeCloses.get(market) / signalCloses.get(market) - 1)) fail("OBSERVATION_RETURNS_INVALID");
  }
  const portfolioReturn = spec.universe.reduce((sum, market) => sum + actualWeights.get(market) * dailyReturns.get(market), 0);
  const equalWeightReturn = spec.universe.reduce((sum, market) => sum + dailyReturns.get(market), 0) / spec.universe.length;
  const turnover = expectedRebalance ? spec.universe.reduce((sum, market) => sum + Math.abs(actualWeights.get(market) - previousWeights.get(market)), 0) : 0;
  const transactionCost = ONE_WAY_TURNOVER_COST * turnover;
  const grossExcess = portfolioReturn - equalWeightReturn;
  const netExcess = grossExcess - transactionCost;
  for (const [key, expected] of Object.entries({ portfolioReturn, equalWeightReturn, turnover, transactionCost, grossExcess, netExcess })) {
    const actual = requireFinite(payload[key], "OBSERVATION_METRIC_INVALID");
    if (!nearlyEqual(actual, expected)) fail("OBSERVATION_METRIC_MISMATCH:" + key);
  }
}

function readObservationChain(directory, registration) {
  const filePath = path.join(path.resolve(directory), RECORD_FILE);
  if (!assertRegularFileOrMissing(filePath, "OBSERVATION")) return [];
  const contents = fs.readFileSync(filePath, "utf8");
  if (contents.length === 0 || contents.includes("\r") || !contents.endsWith("\n")) fail("OBSERVATION_JSONL_INVALID");
  const lines = contents.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) fail("OBSERVATION_BLANK_ROW_INVALID");
  let previousHash = ZERO_SHA256;
  let previousObservation = null;
  const observations = [];
  for (let index = 0; index < lines.length; index += 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      fail("OBSERVATION_JSON_INVALID_AT_LINE:" + (index + 1));
    }
    if (canonicalJson(row) !== lines[index]) fail("OBSERVATION_ROW_NOT_CANONICAL_AT_LINE:" + (index + 1));
    validateObservation(row, registration, index + 1, previousHash, previousObservation);
    observations.push(row);
    previousHash = row.rowSha256;
    previousObservation = row;
  }
  return observations;
}

function appendObservation(directory, row, registration) {
  const targetDir = path.resolve(directory);
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, RECORD_FILE);
  const lockPath = filePath + ".lock";
  assertRegularFileOrMissing(filePath, "OBSERVATION");
  let lockFd;
  let locked = false;
  try {
    try {
      lockFd = fs.openSync(lockPath, "wx", 0o600);
      locked = true;
    } catch (error) {
      if (error && error.code === "EEXIST") fail("OBSERVATION_WRITER_LOCKED");
      throw error;
    }
    fs.writeSync(lockFd, row.recordedAtUtc + " pid=" + process.pid + "\n");
    fs.fsyncSync(lockFd);
    fs.closeSync(lockFd);
    lockFd = undefined;
    const currentRows = readObservationChain(targetDir, registration);
    const expectedSequence = currentRows.length + 1;
    const expectedPreviousHash = currentRows.length ? currentRows[currentRows.length - 1].rowSha256 : ZERO_SHA256;
    if (row.sequence !== expectedSequence || row.previousRowSha256 !== expectedPreviousHash) fail("OBSERVATION_CHAIN_CHANGED_DURING_FETCH");
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(filePath, flags, 0o600);
    try {
      fs.writeSync(fd, canonicalJson(row) + "\n", null, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (locked) fs.unlinkSync(lockPath);
  }
}

function resolveSignalAndOutcomeDates(data, registration, previousRows, now) {
  const candidate = data.commonDates[data.commonDates.length - 1];
  const signalDate = addUtcDays(candidate, -1);
  if (signalDate < registration.firstEvaluableDate) return { noop: true, reason: "FIRST_EVALUABLE_DATE_NOT_REACHED" };
  if (signalDate >= registration.spec.looks[registration.spec.looks.length - 1].date) return { noop: true, reason: "DECLARED_LOOK_WINDOW_CLOSED" };
  if (previousRows.length === 0 && signalDate !== registration.firstEvaluableDate) fail("OBSERVATION_GAP_BEFORE_FIRST_RECORD");
  if (previousRows.length > 0) {
    const lastDate = previousRows[previousRows.length - 1].signalDate;
    if (signalDate <= lastDate) return { noop: true, reason: "OBSERVATION_ALREADY_CURRENT" };
    if (signalDate !== addUtcDays(lastDate, 1)) fail("OBSERVATION_GAP_NO_BACKFILL");
  }
  if (data.commonDates.length < registration.spec.signal.lookbackDays + 2) fail("UPBIT_LOOKBACK_INSUFFICIENT");
  return { noop: false, signalDate, recordedAtUtc: (now instanceof Date ? now : new Date(now)).toISOString() };
}

async function recordRegistered(registration, directory, options = {}) {
  const now = options.now || (() => new Date())();
  const fetchWindow = assertFetchWindow(now);
  if (!fetchWindow.allowed) return { recorded: false, reason: fetchWindow.reason };
  const registryPath = options.registryPath || DEFAULT_REGISTRY;
  const currentRegistration = readRegistry(registryPath).find((item) => item.spec.id === registration.spec.id);
  if (!currentRegistration) fail("HYPOTHESIS_NOT_REGISTERED:" + registration.spec.id);
  if (currentRegistration.hypothesisSha256 !== registration.hypothesisSha256 || canonicalJson(currentRegistration.spec) !== canonicalJson(registration.spec)) {
    fail("HYPOTHESIS_REGISTRATION_HASH_OR_CONTENT_MISMATCH");
  }
  registration = currentRegistration;
  if (!registration.active) return { recorded: false, reason: "HYPOTHESIS_NOT_ACTIVE" };
  if (!registration.supported) return { recorded: false, reason: "HYPOTHESIS_SIGNAL_OR_UNIVERSE_UNSUPPORTED" };
  const possibleSignalDate = candidateSignalDate(now);
  if (possibleSignalDate < registration.firstEvaluableDate) return { recorded: false, reason: "FIRST_EVALUABLE_DATE_NOT_REACHED" };
  if (possibleSignalDate >= registration.spec.looks[registration.spec.looks.length - 1].date) return { recorded: false, reason: "DECLARED_LOOK_WINDOW_CLOSED" };
  const previousRows = readObservationChain(directory, registration);
  if (previousRows.length > 0 && possibleSignalDate <= previousRows[previousRows.length - 1].signalDate) {
    return { recorded: false, reason: "OBSERVATION_ALREADY_CURRENT" };
  }
  if (previousRows.length === 0 && possibleSignalDate > registration.firstEvaluableDate) fail("OBSERVATION_GAP_BEFORE_FIRST_RECORD");
  if (previousRows.length > 0 && possibleSignalDate !== addUtcDays(previousRows[previousRows.length - 1].signalDate, 1)) fail("OBSERVATION_GAP_NO_BACKFILL");
  const fetcher = options.fetcher || createRateLimitedFetcher(options.fetchImpl || globalThis.fetch, options.clock);
  const candles = await fetchUniverseCandles(registration.spec, now, fetcher);
  const dates = resolveSignalAndOutcomeDates(candles, registration, previousRows, now);
  if (dates.noop) return { recorded: false, reason: dates.reason };
  const observation = makeObservation(
    registration,
    dates.signalDate,
    dates.recordedAtUtc,
    previousRows.length + 1,
    previousRows.length ? previousRows[previousRows.length - 1].rowSha256 : ZERO_SHA256,
    candles.candlesByMarket,
    previousRows.length ? previousRows[previousRows.length - 1] : null,
  );
  validateObservation(observation, registration, previousRows.length + 1, previousRows.length ? previousRows[previousRows.length - 1].rowSha256 : ZERO_SHA256, previousRows.length ? previousRows[previousRows.length - 1] : null);
  appendObservation(directory, observation, registration);
  return { recorded: true, id: registration.spec.id, signalDate: dates.signalDate, rowSha256: observation.rowSha256 };
}

async function recordFromFile(hypothesisFile, directory, options = {}) {
  const { spec, hypothesisSha256 } = readHypothesisFile(hypothesisFile);
  const registration = findRegistration(spec, hypothesisSha256, options.registryPath || DEFAULT_REGISTRY);
  return recordRegistered(registration, directory, options);
}

function sampleVarianceState() {
  return { count: 0, mean: 0, m2: 0 };
}

function updateVariance(state, value) {
  state.count += 1;
  const delta = value - state.mean;
  state.mean += delta / state.count;
  state.m2 += delta * (value - state.mean);
}

function sampleStandardDeviation(state) {
  if (state.count < 2) return 0;
  return Math.sqrt(Math.max(0, state.m2 / (state.count - 1)));
}

function adaptiveLambdaFromPast(pastY) {
  if (pastY.length === 0) return 0;
  const mean = pastY.reduce((sum, value) => sum + value, 0) / pastY.length;
  if (mean <= 0) return 0;
  const secondMoment = pastY.reduce((sum, value) => sum + value * value, 0) / pastY.length;
  if (secondMoment <= 0) return 0;
  return Math.min(ADAPTIVE_MAX_LAMBDA, mean / secondMoment);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function evaluateEProcess(excessValues, alphaSpent) {
  if (!Array.isArray(excessValues) || excessValues.some((value) => typeof value !== "number" || !Number.isFinite(value))) fail("EPROCESS_INPUT_INVALID");
  if (typeof alphaSpent !== "number" || !Number.isFinite(alphaSpent) || alphaSpent <= 0 || alphaSpent >= 1) fail("EPROCESS_ALPHA_INVALID");
  const baselineWealth = BASE_LAMBDAS.map(() => 1);
  let adaptiveWealth = 1;
  const variance = sampleVarianceState();
  const pastY = [];
  const threshold = 1 / alphaSpent;
  let currentEValue = 1;
  let peakEValue = 1;
  let firstPassDay = null;
  let firstPassEValue = null;
  for (let index = 0; index < excessValues.length; index += 1) {
    const previousSd = sampleStandardDeviation(variance);
    const denominator = CLIP_SD_MULTIPLIER * previousSd;
    const y = denominator > 0 ? clamp(excessValues[index] / denominator, -1, 1) : 0;
    if (index >= BET_BURN_IN_DAYS) {
      for (let lambdaIndex = 0; lambdaIndex < BASE_LAMBDAS.length; lambdaIndex += 1) {
        const factor = 1 + BASE_LAMBDAS[lambdaIndex] * y;
        if (!Number.isFinite(factor) || factor < 0) fail("EPROCESS_BASELINE_FACTOR_INVALID");
        baselineWealth[lambdaIndex] *= factor;
      }
      const adaptiveLambda = adaptiveLambdaFromPast(pastY);
      const adaptiveFactor = 1 + adaptiveLambda * y;
      if (!Number.isFinite(adaptiveFactor) || adaptiveFactor < 0) fail("EPROCESS_ADAPTIVE_FACTOR_INVALID");
      adaptiveWealth *= adaptiveFactor;
      const baselineEValue = baselineWealth.reduce((sum, value) => sum + value, 0) / baselineWealth.length;
      currentEValue = 0.5 * baselineEValue + 0.5 * adaptiveWealth;
      if (!Number.isFinite(currentEValue)) fail("EPROCESS_VALUE_INVALID");
      peakEValue = Math.max(peakEValue, currentEValue);
      if (firstPassDay === null && currentEValue >= threshold) {
        firstPassDay = index + 1;
        firstPassEValue = currentEValue;
      }
    }
    pastY.push(y);
    updateVariance(variance, excessValues[index]);
  }
  return {
    eValue: currentEValue,
    peakEValue,
    threshold,
    days: excessValues.length,
    burnInDays: BET_BURN_IN_DAYS,
    bettingDays: Math.max(0, excessValues.length - BET_BURN_IN_DAYS),
    firstPassDay,
    firstPassEValue,
    status: firstPassDay === null ? "NOT_PASSED" : "PASS",
    meanClippedNormalizedExcessAfterBurnIn: excessValues.length > BET_BURN_IN_DAYS
      ? pastY.slice(BET_BURN_IN_DAYS).reduce((sum, value) => sum + value, 0) / (excessValues.length - BET_BURN_IN_DAYS)
      : null,
  };
}

function readBoundDirectory(directory, registryPath = DEFAULT_REGISTRY) {
  const recordPath = path.join(path.resolve(directory), RECORD_FILE);
  const contents = fs.readFileSync(recordPath, "utf8");
  const firstLine = contents.split("\n", 1)[0];
  let firstRow;
  try {
    firstRow = JSON.parse(firstLine);
  } catch {
    fail("OBSERVATION_JSON_INVALID_AT_LINE:1");
  }
  const registration = readRegistry(registryPath).find((item) => item.spec.id === firstRow.id);
  if (!registration) fail("HYPOTHESIS_NOT_REGISTERED:" + firstRow.id);
  const observations = readObservationChain(directory, registration);
  if (observations.length === 0) fail("NO_OBSERVATIONS");
  return { registration, observations };
}

function writeStatus(directory, status) {
  const targetDir = path.resolve(directory);
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, STATUS_FILE);
  assertRegularFileOrMissing(filePath, "STATUS");
  const { statusSha256: ignored, ...body } = status;
  const document = { ...body, statusSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) };
  const temporary = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeSync(fd, canonicalJson(document) + "\n", null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
  return document;
}

function evaluateDirectory(directory, options = {}) {
  const registryPath = options.registryPath || DEFAULT_REGISTRY;
  const { registration, observations } = readBoundDirectory(directory, registryPath);
  const result = evaluateEProcess(observations.map((row) => row.payload.netExcess), registration.spec.alphaSpent);
  const status = {
    schemaVersion: 1,
    id: registration.spec.id,
    shortNameKo: registration.spec.shortNameKo,
    hypothesisSha256: registration.hypothesisSha256,
    registrationRowSha256: registration.registrationRowSha256,
    firstEvaluableDate: registration.firstEvaluableDate,
    alphaSpent: registration.spec.alphaSpent,
    hold: registration.spec.hold,
    observationCount: observations.length,
    firstSignalDate: observations[0].signalDate,
    lastSignalDate: observations[observations.length - 1].signalDate,
    recordTipSha256: observations[observations.length - 1].rowSha256,
    eValue: result.eValue,
    peakEValue: result.peakEValue,
    threshold: result.threshold,
    days: result.days,
    burnInDays: result.burnInDays,
    bettingDays: result.bettingDays,
    firstPassDay: result.firstPassDay,
    firstPassEValue: result.firstPassEValue,
    status: result.status,
    meanClippedNormalizedExcessAfterBurnIn: result.meanClippedNormalizedExcessAfterBurnIn,
    method: {
      id: "baseline-fixed-mixture-plus-predictable-adaptive-clip4-50-50",
      baselineLambdas: [...BASE_LAMBDAS],
      adaptiveMaximumLambda: ADAPTIVE_MAX_LAMBDA,
      clipSdMultiplier: CLIP_SD_MULTIPLIER,
      burnInDays: BET_BURN_IN_DAYS,
      mixtureWeights: { baseline: 0.5, adaptive: 0.5 },
    },
  };
  return writeStatus(directory, status);
}

function listReadyRegistrations(registryPath = DEFAULT_REGISTRY, now = new Date()) {
  const fetchWindow = assertFetchWindow(now);
  if (!fetchWindow.allowed) return { ready: [], reason: fetchWindow.reason };
  const latestPotentialDate = candidateSignalDate(now);
  const ready = readRegistry(registryPath).filter((registration) =>
    registration.active && registration.supported &&
    registration.firstEvaluableDate <= latestPotentialDate &&
    latestPotentialDate < registration.spec.looks[registration.spec.looks.length - 1].date);
  return { ready, reason: ready.length ? null : "NO_ELIGIBLE_REGISTERED_HYPOTHESIS" };
}

async function runRegistered(dataRoot, options = {}) {
  const now = options.now || (() => new Date())();
  const registryPath = options.registryPath || DEFAULT_REGISTRY;
  const { ready, reason } = listReadyRegistrations(registryPath, now);
  if (ready.length === 0) return { run: "NOOP", reason };
  const fetcher = options.fetcher || createRateLimitedFetcher(options.fetchImpl || globalThis.fetch, options.clock);
  const results = [];
  for (const registration of ready) {
    const directory = path.join(path.resolve(dataRoot), registration.spec.id);
    const recordResult = await recordRegistered(registration, directory, { ...options, fetcher, now, registryPath });
    if (recordResult.recorded) results.push({ ...recordResult, evaluation: evaluateDirectory(directory, { registryPath }) });
    else results.push(recordResult);
  }
  return { run: "RECORDED", results };
}

function requireArg(value, name) {
  if (typeof value !== "string" || value.length === 0) fail("CLI_ARGUMENT_REQUIRED:" + name);
  return value;
}

function runCli(argv = process.argv.slice(2), io = process) {
  const command = argv[0];
  if (!command || command === "help" || command === "--help") {
    io.stdout.write([
      "Forward-only Alpha Lab cross-section recorder",
      "  record <registered-hypothesis.json> <hypothesis-data-dir>",
      "  evaluate <hypothesis-data-dir>",
      "  ready [<registry-file>]",
      "  run-registered <data-root>",
      "Uses only an exact hash-matching REGISTERED row in research/alpha-lab/registry/events.jsonl.",
      "Public Upbit requests are disabled before 2026-12-10 UTC and before the daily close settles.",
    ].join("\n") + "\n");
    return;
  }
  if (command === "record") {
    if (argv.length !== 3) fail("CLI_ARGUMENT_COUNT_INVALID:record");
    const hypothesisFile = requireArg(argv[1], "hypothesisFile");
    const directory = requireArg(argv[2], "dir");
    recordFromFile(hypothesisFile, directory).then((result) => io.stdout.write(JSON.stringify(result) + "\n")).catch((error) => {
      io.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
      io.exitCode = 1;
    });
    return;
  }
  if (command === "evaluate") {
    if (argv.length !== 2) fail("CLI_ARGUMENT_COUNT_INVALID:evaluate");
    const result = evaluateDirectory(requireArg(argv[1], "dir"));
    io.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (command === "ready") {
    if (argv.length > 2) fail("CLI_ARGUMENT_COUNT_INVALID:ready");
    const result = listReadyRegistrations(argv[1] || DEFAULT_REGISTRY);
    io.stdout.write(JSON.stringify({ ready: result.ready.map((registration) => registration.spec.id), reason: result.reason }) + "\n");
    return;
  }
  if (command === "run-registered") {
    if (argv.length !== 2) fail("CLI_ARGUMENT_COUNT_INVALID:run-registered");
    runRegistered(requireArg(argv[1], "dataRoot")).then((result) => io.stdout.write(JSON.stringify(result, null, 2) + "\n")).catch((error) => {
      io.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
      io.exitCode = 1;
    });
    return;
  }
  fail("CLI_COMMAND_INVALID:" + command);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  BASE_LAMBDAS,
  BET_BURN_IN_DAYS,
  DEFAULT_REGISTRY,
  MIN_FETCH_AT,
  RECORD_FILE,
  STATUS_FILE,
  UPBIT_CANDLES_URL,
  canonicalJson,
  candidateSignalDate,
  evaluateDirectory,
  evaluateEProcess,
  findRegistration,
  listReadyRegistrations,
  readHypothesisFile,
  readObservationChain,
  readRegistry,
  recordFromFile,
  recordRegistered,
  runCli,
  runRegistered,
  validateHypothesis,
};
