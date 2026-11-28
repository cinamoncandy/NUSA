#!/usr/bin/env node
"use strict";

// Prospective Alpha Lab hypothesis registry. This file is intentionally offline:
// it never fetches market data and never crosses a trading or runtime boundary.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REGISTRY = path.join(ROOT, "research/alpha-lab/registry/events.jsonl");
const ZERO_HASH = "0".repeat(64);
const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOOK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MARKET_RE = /^KRW-[A-Z0-9]{2,12}$/;
const ROW_TYPES = new Set(["REGISTERED", "VERDICT", "RETIRED"]);
const RESULT_CODES = new Set(["PASS", "FAIL", "FAIL_EARLY", "NOT_INFORMATIVE", "NO_INFORMATION_YET"]);
const TERMINAL_RESULTS = new Set(["PASS", "FAIL", "FAIL_EARLY"]);
const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const EVENT_KEYS = ["schemaVersion", "sequence", "rowType", "id", "recordedAtUtc", "previousRowSha256", "payload", "rowSha256"];

function fail(code) {
  throw new Error(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function requireText(value, code, maximum = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value) fail(code);
  return value;
}

function requireId(value, code = "HYPOTHESIS_ID_INVALID") {
  if (typeof value !== "string" || !ID_RE.test(value)) fail(code);
  return value;
}

function requireDate(value, code = "LOOK_DATE_INVALID") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(code);
  return value;
}

function requireUtcTimestamp(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(code);
  return value;
}

function utcDate(now) {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("REGISTRY_CLOCK_INVALID");
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readRegularFile(filePath, missingCode) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error.code === "ENOENT" && missingCode) fail(missingCode);
    if (error.code === "ELOOP") fail("REGISTRY_FILE_NOT_REGULAR");
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail("REGISTRY_FILE_NOT_REGULAR");
    if (stat.size > MAX_REGISTRY_BYTES) fail("REGISTRY_FILE_TOO_LARGE");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readCanonicalJsonFile(filePath, errorPrefix) {
  const bytes = readRegularFile(filePath, `${errorPrefix}_FILE_MISSING`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${errorPrefix}_UTF8_INVALID`);
  }
  if (text.includes("\r")) fail(`${errorPrefix}_MUST_USE_LF`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${errorPrefix}_JSON_INVALID`);
  }
  if (text !== `${canonicalJson(value)}\n`) fail(`${errorPrefix}_NOT_CANONICAL`);
  return { value, bytes };
}

function validateHypothesis(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) fail("HYPOTHESIS_SCHEMA_INVALID");
  const expectedKeys = ["alphaSpent", "hold", "id", "kContribution", "looks", "schemaVersion", "shortNameKo", "signal", "universe"];
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expectedKeys)) fail("HYPOTHESIS_KEYS_INVALID");
  requireId(value.id);
  requireText(value.shortNameKo, "HYPOTHESIS_SHORT_NAME_INVALID", 80);
  if (!Number.isSafeInteger(value.kContribution) || value.kContribution < 1) fail("HYPOTHESIS_K_INVALID");
  if (typeof value.alphaSpent !== "number" || !Number.isFinite(value.alphaSpent) || value.alphaSpent <= 0 || value.alphaSpent >= 1) {
    fail("HYPOTHESIS_ALPHA_INVALID");
  }
  if (!Number.isSafeInteger(value.hold) || value.hold < 1 || value.hold > 3650) fail("HYPOTHESIS_HOLD_INVALID");
  if (!Array.isArray(value.universe) || value.universe.length === 0 || value.universe.length > 1000) fail("HYPOTHESIS_UNIVERSE_INVALID");
  const markets = value.universe;
  if (markets.some((market) => typeof market !== "string" || !MARKET_RE.test(market))) fail("HYPOTHESIS_MARKET_INVALID");
  if (new Set(markets).size !== markets.length) fail("HYPOTHESIS_MARKET_DUPLICATE");
  if (markets.some((market, index) => index > 0 && markets[index - 1] >= market)) fail("HYPOTHESIS_UNIVERSE_NOT_SORTED");
  if (!isRecord(value.signal) || typeof value.signal.kind !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.signal.kind)) {
    fail("HYPOTHESIS_SIGNAL_INVALID");
  }
  if (!Array.isArray(value.looks) || value.looks.length === 0 || value.looks.length > 64) fail("HYPOTHESIS_LOOKS_INVALID");
  const lookIds = new Set();
  const lookDates = new Set();
  for (const look of value.looks) {
    if (!isRecord(look) || typeof look.id !== "string" || !LOOK_ID_RE.test(look.id)) fail("HYPOTHESIS_LOOK_ID_INVALID");
    requireDate(look.date, "HYPOTHESIS_LOOK_DATE_INVALID");
    if (lookIds.has(look.id)) fail("HYPOTHESIS_LOOK_ID_DUPLICATE");
    if (lookDates.has(look.date)) fail("HYPOTHESIS_LOOK_DATE_DUPLICATE");
    lookIds.add(look.id);
    lookDates.add(look.date);
  }
  for (let i = 1; i < value.looks.length; i++) {
    if (value.looks[i - 1].date >= value.looks[i].date) fail("HYPOTHESIS_LOOKS_NOT_SORTED");
  }
  return value;
}

