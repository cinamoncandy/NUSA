const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CrashRecoveryMarkerStore } = require("../dist/apps/desktop/src/crashRecoveryMarker.js");

function store(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-crash-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    marker: path.join(root, "crash-marker.json"),
    recovery: path.join(root, "recovery-records.jsonl")
  };
}

test("first launch is not recovery-required and marker is hash sealed", (t) => {
  const paths = store(t);
  const startup = new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 100 });
  assert.equal(startup.recoveryRequired, false);
  assert.deepEqual(startup.reasonCodes, []);
  assert.equal(startup.marker.cleanShutdown, false);
  assert.equal(typeof startup.marker.checksum, "string");
});

test("clean shutdown does not require recovery on the next run", (t) => {
  const paths = store(t);
  const first = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
  first.startRun({ startedAt: 100 });
  first.update({ lastKnownSessionId: "session-1", lastKnownSessionState: "COMPLETED", lastEvidenceId: "evidence-1" });
  first.completeShutdown({ at: 200, sessionId: "session-1", sessionState: "COMPLETED", evidenceId: "evidence-1" });
  const next = new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 300 });
  assert.equal(next.recoveryRequired, false);
  assert.equal(fs.existsSync(paths.recovery), false);
});

test("RUNNING, PAUSED, and RECONNECTING crashes map to interrupted recovery", (t) => {
  for (const [state, expected] of [["RUNNING", "PREVIOUS_RUN_INTERRUPTED"], ["PAUSED", "PREVIOUS_RUN_INTERRUPTED"], ["RECONNECTING", "PREVIOUS_RECONNECT_INTERRUPTED"]]) {
    const paths = store(t);
    const first = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
    first.startRun({ startedAt: 100 });
    first.update({ lastKnownSessionId: `session-${state}`, lastKnownSessionState: state, lastEvidenceId: "evidence-1" });
    const next = new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 200 });
    assert.equal(next.recoveryRequired, true);
    assert.deepEqual(next.reasonCodes, [expected]);
    assert.equal(next.previousMarker.lastKnownSessionId, `session-${state}`);
  }
});

test("completion and evidence boundaries require review instead of auto-resume", (t) => {
  for (const [state, expected] of [["COMPLETING", "COMPLETION_REVIEW_REQUIRED"], ["EVIDENCE_FINALIZED", "EVIDENCE_RECONCILIATION_REQUIRED"]]) {
    const paths = store(t);
    const first = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
    first.startRun({ startedAt: 100 });
    first.update({ lastKnownSessionId: "session-1", lastKnownSessionState: state });
    const next = new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 200 });
    assert.equal(next.recoveryRequired, true);
    assert.deepEqual(next.reasonCodes, [expected]);
  }
});

test("marker tampering fails closed and records a recovery requirement", (t) => {
  const paths = store(t);
  const first = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
  first.startRun({ startedAt: 100 });
  const marker = JSON.parse(fs.readFileSync(paths.marker, "utf8"));
  marker.lastKnownSessionId = "altered";
  fs.writeFileSync(paths.marker, JSON.stringify(marker));
  const next = new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 200 });
  assert.equal(next.recoveryRequired, true);
  assert.deepEqual(next.reasonCodes, ["CRASH_MARKER_HASH_MISMATCH"]);
  assert.equal(next.marker.cleanShutdown, false);
});

test("recovery records are append-only across repeated interrupted runs", (t) => {
  const paths = store(t);
  const first = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
  first.startRun({ startedAt: 100 });
  first.update({ lastKnownSessionId: "session-1", lastKnownSessionState: "RUNNING" });
  const second = new CrashRecoveryMarkerStore(paths.marker, paths.recovery);
  second.startRun({ startedAt: 200 });
  second.update({ lastKnownSessionId: "session-2", lastKnownSessionState: "RUNNING" });
  new CrashRecoveryMarkerStore(paths.marker, paths.recovery).startRun({ startedAt: 300 });
  const records = fs.readFileSync(paths.recovery, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].recoveryRecordId, records[1].recoveryRecordId);
  assert.notEqual(records[0].previousSessionId, records[1].previousSessionId);
});

test("main startup keeps recovery fail-closed and does not auto-resume", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
  assert.match(source, /CrashRecoveryMarkerStore/);
  assert.match(source, /crashRecoveryRequired/);
  assert.match(source, /runtime\.markUnavailable\(\)/);
  assert.doesNotMatch(source, /if \(crashRecoveryRequired\)[^]*shadowRuntime\.start\(/);
  assert.match(source, /credentialStorageCapabilityPresent: false/);
  // The recovery:* IPC channels live in registerRecoveryIpcHandlers.ts, registered from main.ts.
  const recoveryIpcSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "ipc", "registerRecoveryIpcHandlers.ts"), "utf8");
  assert.match(recoveryIpcSource, /recovery:reconcile/);
  assert.match(recoveryIpcSource, /recovery:owner-review/);
  assert.match(recoveryIpcSource, /recovery:complete/);
});

test("crash recovery itself has no mutation or private capability", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "crashRecoveryMarker.ts"), "utf8");
  assert.doesNotMatch(source, /PaperBroker|execute\(|privateApi|credential/);
});
