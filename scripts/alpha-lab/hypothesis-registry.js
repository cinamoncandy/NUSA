#!/usr/bin/env node
"use strict";

// Offline, append-only event log for prospective Alpha Lab hypotheses.
// This module never fetches market data or calls a trading/runtime boundary.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_REGISTRY = path.join(ROOT, "docs/research-data/alpha-lab/hypothesis-registry.jsonl");
const ZERO_SHA256 = "0".repeat(64);
const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_TYPES = new Set(["HYPOTHESIS_REGISTERED", "DATA_ACCESS_STARTED", "RESULT_RECORDED", "VERDICT_RECORDED"]);
const VERDICTS = new Set(["PASS", "FAIL", "NOT_INFORMATIVE"]);
const EVENT_KEYS = [
  "schemaVersion", "sequence", "eventId", "eventType", "hypothesisId",
  "recordedAtUtc", "previousEventSha256", "payload", "eventSha256",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key]);
    return sorted;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  throw new Error(code);
}

function requireText(value, code, maximum = 2048) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value || value.length > maximum) fail(code);
  return value;
}

function requireId(value, code) {
  if (typeof value !== "string" || !ID_RE.test(value)) fail(code);
  return value;
}

function requireUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("REGISTRY_TIMESTAMP_INVALID");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("REGISTRY_TIMESTAMP_INVALID");
  return value;
}

function validateSpec(spec) {
  if (!isRecord(spec) || spec.schemaVersion !== 1) fail("HYPOTHESIS_SPEC_SCHEMA_INVALID");
  requireText(spec.hypothesis, "HYPOTHESIS_SPEC_HYPOTHESIS_REQUIRED", 1000);
  requireText(spec.rationale, "HYPOTHESIS_SPEC_RATIONALE_REQUIRED", 4000);
  if (!Array.isArray(spec.sources) || spec.sources.length === 0 ||
      spec.sources.some((source) => typeof source !== "string" || source.trim() !== source || source.length === 0 || source.length > 512)) {
    fail("HYPOTHESIS_SPEC_SOURCES_REQUIRED");
  }
  for (const [key, code] of [
    ["dataPlan", "HYPOTHESIS_SPEC_DATA_PLAN_REQUIRED"],
    ["metric", "HYPOTHESIS_SPEC_METRIC_REQUIRED"],
    ["decisionRule", "HYPOTHESIS_SPEC_DECISION_RULE_REQUIRED"],
  ]) {
    if (!isRecord(spec[key]) || Object.keys(spec[key]).length === 0) fail(code);
  }
  return spec;
}

function canonicalSpecText(spec) {
  return canonicalJson(validateSpec(spec)) + "\n";
}

function readCanonicalSpec(filePath) {
  const bytes = fs.readFileSync(filePath);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("HYPOTHESIS_SPEC_UTF8_INVALID");
  }
  if (text.includes("\r")) fail("HYPOTHESIS_SPEC_MUST_USE_LF");
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    fail("HYPOTHESIS_SPEC_JSON_INVALID");
  }
  const frozenText = canonicalSpecText(spec);
  if (text !== frozenText) fail("HYPOTHESIS_SPEC_NOT_CANONICAL: use sorted keys and one trailing LF");
  return { spec, specSha256: sha256(Buffer.from(frozenText, "utf8")) };
}