function emptyState() {
  return { rows: [], hypotheses: new Map(), hashes: new Map() };
}

function validateRowEnvelope(row, expectedSequence, previousHash) {
  if (!isRecord(row) || canonicalJson(Object.keys(row).sort()) !== canonicalJson([...EVENT_KEYS].sort())) fail("REGISTRY_ROW_KEYS_INVALID");
  if (row.schemaVersion !== 1 || row.sequence !== expectedSequence) fail("REGISTRY_SEQUENCE_INVALID");
  if (!ROW_TYPES.has(row.rowType)) fail("REGISTRY_ROW_TYPE_INVALID");
  requireId(row.id, "REGISTRY_ID_INVALID");
  if (typeof row.recordedAtUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.recordedAtUtc)) {
    fail("REGISTRY_TIMESTAMP_INVALID");
  }
  const parsed = Date.parse(row.recordedAtUtc);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== row.recordedAtUtc) fail("REGISTRY_TIMESTAMP_INVALID");
  if (row.previousRowSha256 !== previousHash) fail("REGISTRY_CHAIN_LINK_INVALID");
  if (typeof row.rowSha256 !== "string" || !HASH_RE.test(row.rowSha256)) fail("REGISTRY_ROW_HASH_INVALID");
  const { rowSha256, ...body } = row;
  if (sha256(Buffer.from(canonicalJson(body), "utf8")) !== rowSha256) fail("REGISTRY_ROW_HASH_MISMATCH");
}

