const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteAiCalibrationDurableStore } = require("../dist/packages/storage/src/aiCalibrationDurability.js");
const { SqliteAiOutcomeAttributionMemory } = require("../dist/packages/storage/src/aiOutcomeAttributionMemory.js");
const {
  PHASE_ORDER,
  copyForMeasurement,
  measurePhases,
  rankPhases,
  runMeasurement,
} = require("../scripts/measure-startup-phases.js");

// #2770 item 1. The measurement has to run against production-size state, so the only trustworthy way
// to take that measurement is against a copy: a tool that wrote the live ledger while measuring it
// would be worse than the defect it is measuring. These tests pin that property, the fail-closed
// verification of the copy, and the per-phase breakdown the item asks for.

const stores = { DatabaseSync, SqliteDatabase, SqliteAiCalibrationDurableStore, SqliteAiOutcomeAttributionMemory };
const root = path.resolve(__dirname, "..");

function syntheticState() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-measure-"));
  const databasePath = path.join(directory, "state.sqlite");
  // The canonical migrations create every table the phases touch, including the four Risk tables the
  // hot-path probe checks, so a plain open is a complete stand-in for real state.
  const canonical = new SqliteDatabase(databasePath);
  canonical.close();
  return { directory, databasePath };
}

// Windows can hold a file for a moment after its handle closes; a transient EPERM is not a failure.
function cleanup(directory) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 5) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 6 });
    }
  }
}

test("measuring a state database leaves the source byte-for-byte untouched", () => {
  const { directory, databasePath } = syntheticState();
  try {
    const before = fs.readFileSync(databasePath);
    const result = runMeasurement(databasePath, { stores, root });
    const after = fs.readFileSync(databasePath);
    assert.equal(Buffer.compare(before, after), 0, "the live ledger must never be written by a measurement");
    assert.equal(fs.existsSync(`${databasePath}-wal`), false, "measurement must not leave WAL state beside the source");
    assert.equal(result.copyVerified, true);
  } finally {
    cleanup(directory);
  }
});

test("a copy is taken and verified before any phase is trusted", () => {
  const { directory, databasePath } = syntheticState();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-measure-copy-"));
  try {
    const copyPath = copyForMeasurement(databasePath, work);
    assert.notEqual(copyPath, databasePath);
    assert.ok(fs.existsSync(copyPath), "the copy must exist before it is measured");
    assert.equal(Buffer.compare(fs.readFileSync(copyPath), fs.readFileSync(databasePath)), 0);

    const result = runMeasurement(databasePath, { stores, root });
    assert.equal(result.copyVerified, true, "an unverified copy must not produce numbers");
    assert.equal(result.sourceBytes, fs.statSync(databasePath).size);
  } finally {
    cleanup(directory);
    cleanup(work);
  }
});

test("every startup phase is measured in the order the runtime reaches it", () => {
  const { directory, databasePath } = syntheticState();
  try {
    const result = runMeasurement(databasePath, { stores, root });
    for (const name of PHASE_ORDER) {
      assert.ok(result.phases[name], `${name} must be measured`);
      assert.equal(result.phases[name].ok, true, `${name} failed: ${result.phases[name].error}`);
      assert.ok(result.phases[name].ms >= 0);
    }
    assert.equal(result.order, PHASE_ORDER);
    assert.ok(result.ranking.totalMs > 0);
    assert.ok(
      result.ranking.ranked.every((phase, index, all) => index === 0 || all[index - 1].ms >= phase.ms),
      "phases must be ranked by cost",
    );
    assert.ok(
      PHASE_ORDER.indexOf("canonical_open") < PHASE_ORDER.indexOf("ai_calibration_open"),
      "canonical open must be measured first, as the runtime runs it first",
    );
    // The two integrity scans are measured separately so the hot-path saving is a number, not a claim.
    assert.ok(result.phases.full_quick_check_contrast.ok, "the full scan must be measured for contrast");
    assert.ok(result.phases.risk_hot_path_probe.ok, "the O(1) probe must be measured for contrast");
  } finally {
    cleanup(directory);
  }
});

test("a phase that cannot complete is reported as the measurement, not as an abort", () => {
  const { directory, databasePath } = syntheticState();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-measure-phase-"));
  try {
    const copyPath = copyForMeasurement(databasePath, work);
    const canonical = new SqliteDatabase(copyPath);
    const exploding = {
      ...stores,
      SqliteAiCalibrationDurableStore: class {
        constructor() {
          throw new Error("store unavailable");
        }
      },
      // Return the already-open connection so the fixture is not opened twice.
      SqliteDatabase: function Fake() {
        return canonical;
      },
    };
    const phases = measurePhases(copyPath, exploding);
    assert.equal(phases.ai_calibration_open.ok, false);
    assert.match(phases.ai_calibration_open.error, /store unavailable/);
    assert.equal(phases.canonical_open.ok, true, "an unrelated phase must still be measured");
    assert.equal(phases.risk_hot_path_probe.ok, true, "later phases must still be measured");
    assert.equal(phases.ai_calibration_replay.ok, false, "a dependent phase must not report success");
  } finally {
    cleanup(directory);
    cleanup(work);
  }
});

test("ranking names the dominant phase, which is the question item 1 asks", () => {
  const ranking = rankPhases({
    fast: { ok: true, ms: 1 },
    slow: { ok: true, ms: 90 },
    mid: { ok: true, ms: 10 },
    failed: { ok: false, ms: 500, error: "boom" },
  });
  assert.equal(ranking.dominant.name, "slow");
  assert.deepEqual(ranking.ranked.map((phase) => phase.name), ["slow", "mid", "fast"]);
  assert.equal(ranking.totalMs, 101, "a failed phase must not be counted as if it succeeded");
  assert.deepEqual(rankPhases({ onlyFailed: { ok: false, ms: 1, error: "x" } }).dominant, null);
});

test("a missing source fails closed instead of measuring something else", () => {
  assert.throws(() => runMeasurement(path.join(os.tmpdir(), "nusa-does-not-exist.sqlite"), { stores }), /state database not found/);
});

test("the measurement can never become a second runtime", () => {
  const source = fs.readFileSync(path.join(root, "scripts", "measure-startup-phases.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["acquireLease", "startCloudRuntime", "startClosedLearningProductionRuntime", "listen("]) {
    assert.ok(!code.includes(forbidden), `the measurement must not ${forbidden}`);
  }
  // It measures the copy, and never the source.
  assert.match(code, /copyForMeasurement\(/);
  assert.match(code, /measurePhases\(copyPath/);
});
