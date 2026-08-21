import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { OperatorEvidenceBundle } from "../../../cloud/src/operatorEvidenceBundle";
import { exportOperatorEvidenceBundle, verifyOperatorEvidenceBundle } from "../../../cloud/src/operatorEvidenceBundle";
import { replayPaperScenarioEvidence, appendPaperScenarioEvent, type PaperScenarioRecord } from "../../../cloud/src/paperScenarioEvidenceLedger";
import { DesktopPersistenceStore } from "../persistence/desktopPersistenceStore";

export interface EvidenceStatus {
  readonly database: "evaluated" | "not evaluated";
  readonly observedSessions: Readonly<{ current: number; required: number }>;
  readonly completedOrders: Readonly<{ current: number; required: number }>;
  readonly representedRegimes: Readonly<{ current: number; required: number }>;
  readonly restartRecoveryPasses: Readonly<{ current: number; required: number }>;
  readonly duplicateChecks: Readonly<{ current: number; required: number }>;
  readonly faultScenarios: readonly string[] | "NOT_EVALUATED";
  readonly walkForward: "PASS" | "FAIL" | "NOT_EVALUATED";
  readonly costStress: "PASS" | "FAIL" | "NOT_EVALUATED";
  readonly monteCarlo: "PASS" | "FAIL" | "NOT_EVALUATED";
  readonly integrity: "PASS" | "FAIL" | "NOT_EVALUATED";
  readonly bundle: "PASS" | "FAIL" | "NOT_EVALUATED";
  readonly ownerReview: "COMPLETED" | "NOT_COMPLETED";
  readonly releaseStatus: "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED";
  readonly blockingReasons: readonly string[];
}

export interface EvidenceExportOptions {
  readonly databasePath: string;
  readonly outputPath: string;
  readonly generatedAt: number;
  readonly applicationVersion: string;
  readonly codeVersion: string;
  readonly targetStrategy: Readonly<{ strategyId: string; strategyVersion: string }>;
  readonly targetDataset: Readonly<{ datasetId: string; datasetChecksum: string }>;
}

export function assertSafeExistingDatabase(databasePath: string): string {
  if (!isAbsolute(databasePath)) throw new Error("database path must be absolute");
  const resolved = resolve(databasePath);
  if (!existsSync(resolved)) throw new Error("database was not found");
  const stats = lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("database must be a regular file");
  if (!resolved.toLowerCase().endsWith(".db") && !resolved.toLowerCase().endsWith(".sqlite")) throw new Error("database extension is not allowed");
  return resolved;
}

function databaseIdentity(databasePath: string): string {
  const stats = statSync(databasePath);
  return createHash("sha256").update(JSON.stringify({ purpose: "OPERATOR_EVIDENCE", size: stats.size, modifiedAt: stats.mtimeMs }), "utf8").digest("hex");
}

function openReadOnly(databasePath: string): DesktopPersistenceStore {
  return new DesktopPersistenceStore(assertSafeExistingDatabase(databasePath), { readOnly: true });
}

function replayFromStore(store: DesktopPersistenceStore): { records: readonly PaperScenarioRecord[]; counters: ReturnType<typeof replayPaperScenarioEvidence> } {
  let records: readonly PaperScenarioRecord[] = [];
  for (const event of store.loadScenarioEvents()) records = appendPaperScenarioEvent(records, event);
  return { records, counters: replayPaperScenarioEvidence(records) };
}

