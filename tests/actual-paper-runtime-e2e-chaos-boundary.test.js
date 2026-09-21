const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("scripts/actual-paper-runtime-e2e.js", "utf8");
const supervisor = fs.readFileSync("scripts/paper-runtime-supervisor.js", "utf8");
const workflow = fs.readFileSync(".github/workflows/wo-0059-actual-paper-runtime.yml", "utf8");

test("Actual PAPER E2E exercises the canonical closed-learning production root", () => {
  assert.match(source, /const \{ PRODUCTION_RUNTIME_ENTRYPOINT \} = require\("\.\/start-cloud-runtime\.js"\);/);
  assert.match(source, /const runtimePath = resolve\(root, PRODUCTION_RUNTIME_ENTRYPOINT\);/);
  assert.match(source, /spawn\(process\.execPath, \[PRODUCTION_RUNTIME_ENTRYPOINT\]/);
  assert.match(source, /args: \[PRODUCTION_RUNTIME_ENTRYPOINT\]/);
  assert.match(source, /NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: researchReplaySnapshotPath/);
  assert.match(source, /NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH: qualifiedArtifactPath/);
  assert.match(source, /closed_learning_production_root: true/);
  assert.doesNotMatch(source, /dist\/apps\/cloud\/src\/runtime\.js/);
});

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

test("PAPER chaos restart segment is explicitly non-mutating without weakening writer safety", () => {
  assert.match(workflow, /NUSA_PAPER_CHAOS_E2E_NON_MUTATING:\s*"true"/);
  assert.match(supervisor, /baseEnv\.NUSA_PAPER_CHAOS_E2E_NON_MUTATING === "true"/);
  assert.match(supervisor, /NUSA_CLOUD_PAPER_INVESTMENT_PERCENT = "0"/);
  assert.match(supervisor, /PAPER_WRITER_LEASE_CONFLICT_EXIT_CODE = 75/);
  assert.match(supervisor, /DEFAULT_WRITER_LEASE_RETRY_MS = 31_000/);
  assert.match(supervisor, /PAPER_WRITER_ALREADY_ACTIVE.*childStderrTail/);
  assert.match(supervisor, /leaseConflict\s*\?\s*this\.writerLeaseRetryMs/);
});

test("PAPER chaos E2E keeps fail-closed authority invariants", () => {
  assert.match(source, /NUSA_MODE:\s*"PAPER"/);
  assert.match(source, /NUSA_LIVE_MUTATION:\s*"PROHIBITED"/);
  assert.match(source, /liveAuthority:\s*"NONE"/);
  assert.match(source, /productionMutationAllowed:\s*false/);
  assert.match(source, /aiAuthority:\s*"ZERO_AUTHORITY"/);
});