function validateRegistrationPayload(payload) {
  if (!isRecord(payload)) fail("REGISTRATION_PAYLOAD_INVALID");
  const keys = Object.keys(payload).sort();
  const expected = [
    "attestedNoPriorDataAccess", "familyId", "kIndex", "kTotal", "relation",
    "revisesHypothesisId", "spec", "specSha256",
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) fail("REGISTRATION_PAYLOAD_KEYS_INVALID");
  requireId(payload.familyId, "HYPOTHESIS_FAMILY_ID_INVALID");
  if (!Number.isSafeInteger(payload.kTotal) || payload.kTotal < 1 ||
      !Number.isSafeInteger(payload.kIndex) || payload.kIndex < 1 || payload.kIndex > payload.kTotal) {
    fail("HYPOTHESIS_K_SLOT_INVALID");
  }
  if (payload.attestedNoPriorDataAccess !== true) fail("HYPOTHESIS_NO_PRIOR_DATA_ATTESTATION_REQUIRED");
  if (payload.relation !== "NEW" && payload.relation !== "REVISION") fail("HYPOTHESIS_RELATION_INVALID");
  if (payload.relation === "REVISION") requireId(payload.revisesHypothesisId, "HYPOTHESIS_REVISION_LINK_REQUIRED");
  else if (payload.revisesHypothesisId !== null) fail("HYPOTHESIS_NEW_CANNOT_HAVE_REVISION_LINK");
  validateSpec(payload.spec);
  if (typeof payload.specSha256 !== "string" || !HASH_RE.test(payload.specSha256)) fail("HYPOTHESIS_SPEC_HASH_INVALID");
  const expectedHash = sha256(Buffer.from(canonicalSpecText(payload.spec), "utf8"));
  if (payload.specSha256 !== expectedHash) fail("HYPOTHESIS_SPEC_HASH_MISMATCH");
}

function validateEvidenceRef(value) {
  requireText(value, "HYPOTHESIS_EVIDENCE_REF_INVALID", 512);
  if (value.startsWith("/") || value.includes("\\") || value.includes(":") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail("HYPOTHESIS_EVIDENCE_REF_MUST_BE_REPOSITORY_RELATIVE");
  }
}

function createEmptyRegistry() {
  return { events: [], hypotheses: new Map(), families: new Map(), specHashes: new Map(), results: new Map() };
}

function validateEnvelope(event, expectedSequence, expectedPreviousHash) {
  if (!isRecord(event) || canonicalJson(Object.keys(event).sort()) !== canonicalJson([...EVENT_KEYS].sort())) fail("REGISTRY_EVENT_KEYS_INVALID");
  if (event.schemaVersion !== 1 || event.sequence !== expectedSequence) fail("REGISTRY_SEQUENCE_INVALID");
  if (event.eventId !== "alpha-lab-event-" + String(expectedSequence).padStart(8, "0")) fail("REGISTRY_EVENT_ID_INVALID");
  if (!EVENT_TYPES.has(event.eventType)) fail("REGISTRY_EVENT_TYPE_INVALID");
  requireId(event.hypothesisId, "REGISTRY_HYPOTHESIS_ID_INVALID");
  requireUtcTimestamp(event.recordedAtUtc);
  if (event.previousEventSha256 !== expectedPreviousHash) fail("REGISTRY_CHAIN_LINK_INVALID");
  if (typeof event.eventSha256 !== "string" || !HASH_RE.test(event.eventSha256)) fail("REGISTRY_EVENT_HASH_INVALID");
  const { eventSha256, ...body } = event;
  if (sha256(Buffer.from(canonicalJson(body), "utf8")) !== eventSha256) fail("REGISTRY_EVENT_HASH_MISMATCH");
}

function requireEmptyPayload(payload) {
  if (!isRecord(payload) || Object.keys(payload).length !== 0) fail("REGISTRY_EVENT_PAYLOAD_INVALID");
}

