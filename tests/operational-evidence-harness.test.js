const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildEvidence, canonical, sha256 } = require("../scripts/paper-runtime-evidence-harness.js");

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "nusa-operational-evidence-"));
}

function passingSpawn(_command, args, options) {
  assert.equal(options.env.NUSA_MODE, "PAPER");
  assert.equal(options.env.NUSA_LIVE_MUTATION, "PROHIBITED");
  assert.ok(args.includes("--test"));
  return { status: 0, stdout: `PASS ${args.at(-1)}`, stderr: "" };
}

function payloadWithoutHash(evidence) {
  const { artifact_hash: _artifactHash, ...payload } = evidence;
  return payload;
}

test("all required PAPER checks PASS and emit machine-readable evidence", () => {
  const root = tempRoot();
  try {
    const evidence = buildEvidence({ root, outputPath: "out/evidence.json", spawn: passingSpawn, now: () => "2026-08-07T15:24:00+09:00" });
    assert.equal(evidence.result, "PASS");
    assert.equal(evidence.mode, "PAPER");
    assert.equal(evidence.live_trading_mutation, "PROHIBITED");
    assert.equal(evidence.checks.length, 3);
    assert.ok(evidence.checks.every((check) => check.status === "PASS"));
    const stored = JSON.parse(readFileSync(join(root, "out/evidence.json"), "utf8"));
    assert.deepEqual(stored, evidence);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("any required child-check failure makes overall evidence FAIL", () => {
  let calls = 0;
  const spawn = (_command, args, options) => {
    calls += 1;
    const base = passingSpawn(_command, args, options);
    return calls === 2 ? { ...base, status: 1, stderr: "required check failed" } : base;
  };
  const evidence = buildEvidence({ spawn, now: () => "2026-08-07T15:24:00+09:00" });
  assert.equal(evidence.result, "FAIL");
  assert.equal(evidence.checks.filter((check) => check.status === "FAIL").length, 1);
});

test("artifact hash covers the complete evidence payload", () => {
  const evidence = buildEvidence({ spawn: passingSpawn, now: () => "2026-08-07T15:24:00+09:00" });
  assert.equal(evidence.artifact_hash.algorithm, "sha256");
  assert.equal(evidence.artifact_hash.value, sha256(canonical(payloadWithoutHash(evidence))));
  const tampered = { ...payloadWithoutHash(evidence), result: "FAIL" };
  assert.notEqual(evidence.artifact_hash.value, sha256(canonical(tampered)));
});

test("harness fixes PAPER mode and prohibits LIVE mutation for every child check", () => {
  const seen = [];
  const spawn = (_command, args, options) => {
    seen.push({ mode: options.env.NUSA_MODE, live: options.env.NUSA_LIVE_MUTATION, file: args.at(-1) });
    return { status: 0, stdout: "ok", stderr: "" };
  };
  const evidence = buildEvidence({ spawn, now: () => "2026-08-07T15:24:00+09:00" });
  assert.equal(evidence.assertions.live_mutation_prohibited, true);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((entry) => entry.mode === "PAPER" && entry.live === "PROHIBITED"));
});
