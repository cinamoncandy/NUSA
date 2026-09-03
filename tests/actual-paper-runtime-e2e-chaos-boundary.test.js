const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("scripts/actual-paper-runtime-e2e.js", "utf8");

test("PAPER chaos restart evidence binds the last pre-crash cycle to recovery", () => {
  assert.match(source, /buildBoundPaperChaosRestartEvidence\(root, secondCycleSnapshot, supervisedRecovery\)/);
  assert.doesNotMatch(source, /buildBoundPaperChaosRestartEvidence\(root, supervisedStart, supervisedRecovery\)/);
});

test("PAPER chaos E2E uses production bounded supervisor backoff instead of lease retry storm", () => {
  const supervisorBlock = source.match(/supervisor = new PaperRuntimeProcessSupervisor\(\{[\s\S]*?\n    \}\);/);
  assert.ok(supervisorBlock, "supervisor construction must remain present");
  assert.doesNotMatch(supervisorBlock[0], /initialBackoffMs\s*:/);
  assert.doesNotMatch(supervisorBlock[0], /maxBackoffMs\s*:/);
  assert.match(supervisorBlock[0], /stableWindowMs:\s*60_000/);
});

test("PAPER chaos E2E keeps fail-closed authority invariants", () => {
  assert.match(source, /NUSA_MODE:\s*"PAPER"/);
  assert.match(source, /NUSA_LIVE_MUTATION:\s*"PROHIBITED"/);
  assert.match(source, /liveAuthority:\s*"NONE"/);
  assert.match(source, /productionMutationAllowed:\s*false/);
  assert.match(source, /aiAuthority:\s*"ZERO_AUTHORITY"/);
});