function applyEvent(registry, event) {
  const hypothesis = registry.hypotheses.get(event.hypothesisId);
  const payload = event.payload;
  switch (event.eventType) {
    case "HYPOTHESIS_REGISTERED": {
      if (hypothesis) fail("HYPOTHESIS_ID_DUPLICATE:" + event.hypothesisId);
      validateRegistrationPayload(payload);
      if (registry.specHashes.has(payload.specSha256)) fail("HYPOTHESIS_SPEC_DUPLICATE:" + registry.specHashes.get(payload.specSha256));
      const family = registry.families.get(payload.familyId);
      if (family && family.kTotal !== payload.kTotal) fail("HYPOTHESIS_FAMILY_K_CHANGED:" + payload.familyId);
      if (family?.slots.has(payload.kIndex)) fail("HYPOTHESIS_K_SLOT_DUPLICATE:" + payload.familyId + ":" + payload.kIndex);
      if (payload.relation === "REVISION") {
        const prior = registry.hypotheses.get(payload.revisesHypothesisId);
        if (!prior || prior.familyId !== payload.familyId || prior.hypothesisId === event.hypothesisId) fail("HYPOTHESIS_REVISION_TARGET_INVALID");
      }
      const familyRecord = family || { familyId: payload.familyId, kTotal: payload.kTotal, slots: new Map() };
      familyRecord.slots.set(payload.kIndex, event.hypothesisId);
      registry.families.set(payload.familyId, familyRecord);
      registry.specHashes.set(payload.specSha256, event.hypothesisId);
      registry.hypotheses.set(event.hypothesisId, {
        hypothesisId: event.hypothesisId,
        familyId: payload.familyId,
        kIndex: payload.kIndex,
        kTotal: payload.kTotal,
        relation: payload.relation,
        revisesHypothesisId: payload.revisesHypothesisId,
        specSha256: payload.specSha256,
        spec: payload.spec,
        registeredEventId: event.eventId,
        registeredAtUtc: event.recordedAtUtc,
        dataAccessStartedEventId: null,
        results: [],
        verdicts: [],
      });
      break;
    }
    case "DATA_ACCESS_STARTED": {
      requireEmptyPayload(payload);
      if (!hypothesis) fail("HYPOTHESIS_NOT_REGISTERED:" + event.hypothesisId);
      if (hypothesis.dataAccessStartedEventId) fail("HYPOTHESIS_DATA_ACCESS_ALREADY_STARTED:" + event.hypothesisId);
      const family = registry.families.get(hypothesis.familyId);
      if (!family || family.slots.size !== family.kTotal) fail("HYPOTHESIS_FAMILY_K_INCOMPLETE_BEFORE_DATA:" + hypothesis.familyId);
      hypothesis.dataAccessStartedEventId = event.eventId;
      break;
    }
    case "RESULT_RECORDED": {
      if (!isRecord(payload) || canonicalJson(Object.keys(payload).sort()) !== canonicalJson(["evidenceRef", "evidenceSha256", "lookId"].sort())) fail("RESULT_PAYLOAD_INVALID");
      if (!hypothesis) fail("HYPOTHESIS_NOT_REGISTERED:" + event.hypothesisId);
      if (!hypothesis.dataAccessStartedEventId) fail("RESULT_BEFORE_DATA_ACCESS_START");
      requireId(payload.lookId, "RESULT_LOOK_ID_INVALID");
      validateEvidenceRef(payload.evidenceRef);
      if (typeof payload.evidenceSha256 !== "string" || !HASH_RE.test(payload.evidenceSha256)) fail("RESULT_EVIDENCE_HASH_INVALID");
      if (hypothesis.results.some((result) => result.lookId === payload.lookId)) fail("RESULT_LOOK_ID_DUPLICATE:" + payload.lookId);
      hypothesis.results.push({
        eventId: event.eventId,
        recordedAtUtc: event.recordedAtUtc,
        lookId: payload.lookId,
        evidenceRef: payload.evidenceRef,
        evidenceSha256: payload.evidenceSha256,
        verdict: null,
      });
      registry.results.set(event.eventId, { hypothesisId: event.hypothesisId, resultIndex: hypothesis.results.length - 1 });
      break;
    }
    case "VERDICT_RECORDED": {
      if (!isRecord(payload) || canonicalJson(Object.keys(payload).sort()) !== canonicalJson(["reason", "resultEventId", "verdict"].sort())) fail("VERDICT_PAYLOAD_INVALID");
      if (!hypothesis) fail("HYPOTHESIS_NOT_REGISTERED:" + event.hypothesisId);
      const result = registry.results.get(payload.resultEventId);
      if (!result || result.hypothesisId !== event.hypothesisId) fail("VERDICT_RESULT_REFERENCE_INVALID");
      if (typeof payload.verdict !== "string" || !VERDICTS.has(payload.verdict)) fail("VERDICT_VALUE_INVALID");
      requireText(payload.reason, "VERDICT_REASON_REQUIRED", 2000);
      const resultRecord = hypothesis.results[result.resultIndex];
      if (resultRecord.verdict) fail("VERDICT_ALREADY_RECORDED_FOR_RESULT");
      resultRecord.verdict = payload.verdict;
      hypothesis.verdicts.push({ eventId: event.eventId, resultEventId: payload.resultEventId, verdict: payload.verdict, reason: payload.reason, recordedAtUtc: event.recordedAtUtc });
      break;
    }
    default:
      fail("REGISTRY_EVENT_TYPE_INVALID");
  }
  registry.events.push(event);
}

