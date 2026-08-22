const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deriveRuntimeFingerprint } = require("../dist/apps/desktop/src/runtimeFingerprint.js");
const { recoverPaperSafetySnapshot, createPaperSafetySnapshot } = require("../dist/apps/desktop/src/paper/paperSafetySnapshot.js");

const root = path.join(__dirname, "..");

/**
 * WO-0034-A4Q audit finding: `PAPER_SAFETY_FINGERPRINTS.runtime` in main.ts used to be
 * `createHash("sha256").update("desktop-paper-runtime-v1").digest("hex")` -- a fixed
 * string that cannot change no matter what build is running. `recoverPaperSafetySnapshot`
 * compares this fingerprint across a restart specifically to detect that the running build
 * is not the one that wrote the persisted snapshot; a fixed value can never disagree with
 * itself, so that check could never fire.
 */

test("main.js derives the runtime fingerprint from live build facts, not a fixed string", () => {
  const compiledMain = fs.readFileSync(path.join(root, "dist/apps/desktop/src/main.js"), "utf8");
  assert.match(
    compiledMain,
    /runtime:\s*\(0,\s*\w+\.deriveRuntimeFingerprint\)/,
    "expected main.js to compute the runtime fingerprint via deriveRuntimeFingerprint"
  );
  assert.doesNotMatch(
    compiledMain,
    /desktop-paper-runtime-v1/,
    "the fixed runtime fingerprint literal should be gone"
  );
});

test("deriveRuntimeFingerprint actually changes when any of the build facts it is fed changes", () => {
  const base = { appVersion: "0.1.0", sourceCommitSha: "a".repeat(40), persistenceSchemaVersion: 1, platform: "win32", nodeMajorVersion: 24 };
  const baseline = deriveRuntimeFingerprint(base);

  for (const overrides of [
    { appVersion: "0.2.0" },
    { sourceCommitSha: "b".repeat(40) },
    { persistenceSchemaVersion: 2 },
    { platform: "linux" },
    { nodeMajorVersion: 25 }
  ]) {
    const changed = deriveRuntimeFingerprint({ ...base, ...overrides });
    assert.notEqual(changed, baseline, `expected a fingerprint change for ${JSON.stringify(overrides)}`);
  }

  assert.equal(deriveRuntimeFingerprint({ ...base }), baseline, "identical facts must still produce the identical fingerprint");
});

test("a persisted snapshot recovered under a different runtime fingerprint is flagged, not silently accepted", () => {
  const fingerprints = { strategy: "s", config: "c", runtime: deriveRuntimeFingerprint({ appVersion: "0.1.0", sourceCommitSha: "a".repeat(40), persistenceSchemaVersion: 1, platform: "win32", nodeMajorVersion: 24 }), riskPolicy: "r" };
  const snapshot = createPaperSafetySnapshot({
    snapshotId: "snap-1", createdAt: Date.now(), sourceCommitSha: "a".repeat(40), tradingMode: "PAPER_MANUAL",
    killSwitch: { active: false, activatedAt: null, reason: null }, fingerprints, approval: null,
    deploymentIntegrity: { status: "PASS", checkedAt: Date.now(), reasonCodes: [] },
    reconciliation: { status: "PASS", checkedAt: Date.now(), ledgerSha256: null, reasonCodes: [] },
    idempotency: { seenSignalIds: [], seenCommandIds: [], seenClientOrderIds: [] },
    openAlerts: [], lossState: { tradingDay: "2026-08-03", consecutiveLossCount: 0, dailyLoss: 0 },
    marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }
  });

  // Same commit, but the persistence schema moved on -- the exact case a fixed literal could
  // never catch, and the reason this fingerprint exists alongside the separate commit check.
  const upgradedFingerprints = { ...fingerprints, runtime: deriveRuntimeFingerprint({ appVersion: "0.1.0", sourceCommitSha: "a".repeat(40), persistenceSchemaVersion: 2, platform: "win32", nodeMajorVersion: 24 }) };
  const recovery = recoverPaperSafetySnapshot(snapshot, { sourceCommitSha: "a".repeat(40), fingerprints: upgradedFingerprints });

  assert.ok(recovery.reasonCodes.includes("FINGERPRINT_RUNTIME_MISMATCH"), "a real runtime-identity change must be visible in recovery, not swallowed");
});
