"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DISASTER_RECOVERY_RESTORE_DESCRIPTOR,
  createRecoveryRestoreManifest,
  verifyDisasterRecoveryRestore,
  DisasterRecoveryDecision,
  RecoveryStepStatus
} = require("../dist/apps/execution/src/index.js");
const { validateDisasterRecoveryRestore } = require("../scripts/validate-disaster-recovery-restore.js");

const REV = "3".repeat(40);
const CFG = "4".repeat(64);
const ANCHOR = "5".repeat(64);
const artifacts = () => [
  { path: "runtime/state.db", role: "RUNTIME_STATE", bytes: Buffer.from("runtime-v1") },
  { path: "audit/replay.json", role: "AUDIT_CHAIN", bytes: Buffer.from("replay-v1") },
  { path: "evidence/root.json", role: "EVIDENCE", bytes: Buffer.from("evidence-v1") }
];
const recovery = (overrides = {}) => ({
  runId: "recovery-1",
  decision: DisasterRecoveryDecision.CONSISTENT,
  domains: [
    { domain: "audit", status: RecoveryStepStatus.PASS, checkpoint: "a1", replayedEvents: 7 },
    { domain: "runtime", status: RecoveryStepStatus.PASS, checkpoint: "r1", replayedEvents: 3 }
  ],
  blockingDomains: [],
  completedAtMs: 100,
  ...overrides
});
const manifest = () => createRecoveryRestoreManifest({
  backupId: "backup-1",
  createdAt: "2026-08-08T00:00:00.000Z",
  codeRevision: REV,
  configurationHash: CFG,
  auditReplayChainHash: ANCHOR,
  artifacts: artifacts()
});

function verify(overrides = {}) {
  const current = manifest();
  return verifyDisasterRecoveryRestore({
    manifest: current,
    restoredArtifacts: artifacts().map(({ path, bytes }) => ({ path, bytes })),
    restoredAuditReplayChainHash: ANCHOR,
    recovery: recovery(),
    ...overrides
  });
}

test("creates deterministic manifests without embedding bytes", () => {
  const first = manifest();
  const second = manifest();
  assert.deepEqual(second, first);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(JSON.stringify(first).includes("runtime-v1"), false);
  assert.deepEqual(first.artifacts.map((item) => item.path), ["audit/replay.json", "evidence/root.json", "runtime/state.db"]);
});

test("exact restore passes but grants no restart or execution authority", () => {
  const result = verify();
  assert.equal(result.decision, "PASS");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.automaticRestartAllowed, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("tamper, missing, extra, and audit anchor mismatch fail closed", () => {
  const current = manifest();
  const exact = artifacts().map(({ path, bytes }) => ({ path, bytes }));
  const tampered = exact.map((item) => item.path === "runtime/state.db" ? { ...item, bytes: Buffer.from("tampered") } : item);
  assert.equal(verifyDisasterRecoveryRestore({ manifest: current, restoredArtifacts: tampered, restoredAuditReplayChainHash: ANCHOR, recovery: recovery() }).decision, "SAFE_BLOCK");
  assert.match(verifyDisasterRecoveryRestore({ manifest: current, restoredArtifacts: exact.slice(1), restoredAuditReplayChainHash: ANCHOR, recovery: recovery() }).blockers.join(","), /RESTORE_MISSING/);
  assert.match(verifyDisasterRecoveryRestore({ manifest: current, restoredArtifacts: [...exact, { path: "extra/file.bin", bytes: Buffer.from("x") }], restoredAuditReplayChainHash: ANCHOR, recovery: recovery() }).blockers.join(","), /RESTORE_EXTRA/);
  assert.match(verifyDisasterRecoveryRestore({ manifest: current, restoredArtifacts: exact, restoredAuditReplayChainHash: "6".repeat(64), recovery: recovery() }).blockers.join(","), /AUDIT_ANCHOR_MISMATCH/);
});

test("manifest tamper and unknown recovery fail closed", () => {
  const current = manifest();
  const exact = artifacts().map(({ path, bytes }) => ({ path, bytes }));
  const tamperedManifest = { ...current, configurationHash: "7".repeat(64) };
  assert.match(verifyDisasterRecoveryRestore({ manifest: tamperedManifest, restoredArtifacts: exact, restoredAuditReplayChainHash: ANCHOR, recovery: recovery() }).blockers.join(","), /MANIFEST_DIGEST_MISMATCH/);
  const unsafeRecovery = recovery({ decision: DisasterRecoveryDecision.SAFE_BLOCK, domains: [{ domain: "runtime", status: RecoveryStepStatus.UNKNOWN, checkpoint: "r1", replayedEvents: 0 }], blockingDomains: ["runtime"] });
  const result = verify({ recovery: unsafeRecovery });
  assert.equal(result.decision, "SAFE_BLOCK");
  assert.match(result.blockers.join(","), /RECOVERY_NOT_CONSISTENT|RECOVERY_DOMAIN_NOT_PASS/);
});

test("prohibited recovery paths cannot enter a manifest", () => {
  const sensitiveSegment = ["creden", "tial"].join("");
  assert.throws(() => createRecoveryRestoreManifest({ backupId: "backup-2", createdAt: "2026-08-08T00:00:00.000Z", codeRevision: REV, configurationHash: CFG, auditReplayChainHash: ANCHOR, artifacts: [{ path: `runtime/${sensitiveSegment}.bin`, role: "CONFIG", bytes: Buffer.from("x") }] }), /SECRET_PATH_PROHIBITED/);
});

test("source guard keeps restore verification evidence-only", () => {
  const source = validateDisasterRecoveryRestore();
  assert.equal(source.ok, true, source.failures.join(","));
  assert.equal(DISASTER_RECOVERY_RESTORE_DESCRIPTOR.automaticRestartAllowed, false);
  assert.equal(DISASTER_RECOVERY_RESTORE_DESCRIPTOR.executionAuthority, false);
  assert.equal(DISASTER_RECOVERY_RESTORE_DESCRIPTOR.authorizesLive, false);
});