function applyRow(state, row) {
  const hypothesis = state.hypotheses.get(row.id);
  const payload = row.payload;
  if (!isRecord(payload)) fail("REGISTRY_PAYLOAD_INVALID");
  if (row.rowType === "REGISTERED") {
    if (hypothesis) fail("HYPOTHESIS_ID_DUPLICATE");
    const expectedKeys = ["alphaSpent", "firstEvaluableDate", "hold", "hypothesisSha256", "kContribution", "looks", "shortNameKo", "signal", "universe"];
    if (canonicalJson(Object.keys(payload).sort()) !== canonicalJson(expectedKeys)) fail("REGISTERED_PAYLOAD_KEYS_INVALID");
    if (typeof payload.hypothesisSha256 !== "string" || !HASH_RE.test(payload.hypothesisSha256)) fail("HYPOTHESIS_HASH_INVALID");
    if (state.hashes.has(payload.hypothesisSha256)) fail("HYPOTHESIS_HASH_DUPLICATE");
    const spec = validateHypothesis({
      schemaVersion: 1,
      id: row.id,
      shortNameKo: payload.shortNameKo,
      kContribution: payload.kContribution,
      alphaSpent: payload.alphaSpent,
      hold: payload.hold,
      universe: payload.universe,
      signal: payload.signal,
      looks: payload.looks,
    });
    const registeredDate = row.recordedAtUtc.slice(0, 10);
    const earliestAllowed = addUtcDays(registeredDate, 1);
    requireDate(payload.firstEvaluableDate, "FIRST_EVALUABLE_DATE_INVALID");
    if (payload.firstEvaluableDate < earliestAllowed) fail("FIRST_EVALUABLE_DATE_TOO_EARLY");
    if (spec.looks.some((look) => look.date < payload.firstEvaluableDate)) fail("HYPOTHESIS_LOOK_BEFORE_FIRST_EVALUABLE");
    state.hashes.set(payload.hypothesisSha256, row.id);
    state.hypotheses.set(row.id, {
      id: row.id,
      hypothesisSha256: payload.hypothesisSha256,
      kContribution: payload.kContribution,
      alphaSpent: payload.alphaSpent,
      hold: payload.hold,
      universe: payload.universe,
      firstEvaluableDate: payload.firstEvaluableDate,
      shortNameKo: payload.shortNameKo,
      signal: payload.signal,
      looks: payload.looks,
      registeredAtUtc: row.recordedAtUtc,
      verdicts: [],
      retired: null,
    });
    return;
  }
  if (!hypothesis) fail("HYPOTHESIS_NOT_REGISTERED");
  if (hypothesis.retired) fail("HYPOTHESIS_ALREADY_RETIRED");
  if (row.rowType === "VERDICT") {
    if (canonicalJson(Object.keys(payload).sort()) !== canonicalJson(["evidenceEvaluatedAtUtc", "evidenceSha256", "look", "lookDate", "resultCode"].sort())) fail("VERDICT_PAYLOAD_KEYS_INVALID");
    const look = hypothesis.looks.find((candidate) => candidate.id === payload.look);
    if (!look || look.date !== payload.lookDate) fail("VERDICT_LOOK_INVALID");
    requireDate(payload.lookDate, "VERDICT_LOOK_DATE_INVALID");
    if (row.recordedAtUtc.slice(0, 10) < payload.lookDate) fail("VERDICT_RECORDED_BEFORE_LOOK_DATE");
    requireUtcTimestamp(payload.evidenceEvaluatedAtUtc, "VERDICT_EVIDENCE_TIMESTAMP_INVALID");
    if (payload.evidenceEvaluatedAtUtc.slice(0, 10) < payload.lookDate || payload.evidenceEvaluatedAtUtc > row.recordedAtUtc) {
      fail("VERDICT_EVIDENCE_TIME_INVALID");
    }
    if (!RESULT_CODES.has(payload.resultCode)) fail("VERDICT_RESULT_INVALID");
    if (typeof payload.evidenceSha256 !== "string" || !HASH_RE.test(payload.evidenceSha256)) fail("VERDICT_EVIDENCE_HASH_INVALID");
    if (payload.lookDate < hypothesis.firstEvaluableDate) fail("VERDICT_BEFORE_FIRST_EVALUABLE");
    if (hypothesis.verdicts.some((verdict) => verdict.look === payload.look)) fail("VERDICT_LOOK_DUPLICATE");
    if (hypothesis.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode))) fail("VERDICT_AFTER_TERMINAL_RESULT");
    hypothesis.verdicts.push({ look: payload.look, lookDate: payload.lookDate, resultCode: payload.resultCode, evidenceSha256: payload.evidenceSha256 });
    return;
  }
  if (row.rowType === "RETIRED") {
    if (canonicalJson(Object.keys(payload).sort()) !== canonicalJson(["reason"].sort())) fail("RETIRED_PAYLOAD_KEYS_INVALID");
    requireText(payload.reason, "RETIRE_REASON_INVALID", 1000);
    hypothesis.retired = { reason: payload.reason, recordedAtUtc: row.recordedAtUtc };
    return;
  }
  fail("REGISTRY_ROW_TYPE_INVALID");
}

function readRegistry(registryPath = DEFAULT_REGISTRY) {
  const resolved = path.resolve(registryPath);
  let bytes;
  try {
    bytes = readRegularFile(resolved);
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
  if (bytes.length === 0) return emptyState();
  if (bytes[bytes.length - 1] !== 0x0a || bytes.includes(0x0d)) fail("REGISTRY_NEWLINE_INVALID");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("REGISTRY_UTF8_INVALID");
  }
  const lines = text.slice(0, -1).split("\n");
  const state = emptyState();
  let previousHash = ZERO_HASH;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].length === 0) fail("REGISTRY_EMPTY_ROW");
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      fail("REGISTRY_ROW_JSON_INVALID");
    }
    if (lines[index] !== canonicalJson(row)) fail("REGISTRY_ROW_NOT_CANONICAL");
    validateRowEnvelope(row, index + 1, previousHash);
    applyRow(state, row);
    state.rows.push(row);
    previousHash = row.rowSha256;
  }
  return state;
}