function assertRegularFileOrMissing(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("REGISTRY_PATH_NOT_REGULAR_FILE");
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}

function readRegistry(filePath = DEFAULT_REGISTRY) {
  assertRegularFileOrMissing(filePath);
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return createEmptyRegistry();
    throw error;
  }
  if (contents.length === 0) fail("REGISTRY_EMPTY_FILE_INVALID");
  if (contents.includes("\r") || !contents.endsWith("\n")) fail("REGISTRY_JSONL_TERMINATION_INVALID");
  const lines = contents.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) fail("REGISTRY_BLANK_LINE_INVALID");
  const registry = createEmptyRegistry();
  let previousHash = ZERO_SHA256;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      fail("REGISTRY_JSON_INVALID_AT_LINE:" + (index + 1));
    }
    if (canonicalJson(event) !== lines[index]) fail("REGISTRY_EVENT_NOT_CANONICAL_AT_LINE:" + (index + 1));
    validateEnvelope(event, index + 1, previousHash);
    applyEvent(registry, event);
    previousHash = event.eventSha256;
  }
  return registry;
}

function createEvent(registry, eventType, hypothesisId, payload, now) {
  const sequence = registry.events.length + 1;
  const body = {
    schemaVersion: 1,
    sequence,
    eventId: "alpha-lab-event-" + String(sequence).padStart(8, "0"),
    eventType,
    hypothesisId,
    recordedAtUtc: requireUtcTimestamp(now().toISOString()),
    previousEventSha256: registry.events.length ? registry.events[registry.events.length - 1].eventSha256 : ZERO_SHA256,
    payload,
  };
  return { ...body, eventSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) };
}

