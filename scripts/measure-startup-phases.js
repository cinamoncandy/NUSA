#!/usr/bin/env node
"use strict";

/**
 * #2770 item 1 -- measure the startup phases that consume the Oracle readiness budget.
 *
 * The two startup defects in #2770 shared one mechanism: full-file work running while the
 * renewable PAPER writer lease is held, starving its heartbeat, and the readiness window expiring
 * before the listener ever bound. Fixing the ordering (#2779) and the per-evaluation integrity probe
 * (#2779) addresses the symptom, but item 1 asks for the measurement itself: which phase actually
 * consumes the budget, at real state size.
 *
 * This script times each storage phase in the order `startClosedLearningProductionRuntime` runs it,
 * against a COPY of the state database, and reports a per-phase breakdown.
 *
 * All three phases open one file, and that is production topology rather than a shortcut: the
 * canonical `SqliteDatabase` opens `config.cloudStateDbPath`, while both AI stores resolve their
 * path through `implicitDurabilityPath(env)`, which returns the same `NUSA_CLOUD_STATE_DB_PATH`
 * (apps/cloud/src/ai/runtime.ts:278-283). The state database is therefore integrity-scanned three
 * times per startup, each by its own connection. Measuring them on separate files would describe a
 * runtime that does not exist; measuring them here reports the repeated cost the runtime really pays.
 *
 *
 * Safety, in order of importance:
 *   1. The source database is never opened for writing. It is copied to a temporary directory and
 *      every measurement runs against the copy. A live runtime keeps writing the source untouched.
 *   2. The copy is verified with a full `PRAGMA quick_check` before any measurement. An inconsistent
 *      copy (the source was mid-write when it was taken) fails closed rather than producing numbers
 *      that quietly describe a corrupt file.
 *   3. Nothing here acquires the writer lease, binds the dashboard port, or starts a scheduler. This
 *      is a measurement tool and can never become a second runtime.
 *   4. Every phase is bounded by construction -- each is a single constructor or a single call.
 *
 * Usage:
 *   node scripts/measure-startup-phases.js                # uses NUSA_CLOUD_STATE_DB_PATH
 *   node scripts/measure-startup-phases.js /path/state.sqlite
 *   node scripts/measure-startup-phases.js --keep         # leave the copy for inspection
 *   node scripts/measure-startup-phases.js --json         # machine-readable only (default)
 *   node scripts/measure-startup-phases.js --human        # human-readable summary
 *
 * Exit codes: 0 measured, 1 failed (missing source, missing build, unverifiable copy).
 */

const { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Mirrors apps/cloud/src/cloudPaperCanonicalRiskGateway.ts:107 -- the O(1) hot-path probe. */
const REQUIRED_RISK_TABLES = Object.freeze(["risk_paper_approvals", "risk_daily_loss_state", "risk_idempotency_records", "risk_order_state"]);

/** Phases run in the order startClosedLearningProductionRuntime reaches them. */
const PHASE_ORDER = Object.freeze([
  "canonical_open",
  "ai_calibration_open",
  "ai_calibration_replay",
  "ai_attribution_open",
  "risk_hot_path_probe",
  "full_quick_check_contrast",
]);

const elapsedMs = (startedAtNs) => Number(process.hrtime.bigint() - startedAtNs) / 1e6;

/**
 * Copies the state database and its WAL sidecars into `destination` and returns the copy's path.
 * The source is only ever read. Sidecars are copied when present so the copy is as complete as the
 * filesystem allows; step 2 of the safety contract decides whether it is usable.
 */
function copyForMeasurement(sourcePath, destination) {
  const target = path.join(destination, path.basename(sourcePath));
  copyFileSync(sourcePath, target);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${sourcePath}${suffix}`;
    if (existsSync(sidecar)) copyFileSync(sidecar, `${target}${suffix}`);
  }
  return target;
}

/**
 * Times one phase. A throwing phase is recorded as failed rather than aborting the run, because a
 * phase that cannot complete at real state size is itself the measurement.
 */
function timePhase(target, name, run) {
  const startedAtNs = process.hrtime.bigint();
  try {
    run();
    target[name] = { ok: true, ms: Number(elapsedMs(startedAtNs).toFixed(3)) };
  } catch (error) {
    target[name] = { ok: false, ms: Number(elapsedMs(startedAtNs).toFixed(3)), error: error instanceof Error ? error.message : "unknown error" };
  }
}

/**
 * Runs every phase against an already-copied, already-verified database. `stores` supplies the
 * storage constructors so a test can inject fakes without touching real state.
 */
function measurePhases(copyPath, stores) {
  const { SqliteDatabase, SqliteAiCalibrationDurableStore, SqliteAiOutcomeAttributionMemory, DatabaseSync } = stores;
  const phases = {};

  // 1. Canonical open: migrations plus the once-per-open full integrity scan. This is the scan the
  //    work order requires to be retained, so it is measured rather than assumed cheap.
  let canonical;
  timePhase(phases, "canonical_open", () => { canonical = new SqliteDatabase(copyPath); });

  // 2-3. AI calibration durability: the same file's own integrity scan, then the hash-chain replay.
  //      A replay whose store never opened must be reported as failed, not as a zero-cost success,
  //      or the ranking would quietly understate the phase it is trying to measure.
  let calibration;
  timePhase(phases, "ai_calibration_open", () => { calibration = new SqliteAiCalibrationDurableStore(copyPath); });
  timePhase(phases, "ai_calibration_replay", () => {
    if (calibration == null) throw new Error("calibration store did not open, so no replay occurred");
    calibration.replay();
  });
  try { calibration?.close(); } catch { /* already closed by a failed open */ }

  // 4. AI outcome-attribution memory: schema, integrity scan, and replay happen in the constructor.
  let attribution;
  timePhase(phases, "ai_attribution_open", () => {
    attribution = new SqliteAiOutcomeAttributionMemory(copyPath);
    attribution.close();
  });

  // 5. The per-evaluation risk hot path as shipped: an O(1) liveness probe plus required-table
  //    presence. This is what replaced the full-file scan on every evaluation.
  timePhase(phases, "risk_hot_path_probe", () => {
    const connection = canonical.connection;
    const ready = connection.prepare("SELECT 1 AS ready").get();
    if (Number(ready.ready) !== 1) throw new Error("risk liveness probe did not return 1");
    for (const table of REQUIRED_RISK_TABLES) {
      const row = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (row == null) throw new Error(`required Risk table is missing: ${table}`);
    }
  });

  // 6. Contrast: what a full-file scan costs on its own, so the hot-path saving is a measured number
  //    rather than an argument.
  timePhase(phases, "full_quick_check_contrast", () => {
    const check = canonical.connection.prepare("PRAGMA quick_check").get();
    if (check == null || !Object.values(check).includes("ok")) throw new Error("sqlite quick_check failed");
  });

  try { canonical.close(); } catch { /* already closed by a failed open */ }
  return phases;
}

/** Loads the built storage layer. The script measures shipped code, never TypeScript sources. */
function loadStores(root) {
  const base = path.join(root, "dist", "packages", "storage", "src");
  const entry = path.join(base, "index.js");
  if (!existsSync(entry)) throw new Error(`build output missing: ${entry} -- run the build first`);
  const { DatabaseSync } = require("node:sqlite");
  const { SqliteDatabase } = require(entry);
  const { SqliteAiCalibrationDurableStore } = require(path.join(base, "aiCalibrationDurability.js"));
  const { SqliteAiOutcomeAttributionMemory } = require(path.join(base, "aiOutcomeAttributionMemory.js"));
  return { DatabaseSync, SqliteDatabase, SqliteAiCalibrationDurableStore, SqliteAiOutcomeAttributionMemory };
}

/** Orders phases by cost and names the dominant one, which is the question item 1 asks. */
function rankPhases(phases) {
  const measured = Object.entries(phases)
    .filter(([, result]) => result.ok)
    .map(([name, result]) => ({ name, ms: result.ms }))
    .sort((left, right) => right.ms - left.ms);
  const totalMs = Number(measured.reduce((sum, phase) => sum + phase.ms, 0).toFixed(3));
  return { totalMs, dominant: measured[0] ?? null, ranked: measured };
}

function runMeasurement(sourcePath, options = {}) {
  const { stores = loadStores(options.root ?? path.resolve(__dirname, "..")), temporaryDirectory } = options;
  if (!existsSync(sourcePath)) throw new Error(`state database not found: ${sourcePath}`);

  const directory = temporaryDirectory ?? mkdtempSync(path.join(os.tmpdir(), "nusa-startup-measure-"));
  const copyPath = copyForMeasurement(sourcePath, directory);
  try {
    // Verify the copy before trusting it: a copy taken mid-write must not yield plausible numbers.
    const verifier = new stores.SqliteDatabase(copyPath);
    const check = verifier.connection.prepare("PRAGMA quick_check").get();
    const copyVerified = check != null && Object.values(check).includes("ok");
    verifier.close();
    if (!copyVerified) throw new Error("the measurement copy failed quick_check; the source was likely mid-write");

    const phases = measurePhases(copyPath, stores);
    const ranking = rankPhases(phases);
    return {
      sourcePath,
      sourceBytes: statSync(sourcePath).size,
      copyVerified,
      phases,
      ranking,
      order: PHASE_ORDER,
    };
  } finally {
    if (!options.keep && !temporaryDirectory) rmSync(directory, { recursive: true, force: true });
  }
}

function formatHuman(result) {
  const lines = [
    `source: ${result.sourcePath} (${(result.sourceBytes / 1024 / 1024).toFixed(1)} MiB)`,
    `copy verified before measurement: ${result.copyVerified}`,
    "",
    "phase                              ms      ok",
  ];
  for (const name of PHASE_ORDER) {
    const phase = result.phases[name];
    if (phase == null) continue;
    lines.push(`${name.padEnd(34)} ${phase.ms.toFixed(3).padStart(10)}  ${phase.ok ? "yes" : `NO -- ${phase.error}`}`);
  }
  lines.push("");
  lines.push(`total ${result.ranking.totalMs.toFixed(3)} ms`);
  if (result.ranking.dominant) lines.push(`dominant phase: ${result.ranking.dominant.name} (${result.ranking.dominant.ms.toFixed(3)} ms)`);
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const keep = argv.includes("--keep");
  const human = argv.includes("--human");
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const sourcePath = path.resolve(positional[0] ?? process.env.NUSA_CLOUD_STATE_DB_PATH ?? "");
  if (sourcePath === "" || !existsSync(sourcePath)) {
    process.stderr.write(`state database not found: ${sourcePath || "(set NUSA_CLOUD_STATE_DB_PATH or pass a path)"}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = runMeasurement(sourcePath, { keep });
    process.stdout.write(`${human ? `${formatHuman(result)}\n` : `${JSON.stringify(result, null, 2)}\n`}`);
  } catch (error) {
    process.stderr.write(`startup phase measurement failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  PHASE_ORDER,
  REQUIRED_RISK_TABLES,
  copyForMeasurement,
  loadStores,
  measurePhases,
  rankPhases,
  runMeasurement,
  timePhase,
};