function buildRow(state, rowType, id, payload, now) {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("REGISTRY_CLOCK_INVALID");
  const body = {
    schemaVersion: 1,
    sequence: state.rows.length + 1,
    rowType,
    id,
    recordedAtUtc: date.toISOString(),
    previousRowSha256: state.rows.length ? state.rows[state.rows.length - 1].rowSha256 : ZERO_HASH,
    payload,
  };
  return { ...body, rowSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) };
}

function appendRow(registryPath, rowType, id, payload, options = {}) {
  const resolved = path.resolve(registryPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  } catch (error) {
    if (error.code === "EEXIST") fail("REGISTRY_LOCKED");
    throw error;
  }
  try {
    fs.writeSync(lockFd, `${process.pid}\n`);
    fs.fsyncSync(lockFd);
    fs.closeSync(lockFd);
    lockFd = null;
    const state = readRegistry(resolved);
    const row = buildRow(state, rowType, id, payload, options.now || (() => new Date()));
    applyRow(state, row);
    const canonicalLine = `${canonicalJson(row)}\n`;
    const registryFd = fs.openSync(resolved, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try {
      const buffer = Buffer.from(canonicalLine, "utf8");
      let offset = 0;
      while (offset < buffer.length) offset += fs.writeSync(registryFd, buffer, offset, buffer.length - offset);
      fs.fsyncSync(registryFd);
    } finally {
      fs.closeSync(registryFd);
    }
    return row;
  } finally {
    if (lockFd !== null && lockFd !== undefined) fs.closeSync(lockFd);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function registerHypothesis(registryPath, hypothesisFile, options = {}) {
  const { value, bytes } = readCanonicalJsonFile(path.resolve(hypothesisFile), "HYPOTHESIS");
  const spec = validateHypothesis(value);
  const now = options.now || (() => new Date());
  const recordedAt = now();
  if (!(recordedAt instanceof Date) || !Number.isFinite(recordedAt.getTime())) fail("REGISTRY_CLOCK_INVALID");
  const registrationOptions = { ...options, now: () => new Date(recordedAt.getTime()) };
  const registeredDate = utcDate(() => recordedAt);
  const firstEvaluableDate = addUtcDays(registeredDate, 1);
  if (spec.looks.some((look) => look.date < firstEvaluableDate)) fail("HYPOTHESIS_LOOK_BEFORE_FIRST_EVALUABLE");
  const payload = {
    hypothesisSha256: sha256(bytes),
    kContribution: spec.kContribution,
    alphaSpent: spec.alphaSpent,
    hold: spec.hold,
    universe: spec.universe,
    firstEvaluableDate,
    shortNameKo: spec.shortNameKo,
    signal: spec.signal,
    looks: spec.looks,
  };
  return appendRow(registryPath, "REGISTERED", spec.id, payload, registrationOptions);
}

function readResultFile(resultFile, id, look, lookDate, asOf) {
  const { value, bytes } = readCanonicalJsonFile(path.resolve(resultFile), "RESULT");
  if (!isRecord(value) || value.schemaVersion !== 1 || value.id !== id || value.look !== look || !RESULT_CODES.has(value.resultCode)) {
    fail("RESULT_FILE_BINDING_INVALID");
  }
  requireUtcTimestamp(value.evaluatedAtUtc, "RESULT_EVALUATION_TIMESTAMP_INVALID");
  if (value.evaluatedAtUtc.slice(0, 10) < lookDate) fail("RESULT_EVALUATED_BEFORE_LOOK_DATE");
  if (value.evaluatedAtUtc > asOf.toISOString()) fail("RESULT_EVALUATED_IN_FUTURE");
  return { resultCode: value.resultCode, evidenceSha256: sha256(bytes), evaluatedAtUtc: value.evaluatedAtUtc };
}

function recordVerdict(registryPath, id, lookId, resultFile, options = {}) {
  requireId(id);
  if (typeof lookId !== "string" || !LOOK_ID_RE.test(lookId)) fail("VERDICT_LOOK_INVALID");
  const state = readRegistry(registryPath);
  const hypothesis = state.hypotheses.get(id);
  if (!hypothesis) fail("HYPOTHESIS_NOT_REGISTERED");
  if (hypothesis.retired) fail("HYPOTHESIS_ALREADY_RETIRED");
  if (hypothesis.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode))) fail("VERDICT_AFTER_TERMINAL_RESULT");
  const look = hypothesis.looks.find((candidate) => candidate.id === lookId);
  if (!look) fail("VERDICT_LOOK_UNKNOWN");
  const now = (options.now || (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("REGISTRY_CLOCK_INVALID");
  const today = utcDate(() => now);
  if (look.date > today) fail("VERDICT_BEFORE_LOOK_DATE");
  if (look.date < hypothesis.firstEvaluableDate) fail("VERDICT_BEFORE_FIRST_EVALUABLE");
  if (hypothesis.verdicts.some((verdict) => verdict.look === lookId)) fail("VERDICT_LOOK_DUPLICATE");
  const result = readResultFile(resultFile, id, lookId, look.date, now);
  return appendRow(registryPath, "VERDICT", id, {
    look: lookId,
    lookDate: look.date,
    resultCode: result.resultCode,
    evidenceSha256: result.evidenceSha256,
    evidenceEvaluatedAtUtc: result.evaluatedAtUtc,
  }, { ...options, now: () => new Date(now.getTime()) });
}

function retireHypothesis(registryPath, id, reason, options = {}) {
  requireId(id);
  requireText(reason, "RETIRE_REASON_INVALID", 1000);
  return appendRow(registryPath, "RETIRED", id, { reason }, options);
}

function projectRegistry(state) {
  return [...state.hypotheses.values()].map((hypothesis) => ({
    id: hypothesis.id,
    shortNameKo: hypothesis.shortNameKo,
    hypothesisSha256: hypothesis.hypothesisSha256,
    kContribution: hypothesis.kContribution,
    alphaSpent: hypothesis.alphaSpent,
    hold: hypothesis.hold,
    universe: hypothesis.universe,
    firstEvaluableDate: hypothesis.firstEvaluableDate,
    looks: hypothesis.looks,
    lastVerdictCode: hypothesis.verdicts.length ? hypothesis.verdicts[hypothesis.verdicts.length - 1].resultCode : null,
    nextLookDate: hypothesis.retired || hypothesis.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode))
      ? null
      : (hypothesis.looks.find((look) => !hypothesis.verdicts.some((verdict) => verdict.look === look.id)) || {}).date || null,
    state: hypothesis.retired ? "RETIRED" : hypothesis.verdicts.some((verdict) => TERMINAL_RESULTS.has(verdict.resultCode))
      ? hypothesis.verdicts[hypothesis.verdicts.length - 1].resultCode
      : hypothesis.verdicts.length ? "OPEN_WITH_VERDICTS" : "REGISTERED",
  }));
}

function verifyRegistry(registryPath = DEFAULT_REGISTRY) {
  const state = readRegistry(registryPath);
  return { valid: true, rows: state.rows.length, hypotheses: state.hypotheses.size };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/alpha-lab/registry.js register <hypothesisFile>",
    "  node scripts/alpha-lab/registry.js verdict <id> <look> <resultFile>",
    "  node scripts/alpha-lab/registry.js retire <id> <reason>",
    "  node scripts/alpha-lab/registry.js list",
    "  node scripts/alpha-lab/registry.js verify",
  ].join("\n");
}