function appendEvent(filePath, eventType, hypothesisId, payload, options = {}) {
  const registryPath = path.resolve(filePath);
  const lockPath = registryPath + ".lock";
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  let lockFd;
  let locked = false;
  try {
    try {
      lockFd = fs.openSync(lockPath, "wx", 0o600);
      locked = true;
    } catch (error) {
      if (error && error.code === "EEXIST") fail("REGISTRY_WRITER_LOCKED");
      throw error;
    }
    const timestamp = (options.now || (() => new Date()))();
    fs.writeSync(lockFd, timestamp.toISOString() + " pid=" + process.pid + "\n");
    fs.fsyncSync(lockFd);
    fs.closeSync(lockFd);
    lockFd = undefined;

    const registry = readRegistry(registryPath);
    const event = createEvent(registry, eventType, hypothesisId, payload, options.now || (() => new Date()));
    validateEnvelope(event, registry.events.length + 1, registry.events.length ? registry.events[registry.events.length - 1].eventSha256 : ZERO_SHA256);
    applyEvent(registry, event);
    assertRegularFileOrMissing(registryPath);
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(registryPath, flags, 0o600);
    try {
      fs.writeSync(fd, canonicalJson(event) + "\n", null, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return event;
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (locked) fs.unlinkSync(lockPath);
  }
}

function appendRegistration(filePath, input, options = {}) {
  requireId(input.hypothesisId, "HYPOTHESIS_ID_INVALID");
  const specText = canonicalSpecText(input.spec);
  const payload = {
    familyId: requireId(input.familyId, "HYPOTHESIS_FAMILY_ID_INVALID"),
    kIndex: input.kIndex,
    kTotal: input.kTotal,
    relation: input.relation,
    revisesHypothesisId: input.revisesHypothesisId || null,
    attestedNoPriorDataAccess: options.attestedNoPriorDataAccess === true,
    spec: input.spec,
    specSha256: sha256(Buffer.from(specText, "utf8")),
  };
  return appendEvent(filePath, "HYPOTHESIS_REGISTERED", input.hypothesisId, payload, options);
}

function appendDataAccessStarted(filePath, hypothesisId, options = {}) {
  return appendEvent(filePath, "DATA_ACCESS_STARTED", hypothesisId, {}, options);
}

function appendResult(filePath, hypothesisId, input, options = {}) {
  const payload = {
    lookId: input.lookId,
    evidenceRef: input.evidenceRef,
    evidenceSha256: input.evidenceSha256,
  };
  return appendEvent(filePath, "RESULT_RECORDED", hypothesisId, payload, options);
}

function appendVerdict(filePath, hypothesisId, input, options = {}) {
  const payload = {
    resultEventId: input.resultEventId,
    verdict: input.verdict,
    reason: input.reason,
  };
  return appendEvent(filePath, "VERDICT_RECORDED", hypothesisId, payload, options);
}

function projectRegistry(registry) {
  const families = [...registry.families.values()].map((family) => ({
    familyId: family.familyId,
    kTotal: family.kTotal,
    registeredSlots: family.slots.size,
    frozenBeforeData: family.slots.size === family.kTotal,
    dataAccessStarted: [...registry.hypotheses.values()].some((item) => item.familyId === family.familyId && Boolean(item.dataAccessStartedEventId)),
  })).sort((a, b) => a.familyId.localeCompare(b.familyId));
  const hypotheses = [...registry.hypotheses.values()].map((item) => ({
    hypothesisId: item.hypothesisId,
    familyId: item.familyId,
    k: { slot: item.kIndex, total: item.kTotal, registeredSlots: registry.families.get(item.familyId).slots.size },
    relation: item.relation,
    revisesHypothesisId: item.revisesHypothesisId,
    specSha256: item.specSha256,
    state: item.results.some((result) => result.verdict === null) ? "RESULT_RECORDED" : item.verdicts.length ? "VERDICT_RECORDED" : item.results.length ? "RESULT_RECORDED" : item.dataAccessStartedEventId ? "DATA_ACCESSED" : "REGISTERED",
    registeredAtUtc: item.registeredAtUtc,
    dataAccessStarted: Boolean(item.dataAccessStartedEventId),
    results: item.results.map((result) => ({ ...result })),
    verdicts: item.verdicts.map((verdict) => ({ ...verdict })),
  }));
  return {
    schemaVersion: 1,
    eventCount: registry.events.length,
    hypothesisCount: hypotheses.length,
    families,
    hypotheses,
  };
}

function parseFlags(tokens, booleanFlags = []) {
  const flags = Object.create(null);
  const booleanSet = new Set(booleanFlags);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || token.length < 3) fail("CLI_OPTION_INVALID:" + token);
    const name = token.slice(2);
    if (Object.prototype.hasOwnProperty.call(flags, name)) fail("CLI_OPTION_DUPLICATE:" + name);
    if (booleanSet.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) fail("CLI_OPTION_VALUE_REQUIRED:" + name);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function requireFlags(flags, names) {
  for (const name of names) if (typeof flags[name] !== "string" || flags[name].length === 0) fail("CLI_OPTION_REQUIRED:" + name);
}

function rejectUnknownFlags(flags, allowedNames) {
  const allowed = new Set(allowedNames);
  for (const name of Object.keys(flags)) if (!allowed.has(name)) fail("CLI_OPTION_UNKNOWN:" + name);
}

function parsePositiveInteger(value, code) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) fail(code);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(code);
  return number;
}

