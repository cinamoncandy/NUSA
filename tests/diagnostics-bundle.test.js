"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateBundle, redact } = require("../scripts/diagnostics-bundle.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nusa-diagnostics-"));
}

function validRuntimeDiagnostics() {
  return {
    snapshots: [
      {
        sessionId: "session-1",
        sessionState: "RUNNING",
        actualOrderCount: 0,
        actualFillCount: 0,
        cashMutationCount: 0,
        positionMutationCount: 0,
        brokerCallCount: 0,
        privateApiCallCount: 0,
        activeIntervalCount: 1,
        activeTimeoutCount: 1,
        marketListenerCount: 1,
        marketSubscriptionCount: 1
      },
      {
        sessionId: "session-1",
        sessionState: "STOPPED",
        actualOrderCount: 0,
        actualFillCount: 0,
        cashMutationCount: 0,
        positionMutationCount: 0,
        brokerCallCount: 0,
        privateApiCallCount: 0,
        activeIntervalCount: 0,
        activeTimeoutCount: 0,
        marketListenerCount: 0,
        marketSubscriptionCount: 0
      }
    ]
  };
}

test("redaction removes bearer and secret-shaped values", () => {
  const input = "authorization=Bearer abc123 token=supersecret password=hunter2 safe=visible";
  const output = redact(input);
  assert.doesNotMatch(output, /abc123|supersecret|hunter2/);
  assert.match(output, /\[REDACTED\]/);
  assert.match(output, /safe=visible/);
});

test("redaction removes complete quoted secrets with spaces while preserving parseable JSON", () => {
  const spacedSecret = ["secret", "value", "with", "spaces"].join(" ");
  const bearerSecret = `Bearer ${["abc", "def"].join(" ")}`;
  const prefixedToken = ["ghp", "1234567890abcdefghijklmnop"].join("_");
  const input = JSON.stringify({
    token: spacedSecret,
    authorization: bearerSecret,
    note: prefixedToken,
    safe: "visible"
  });
  const output = redact(input);
  const parsed = JSON.parse(output);
  assert.equal(parsed.token, "[REDACTED]");
  assert.equal(parsed.authorization, "[REDACTED]");
  assert.equal(parsed.note, "[REDACTED]");
  assert.equal(parsed.safe, "visible");
  assert.equal(output.includes(spacedSecret), false);
  assert.equal(output.includes(bearerSecret), false);
  assert.equal(output.includes(prefixedToken), false);
});

test("diagnostics bundle is read-only, hashed, redacted, and accepts validated zero-mutation runtime diagnostics", () => {
  const root = tempRoot();
  const output = path.join(root, "bundle");
  const runtime = path.join(root, "runtime.json");
  fs.writeFileSync(runtime, JSON.stringify(validRuntimeDiagnostics()));
  try {
    const manifest = generateBundle({ output, "runtime-diagnostics": runtime });
    assert.equal(manifest.mode, "READ_ONLY_DIAGNOSTICS");
    assert.equal(manifest.productionMutationAllowed, false);
    assert.equal(manifest.evidenceMutationAllowed, false);
    assert.equal(manifest.secretMaterialIncluded, false);
    assert.equal(manifest.redactionEnabled, true);
    assert.equal(manifest.disasterRecoveryContract, "PASS");
    assert.equal(manifest.runtimeDiagnosticsValidation, "PASS");
    assert.ok(manifest.fileCount > 0);
    assert.ok(manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
    assert.equal(fs.existsSync(path.join(output, "manifest.json")), true);
    const copiedRuntime = fs.readFileSync(path.join(output, "runtime", "runtime-diagnostics.json"), "utf8");
    assert.match(copiedRuntime, /session-1/);
    assert.doesNotMatch(JSON.stringify(manifest), /productionMutationAllowed[^f]*true/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics bundle fails closed when runtime diagnostics prove mutation or private API use", () => {
  const root = tempRoot();
  const output = path.join(root, "bundle");
  const runtime = path.join(root, "runtime.json");
  const invalid = validRuntimeDiagnostics();
  invalid.snapshots[1].privateApiCallCount = 1;
  fs.writeFileSync(runtime, JSON.stringify(invalid));
  try {
    assert.throws(() => generateBundle({ output, "runtime-diagnostics": runtime }), /runtime diagnostics validation failed/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics bundle refuses a pre-existing output directory", () => {
  const root = tempRoot();
  const output = path.join(root, "bundle");
  fs.mkdirSync(output);
  try {
    assert.throws(() => generateBundle({ output }), /must not already exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