function runCli(argv = process.argv.slice(2), io = process) {
  const [command, ...args] = argv;
  try {
    if (command === "register" && args.length === 1) {
      io.stdout.write(`${JSON.stringify(registerHypothesis(DEFAULT_REGISTRY, args[0]))}\n`);
      return 0;
    }
    if (command === "verdict" && args.length === 3) {
      io.stdout.write(`${JSON.stringify(recordVerdict(DEFAULT_REGISTRY, args[0], args[1], args[2]))}\n`);
      return 0;
    }
    if (command === "retire" && args.length === 2) {
      io.stdout.write(`${JSON.stringify(retireHypothesis(DEFAULT_REGISTRY, args[0], args[1]))}\n`);
      return 0;
    }
    if (command === "list" && args.length === 0) {
      io.stdout.write(`${JSON.stringify(projectRegistry(readRegistry(DEFAULT_REGISTRY)), null, 2)}\n`);
      return 0;
    }
    if (command === "verify" && args.length === 0) {
      io.stdout.write(`${JSON.stringify(verifyRegistry(DEFAULT_REGISTRY))}\n`);
      return 0;
    }
    io.stderr.write(`${usage()}\n`);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  DEFAULT_REGISTRY,
  RESULT_CODES,
  addUtcDays,
  canonicalJson,
  projectRegistry,
  readRegistry,
  registerHypothesis,
  retireHypothesis,
  recordVerdict,
  runCli,
  validateHypothesis,
  verifyRegistry,
};