export function readEvidenceStatus(databasePath?: string, bundlePath?: string): EvidenceStatus {
  const verifyBundle = (): "PASS" | "FAIL" | "NOT_EVALUATED" => {
    if (bundlePath == null) return "NOT_EVALUATED";
    try {
      verifyEvidenceBundle(bundlePath);
      return "PASS";
    } catch {
      return "FAIL";
    }
  };
  const notEvaluated = (reason: string): EvidenceStatus => ({
    database: "not evaluated",
    observedSessions: { current: 0, required: 20 },
    completedOrders: { current: 0, required: 50 },
    representedRegimes: { current: 0, required: 3 },
    restartRecoveryPasses: { current: 0, required: 3 },
    duplicateChecks: { current: 0, required: 10 },
    faultScenarios: "NOT_EVALUATED",
    walkForward: "NOT_EVALUATED",
    costStress: "NOT_EVALUATED",
    monteCarlo: "NOT_EVALUATED",
    integrity: "NOT_EVALUATED",
    bundle: verifyBundle(),
    ownerReview: "NOT_COMPLETED",
    releaseStatus: "BLOCKED",
    blockingReasons: Object.freeze([reason, "OWNER_REVIEW_REQUIRED"])
  });

  if (databasePath == null) return notEvaluated("DATABASE_NOT_EVALUATED");

  let store: DesktopPersistenceStore | undefined;
  try {
    store = openReadOnly(databasePath);
    const { records, counters } = replayFromStore(store);
    const reports = store.loadResearchValidationReports();
    const reviews = store.loadOwnerReviews();
    const statusFor = (runType: "WALK_FORWARD" | "COST_STRESS" | "MONTE_CARLO" | "INTEGRITY_CHECK"): "PASS" | "FAIL" | "NOT_EVALUATED" => {
      const matching = reports.filter((report) => report.runType === runType);
      if (matching.length === 0) return "NOT_EVALUATED";
      return matching.some((report) => report.status === "PASS") ? "PASS" : "FAIL";
    };
    const representedRegimeCount = new Set(records.map((record) => record.event.type === "REGIME_OBSERVED" ? record.event.scenario : undefined).filter((value): value is string => value != null)).size;
    const bundle = verifyBundle();
    return {
      database: "evaluated",
      observedSessions: { current: counters.sessionCount, required: 20 },
      completedOrders: { current: counters.completedOrderCount, required: 50 },
      representedRegimes: { current: representedRegimeCount, required: 3 },
      restartRecoveryPasses: { current: counters.recoveryPassCount, required: 3 },
      duplicateChecks: { current: counters.duplicateOrderCheckCount, required: 10 },
      faultScenarios: Object.freeze([...counters.passedFaultScenarios].sort()),
      walkForward: statusFor("WALK_FORWARD"),
      costStress: statusFor("COST_STRESS"),
      monteCarlo: statusFor("MONTE_CARLO"),
      integrity: statusFor("INTEGRITY_CHECK"),
      bundle,
      ownerReview: reviews.length > 0 ? "COMPLETED" : "NOT_COMPLETED",
      releaseStatus: "BLOCKED",
      blockingReasons: Object.freeze([
        "REAL_PAPER_EVIDENCE_REQUIRES_OPERATOR_REVIEW",
        ...(reports.length === 0 ? ["RESEARCH_REPORTS_NOT_EVALUATED"] : []),
        ...(reviews.length === 0 ? ["OWNER_REVIEW_REQUIRED"] : [])
      ])
    };
  } catch {
    return notEvaluated("DATABASE_READ_FAILED");
  } finally {
    store?.close();
  }
}

export function exportEvidence(options: EvidenceExportOptions): OperatorEvidenceBundle {
  if (!Number.isSafeInteger(options.generatedAt) || options.generatedAt < 0) throw new Error("generatedAt is invalid");
  if (!isAbsolute(options.outputPath)) throw new Error("output path must be absolute");
  const databasePath = assertSafeExistingDatabase(options.databasePath);
  const outputPath = resolve(options.outputPath);
  if (outputPath === databasePath) throw new Error("output must differ from database");
  let store: DesktopPersistenceStore | undefined;
  try {
    store = openReadOnly(databasePath);
    const bundle = exportOperatorEvidenceBundle(store, {
      generatedAt: options.generatedAt,
      applicationVersion: options.applicationVersion,
      codeVersion: options.codeVersion,
      databaseIdentity: databaseIdentity(databasePath),
      validationProfile: "SCENARIO_BASED",
      targetStrategy: options.targetStrategy,
      targetDataset: options.targetDataset
    });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(bundle), { encoding: "utf8", flag: "wx" });
    return bundle;
  } finally {
    store?.close();
  }
}

export function verifyEvidenceBundle(bundlePath: string): OperatorEvidenceBundle {
  if (!isAbsolute(bundlePath)) throw new Error("bundle path must be absolute");
  const resolved = resolve(bundlePath);
  if (!existsSync(resolved)) throw new Error("bundle was not found");
  const stats = lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("bundle must be a regular file");
  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as OperatorEvidenceBundle;
  return verifyOperatorEvidenceBundle(parsed);
}
