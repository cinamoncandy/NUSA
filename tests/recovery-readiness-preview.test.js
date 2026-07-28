const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");
const { createPaperSafetySnapshot } = require("../dist/apps/desktop/src/paperSafetySnapshot.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");

const SCRIPT = path.join(__dirname, "..", "scripts", "check-recovery-readiness.js");
const scriptSource = fs.readFileSync(SCRIPT, "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };
const FINGERPRINTS = { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" };

/** Writes a real database the way the desktop app writes one. */
function seedUserData(directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const store = new DesktopPersistenceStore(path.join(directory, "dokkaebi.db"));
  try {
    const broker = new PaperBroker(10_000_000, "KRW-BTC", 0.0005, RISK_POLICY, undefined, FILL_MODEL);
    if (options.withOrder) broker.execute("BUY", 0.001, 100_000_000);
    store.save(broker.exportState(), new ControlPlane("sma-crossover", 200).exportState());
    if (options.withSnapshot !== false) {
      store.savePaperSafetySnapshot(createPaperSafetySnapshot({
        snapshotId: "snap-test-1", createdAt: Date.now(), sourceCommitSha: "local-paper-build",
        tradingMode: "PAPER_MANUAL", fingerprints: FINGERPRINTS,
        killSwitch: { active: options.killSwitch === true, reason: options.killSwitch === true ? "operator" : null, activatedAt: options.killSwitch === true ? Date.now() : null },
        approval: null,
        deploymentIntegrity: { status: "PASS", reasonCodes: [] },
        reconciliation: { status: "PASS", reasonCodes: [] },
        idempotency: { signalIds: [], commandIds: [], clientOrderIds: [] },
        openAlerts: [],
        lossState: { tradingDay: "2026-07-28", realizedLoss: 0, consecutiveLossCount: 0, sessionPeakEquity: 0, sessionEquity: 0 },
        marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }
      }));
    }
  } finally {
    store.close();
  }
}

function runPreview(directory, extra = []) {
  const stdout = execFileSync(process.execPath, [SCRIPT, "--user-data", directory, "--json", ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(stdout);
}

test("a clean saved state previews as MATCHED", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory);

  const { comparison } = runPreview(directory, ["--mark-price", "100000000"]);
  assert.equal(comparison.outcome, "MATCHED", JSON.stringify({ m: comparison.mismatchCodes, e: comparison.errorCodes }));
  assert.equal(comparison.recoveryRecordId, "snap-test-1");
  assert.match(comparison.fingerprint, /^[a-f0-9]{64}$/);
});

test("an active kill switch previews as MISMATCHED with the blocking code", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory, { killSwitch: true });

  const { comparison } = runPreview(directory, ["--mark-price", "100000000"]);
  assert.equal(comparison.outcome, "MISMATCHED");
  assert.ok(comparison.mismatchCodes.includes("KILL_SWITCH_ACTIVE"), JSON.stringify(comparison.mismatchCodes));
});

test("a markerless evidence directory previews as MISMATCHED", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory);
  // One sealed archive and one that a crash left open. Only the open one may block.
  fs.mkdirSync(path.join(directory, "shadow-evidence", "sealed"), { recursive: true });
  fs.writeFileSync(path.join(directory, "shadow-evidence", "sealed", "completed.marker"), "{}");
  fs.mkdirSync(path.join(directory, "shadow-evidence", "crashed"), { recursive: true });
  fs.writeFileSync(path.join(directory, "shadow-evidence", "crashed", "events.ndjson"), "");

  const { comparison } = runPreview(directory, ["--mark-price", "100000000"]);
  assert.equal(comparison.outcome, "MISMATCHED");
  assert.ok(comparison.mismatchCodes.includes("MARKERLESS_EVIDENCE"), JSON.stringify(comparison.mismatchCodes));
});

test("a missing database previews as ERROR, not as MATCHED", async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));

  // Nothing to compare must never read as nothing wrong.
  const { comparison, notes } = runPreview(path.join(parent, "never-run"));
  assert.equal(comparison.outcome, "ERROR");
  assert.ok(comparison.errorCodes.includes("PERSISTED_SNAPSHOT_MISSING"), JSON.stringify(comparison.errorCodes));
  assert.ok(comparison.errorCodes.includes("RECOVERY_RECORD_MISSING"), JSON.stringify(comparison.errorCodes));
  assert.ok(notes.some((note) => note.includes("저장소 파일이 없습니다")), JSON.stringify(notes));
});

test("without a mark price the preview reports it rather than inventing one", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory);

  // A cash and position comparison against a made-up price is not a comparison. The tool
  // says it could not do that part instead of quietly substituting a number.
  const { comparison, markPriceSupplied } = runPreview(directory);
  assert.equal(markPriceSupplied, false);
  assert.equal(comparison.outcome, "ERROR");
  assert.ok(comparison.errorCodes.includes("MARK_PRICE_UNAVAILABLE"), JSON.stringify(comparison.errorCodes));
});

test("the preview leaves the database byte-identical", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory, { withOrder: true });

  const databasePath = path.join(directory, "dokkaebi.db");
  const digest = () => createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
  const before = digest();
  runPreview(directory, ["--mark-price", "100000000"]);
  assert.equal(digest(), before, "an inspection tool must not alter what it inspects");
});

test("the preview cannot approve, complete, or delete anything", () => {
  const code = scriptSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // No approval path: putting one in a terminal tool would defeat the human review the
  // whole owner-review design exists to enforce.
  for (const forbidden of ["approveRecoveryReview", "completeRecovery", "recovery:owner-review", "recovery:complete", "explicitOwnerAction"]) {
    assert.equal(code.includes(forbidden), false, `the preview must not reference ${forbidden}`);
  }
  for (const forbidden of ["rmSync", "unlinkSync", "DELETE FROM", "savePaperSafetySnapshot", ".save("]) {
    assert.equal(code.includes(forbidden), false, `the preview must not reference ${forbidden}`);
  }
  // Read-only is stated to the store, not merely intended.
  assert.match(code, /readOnly: true/);
});

test("the preview runs the same comparison function the app runs", () => {
  // A second implementation could report MATCHED for a state the app would refuse -- which
  // is precisely the kind of reassurance an operator would act on.
  assert.match(scriptSource, /require\("\.\.\/dist\/apps\/desktop\/src\/recoveryReconciliation\.js"\)/);
  assert.match(scriptSource, /compareRecoveryState\(\{/);
});

test("the preview's account constants match the ones main.ts composes", () => {
  // If these drift, the preview measures a different account than the app does and its
  // MATCHED means nothing.
  for (const constant of [
    /const INITIAL_CASH = 10_000_000;/,
    /const MARKET = "KRW-BTC";/,
    /const FEE_RATE = 0.0005;/,
    /maxOrderNotional: 2_000_000, maxPositionQuantity: 0\.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000/,
    /slippageBps: 5, spreadBps: 5, maxFillRatio: 0\.9/
  ]) {
    assert.match(scriptSource, constant, `preview constant missing: ${constant}`);
    assert.match(mainSource, constant, `main.ts constant missing: ${constant}`);
  }
});

test("the human-readable output names no absolute path", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "recovery-preview-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  seedUserData(directory, { killSwitch: true });

  const stdout = execFileSync(process.execPath, [SCRIPT, "--user-data", directory, "--mark-price", "100000000"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(stdout.includes(directory), false, "the report must not echo the inspected path back");
  assert.match(stdout, /승인은 앱 화면에서 직접 눌러야만 됩니다/);
});
