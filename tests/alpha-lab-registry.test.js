"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  canonicalJson,
  projectRegistry,
  readRegistry,
  registerHypothesis,
  retireHypothesis,
  recordVerdict,
  verifyRegistry,
} = require("../scripts/alpha-lab/registry.js");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-alpha-registry-"));
  const registry = path.join(directory, "registry", "events.jsonl");
  const hypothesisFile = path.join(directory, "hypothesis.json");
  const resultFile = path.join(directory, "result.json");
  const spec = {
    schemaVersion: 1,
    id: "momentum-test-001",
    shortNameKo: "모멘텀 시험",
    kContribution: 1,
    alphaSpent: 0.0125,
    hold: 20,
    universe: ["KRW-BTC", "KRW-ETH"],
    signal: { kind: "momentum", lookbackDays: 28 },
    looks: [
      { id: "L30", date: "2026-12-29" },
      { id: "L60", date: "2027-01-28" },
    ],
  };
  writeCanonical(hypothesisFile, spec);
  return { directory, registry, hypothesisFile, resultFile, spec };
}

function writeCanonical(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${canonicalJson(value)}\n`);
}

function now(iso = "2026-11-28T12:00:00.000Z") {
  return () => new Date(iso);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("empty registry verifies without creating a hypothesis", () => {
  const { registry } = fixture();
  assert.deepEqual(verifyRegistry(registry), { valid: true, rows: 0, hypotheses: 0 });
  assert.equal(fs.existsSync(registry), false);
});

test("registration freezes canonical input, records required fields, and starts no earlier than next UTC day", () => {
  const f = fixture();
  const bytes = fs.readFileSync(f.hypothesisFile);
  const row = registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  assert.equal(row.rowType, "REGISTERED");
  assert.equal(row.id, f.spec.id);
  assert.equal(row.payload.hypothesisSha256, sha256(bytes));
  assert.equal(row.payload.kContribution, 1);
  assert.equal(row.payload.alphaSpent, 0.0125);
  assert.equal(row.payload.hold, 20);
  assert.deepEqual(row.payload.universe, ["KRW-BTC", "KRW-ETH"]);
  assert.equal(row.payload.firstEvaluableDate, "2026-11-29");
  assert.deepEqual(verifyRegistry(f.registry), { valid: true, rows: 1, hypotheses: 1 });
});

test("registration rejects a look before first evaluable date", () => {
  const f = fixture();
  f.spec.looks[0].date = "2026-11-28";
  writeCanonical(f.hypothesisFile, f.spec);
  assert.throws(() => registerHypothesis(f.registry, f.hypothesisFile, { now: now("2026-11-28T23:59:59.000Z") }), /HYPOTHESIS_LOOK_BEFORE_FIRST_EVALUABLE/);
  assert.equal(fs.existsSync(f.registry), false);
});

test("re-registering an id is refused, while a separately frozen id may be registered", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  const changedSameId = { ...f.spec, shortNameKo: "바뀐 이름" };
  writeCanonical(f.hypothesisFile, changedSameId);
  assert.throws(() => registerHypothesis(f.registry, f.hypothesisFile, { now: now() }), /HYPOTHESIS_ID_DUPLICATE/);
  const second = path.join(f.directory, "second.json");
  const secondSpec = { ...f.spec, id: "another-id" };
  writeCanonical(second, secondSpec);
  assert.doesNotThrow(() => registerHypothesis(f.registry, second, { now: now() }));
});

test("verdict before the declared look date is refused before opening its result file", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", path.join(f.directory, "missing.json"), { now: now() }), /VERDICT_BEFORE_LOOK_DATE/);
  assert.equal(verifyRegistry(f.registry).rows, 1);
});

test("verdict must bind id and declared look and records only a hash of the result file", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  const result = { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "NO_INFORMATION_YET", evaluatedAtUtc: "2026-12-29T00:00:00.000Z", note: "synthetic fixture" };
  writeCanonical(f.resultFile, result);
  const evidenceHash = sha256(fs.readFileSync(f.resultFile));
  const row = recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") });
  assert.equal(row.rowType, "VERDICT");
  assert.equal(row.payload.lookDate, "2026-12-29");
  assert.equal(row.payload.resultCode, "NO_INFORMATION_YET");
  assert.equal(row.payload.evidenceSha256, evidenceHash);
  assert.equal("note" in row.payload, false);
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") }), /VERDICT_LOOK_DUPLICATE/);
});

test("invalid result codes, unknown looks, and cross-hypothesis result reuse are refused", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L60", resultCode: "PASS", evaluatedAtUtc: "2027-01-28T01:00:00.000Z" });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") }), /RESULT_FILE_BINDING_INVALID/);
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "missing", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") }), /VERDICT_LOOK_UNKNOWN/);
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "MAYBE", evaluatedAtUtc: "2026-12-29T00:00:00.000Z" });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") }), /RESULT_FILE_BINDING_INVALID/);
});

test("terminal outcomes prevent later verdicts; nonterminal no-information can continue at the next look", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "FAIL_EARLY", evaluatedAtUtc: "2026-12-29T00:00:00.000Z" });
  recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L60", resultCode: "PASS", evaluatedAtUtc: "2027-01-28T01:00:00.000Z" });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L60", f.resultFile, { now: now("2027-01-28T00:00:00.000Z") }), /VERDICT_AFTER_TERMINAL_RESULT/);

  const second = fixture();
  registerHypothesis(second.registry, second.hypothesisFile, { now: now() });
  writeCanonical(second.resultFile, { schemaVersion: 1, id: second.spec.id, look: "L30", resultCode: "NO_INFORMATION_YET", evaluatedAtUtc: "2026-12-29T00:00:00.000Z" });
  recordVerdict(second.registry, second.spec.id, "L30", second.resultFile, { now: now("2026-12-29T00:00:00.000Z") });
  writeCanonical(second.resultFile, { schemaVersion: 1, id: second.spec.id, look: "L60", resultCode: "NOT_INFORMATIVE", evaluatedAtUtc: "2027-01-28T00:00:00.000Z" });
  recordVerdict(second.registry, second.spec.id, "L60", second.resultFile, { now: now("2027-01-28T00:00:00.000Z") });
  assert.equal(verifyRegistry(second.registry).rows, 3);
});

test("retirement is append-only and blocks later verdicts", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  retireHypothesis(f.registry, f.spec.id, "owner retired", { now: now("2026-11-29T00:00:00.000Z") });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "PASS", evaluatedAtUtc: "2026-12-29T12:00:00.000Z" });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T00:00:00.000Z") }), /HYPOTHESIS_ALREADY_RETIRED/);
  assert.equal(verifyRegistry(f.registry).rows, 2);
  assert.equal(projectRegistry(readRegistry(f.registry))[0].state, "RETIRED");
});

test("result files evaluated before their declared look are refused", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "PASS", evaluatedAtUtc: "2026-12-28T23:59:59.999Z" });
  assert.throws(() => recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T12:00:00.000Z") }), /RESULT_EVALUATED_BEFORE_LOOK_DATE/);
  assert.equal(verifyRegistry(f.registry).rows, 1);
});

test("registry rejects edited, reordered, truncated, or noncanonical rows", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  const original = fs.readFileSync(f.registry, "utf8");
  fs.writeFileSync(f.registry, original.replace("0.0125", "0.0126"));
  assert.throws(() => readRegistry(f.registry), /REGISTRY_ROW_HASH_MISMATCH/);
  fs.writeFileSync(f.registry, original.slice(0, -2));
  assert.throws(() => readRegistry(f.registry), /REGISTRY_NEWLINE_INVALID/);
  const lines = original.trimEnd().split("\n");
  fs.writeFileSync(f.registry, `${lines[0]}\n${lines[0]}\n`);
  assert.throws(() => readRegistry(f.registry), /REGISTRY_SEQUENCE_INVALID|REGISTRY_ROW_HASH_MISMATCH/);
});

test("registry verification refuses a verdict row dated before its declared look", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  writeCanonical(f.resultFile, { schemaVersion: 1, id: f.spec.id, look: "L30", resultCode: "PASS", evaluatedAtUtc: "2026-12-29T12:00:00.000Z" });
  recordVerdict(f.registry, f.spec.id, "L30", f.resultFile, { now: now("2026-12-29T12:00:00.000Z") });
  const rows = fs.readFileSync(f.registry, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  rows[1].recordedAtUtc = "2026-12-28T12:00:00.000Z";
  delete rows[1].rowSha256;
  rows[1].rowSha256 = sha256(Buffer.from(canonicalJson(rows[1]), "utf8"));
  fs.writeFileSync(f.registry, `${rows.map((row) => canonicalJson(row)).join("\n")}\n`);
  assert.throws(() => readRegistry(f.registry), /VERDICT_RECORDED_BEFORE_LOOK_DATE/);
});

test("concurrent append lock fails closed and a lock is released after success", () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.registry), { recursive: true });
  fs.writeFileSync(`${f.registry}.lock`, "other writer\n");
  assert.throws(() => registerHypothesis(f.registry, f.hypothesisFile, { now: now() }), /REGISTRY_LOCKED/);
  fs.unlinkSync(`${f.registry}.lock`);
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  assert.equal(fs.existsSync(`${f.registry}.lock`), false);
});

test("append refuses a row that would exceed the readable registry limit without corrupting earlier rows", () => {
  const f = fixture();
  registerHypothesis(f.registry, f.hypothesisFile, { now: now() });
  const originalRegistry = fs.readFileSync(f.registry);
  const limit = 16 * 1024 * 1024;
  const oversized = { ...f.spec, id: "size-boundary", signal: { kind: "momentum", extra: "" } };
  const baseHypothesisBytes = Buffer.byteLength(canonicalJson(oversized)) + 1;
  const targetHypothesisBytes = limit - originalRegistry.length - 1;
  oversized.signal.extra = "x".repeat(targetHypothesisBytes - baseHypothesisBytes);
  const oversizedPath = path.join(f.directory, "size-boundary.json");
  writeCanonical(oversizedPath, oversized);
  assert.equal(fs.statSync(oversizedPath).size, targetHypothesisBytes);

  assert.throws(() => registerHypothesis(f.registry, oversizedPath, { now: now() }), /REGISTRY_FILE_TOO_LARGE/);
  assert.deepEqual(fs.readFileSync(f.registry), originalRegistry);
  assert.deepEqual(verifyRegistry(f.registry), { valid: true, rows: 1, hypotheses: 1 });
  assert.equal(fs.existsSync(`${f.registry}.lock`), false);
});