function runCli(argv = process.argv.slice(2), io = process) {
  const command = argv[0];
  if (command === "--help" || command === "help" || !command) {
    io.stdout.write([
      "Offline Alpha Lab hypothesis registry",
      "  validate [--registry FILE]",
      "  list [--registry FILE]",
      "  canonicalize-spec --spec FILE",
      "  register --id ID --family ID --k-index N --k-total N --relation NEW|REVISION --spec FILE --confirm-no-prior-data-access [--revises ID] [--registry FILE]",
      "  data-started --id ID [--registry FILE]",
      "  result --id ID --look-id ID --evidence-ref REPO/PATH --evidence-sha256 SHA [--registry FILE]",
      "  verdict --id ID --result-event-id EVENT --verdict PASS|FAIL|NOT_INFORMATIVE --reason TEXT [--registry FILE]",
      "The registration command records an attestation; it cannot prove that data was not previously viewed.",
    ].join("\n") + "\n");
    return;
  }
  const bools = command === "register" ? ["confirm-no-prior-data-access"] : [];
  const flags = parseFlags(argv.slice(1), bools);
  const registryPath = flags.registry ? path.resolve(process.cwd(), flags.registry) : DEFAULT_REGISTRY;
  let result;
  switch (command) {
    case "canonicalize-spec": {
      rejectUnknownFlags(flags, ["spec"]);
      requireFlags(flags, ["spec"]);
      const source = fs.readFileSync(path.resolve(process.cwd(), flags.spec), "utf8");
      let parsed;
      try {
        parsed = JSON.parse(source);
      } catch {
        fail("HYPOTHESIS_SPEC_JSON_INVALID");
      }
      io.stdout.write(canonicalSpecText(parsed));
      return;
    }
    case "validate": {
      rejectUnknownFlags(flags, ["registry"]);
      const registry = readRegistry(registryPath);
      result = { valid: true, ...projectRegistry(registry) };
      break;
    }
    case "list":
      rejectUnknownFlags(flags, ["registry"]);
      result = projectRegistry(readRegistry(registryPath));
      break;
    case "register": {
      rejectUnknownFlags(flags, ["id", "family", "k-index", "k-total", "relation", "spec", "confirm-no-prior-data-access", "revises", "registry"]);
      requireFlags(flags, ["id", "family", "k-index", "k-total", "relation", "spec"]);
      if (!flags["confirm-no-prior-data-access"]) fail("CLI_OPTION_REQUIRED:confirm-no-prior-data-access");
      if (flags.relation !== "new" && flags.relation !== "revision") fail("HYPOTHESIS_RELATION_INVALID");
      if (flags.relation === "revision") requireFlags(flags, ["revises"]);
      else if (flags.revises) fail("HYPOTHESIS_NEW_CANNOT_HAVE_REVISION_LINK");
      const { spec } = readCanonicalSpec(path.resolve(process.cwd(), flags.spec));
      result = appendRegistration(registryPath, {
        hypothesisId: flags.id,
        familyId: flags.family,
        kIndex: parsePositiveInteger(flags["k-index"], "HYPOTHESIS_K_SLOT_INVALID"),
        kTotal: parsePositiveInteger(flags["k-total"], "HYPOTHESIS_K_SLOT_INVALID"),
        relation: flags.relation === "new" ? "NEW" : "REVISION",
        revisesHypothesisId: flags.revises || null,
        spec,
      }, { attestedNoPriorDataAccess: true });
      break;
    }
    case "data-started": {
      rejectUnknownFlags(flags, ["id", "registry"]);
      requireFlags(flags, ["id"]);
      result = appendDataAccessStarted(registryPath, flags.id);
      break;
    }
    case "result": {
      rejectUnknownFlags(flags, ["id", "look-id", "evidence-ref", "evidence-sha256", "registry"]);
      requireFlags(flags, ["id", "look-id", "evidence-ref", "evidence-sha256"]);
      result = appendResult(registryPath, flags.id, { lookId: flags["look-id"], evidenceRef: flags["evidence-ref"], evidenceSha256: flags["evidence-sha256"] });
      break;
    }
    case "verdict": {
      rejectUnknownFlags(flags, ["id", "result-event-id", "verdict", "reason", "registry"]);
      requireFlags(flags, ["id", "result-event-id", "verdict", "reason"]);
      result = appendVerdict(registryPath, flags.id, { resultEventId: flags["result-event-id"], verdict: flags.verdict, reason: flags.reason });
      break;
    }
    default:
      fail("CLI_COMMAND_INVALID:" + command);
  }
  io.stdout.write(JSON.stringify(result, null, 2) + "\n");
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
  DEFAULT_REGISTRY,
  appendDataAccessStarted,
  appendRegistration,
  appendResult,
  appendVerdict,
  canonicalJson,
  canonicalSpecText,
  projectRegistry,
  readCanonicalSpec,
  readRegistry,
  runCli,
  validateSpec,
};
