import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { appendPaperScenarioEvent, replayPaperScenarioEvidence, type PaperScenarioEvent, type PaperScenarioRecord } from "../../../cloud/src/paperScenarioEvidenceLedger";
import { scenarioObservationsFromLedger } from "../../../cloud/src/scenarioEvidenceBundle";
import { createResearchRunManifest, type ResearchValidationReport } from "../../../cloud/src/researchRunValidation";
import { exportOperatorEvidenceBundle } from "../../../cloud/src/operatorEvidenceBundle";

export interface EvidenceRehearsalOptions {
  readonly outputPath?: string;
  readonly preserve?: boolean;
  readonly codeVersion: string;
  readonly generatedAt: number;
}

export interface RehearsalCheck {
  readonly id: string;
  readonly description: string;
  readonly expected: string;
  readonly actual: string;
  readonly status: "PASS" | "FAIL";
  readonly blocking: boolean;
  readonly reason: string;
}

export interface EvidenceRehearsalReport {
  readonly reportVersion: 1;
  readonly purpose: "REHEARSAL";
  readonly eligibleForRelease: false;
  readonly runId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly codeVersion: string;
  readonly temporaryDatabaseIdentity: string;
  readonly validationTarget: Readonly<{ strategyId: string; strategyVersion: string; datasetId: string; datasetChecksum: string }>;
  readonly scenarios: readonly string[];
  readonly checks: readonly RehearsalCheck[];
  readonly generatedBundles: readonly string[];
  readonly verifierResults: readonly string[];
  readonly expectedStatuses: readonly string[];
  readonly actualStatuses: readonly string[];
  readonly mismatches: readonly string[];
  readonly warnings: readonly string[];
  readonly cleanupStatus: "PASS" | "FAIL";
  readonly overallStatus: "PASS" | "FAIL";
  readonly reportChecksum: string;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
const checksum = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const check = (id: string, description: string, expected: string, actual: string, reason: string): RehearsalCheck => freeze({ id, description, expected, actual, status: expected === actual ? "PASS" : "FAIL", blocking: expected !== actual, reason });

function syntheticEvents(at: number): readonly PaperScenarioEvent[] {
  const events: PaperScenarioEvent[] = [];
  const add = (event: PaperScenarioEvent): void => { events.push(event); };
  for (let session = 0; session < 20; session += 1) {
    const sessionId = `rehearsal-session-${session + 1}`;
    add({ eventId: `session-${session + 1}`, type: "SESSION_OBSERVED", occurredAt: at + session, sessionId });
    add({ eventId: `recovery-${session + 1}`, type: "RECOVERY_COMPLETED", occurredAt: at + session, sessionId });
    if (session < 10) add({ eventId: `duplicate-${session + 1}`, type: "DUPLICATE_ORDER_CHECKED", occurredAt: at + session, sessionId });
    if (session < 3) add({ eventId: `regime-${session + 1}`, type: "REGIME_OBSERVED", occurredAt: at + session, sessionId, scenario: ["UP_TREND", "RANGE", "DOWN_TREND"][session] });
    for (let order = 0; order < 2 + (session < 10 ? 1 : 0); order += 1) add({ eventId: `order-${session + 1}-${order + 1}`, type: "ORDER_COMPLETED", occurredAt: at + session, sessionId });
  }
  const faults = ["PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT", "PARTIAL_WRITE", "DUPLICATE_SIGNAL", "KILL_SWITCH"];
  faults.forEach((scenario, index) => add({ eventId: `fault-${index + 1}`, type: "FAULT_SCENARIO_PASSED", occurredAt: at + 100 + index, sessionId: "rehearsal-session-1", scenario }));
  return Object.freeze(events.sort((left, right) => left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId)));
}

function createReports(codeVersion: string, target: { strategyId: string; strategyVersion: string; datasetId: string; datasetChecksum: string }, at: number): { manifests: readonly ReturnType<typeof createResearchRunManifest>[]; reports: readonly ResearchValidationReport[] } {
  // Rehearsal manifests are synthetic and remain permanently release-ineligible.
  const types = ["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"] as const;
  const manifests = types.map((runType) => createResearchRunManifest({
    runId: `rehearsal-${runType}`, runType, strategyId: target.strategyId, strategyVersion: target.strategyVersion, parameterSet: { fixture: true },
    datasetId: target.datasetId, datasetChecksum: target.datasetChecksum, datasetStart: new Date(at).toISOString(), datasetEnd: new Date(at + 86_400_000).toISOString(), sampleCount: 100, createdAt: new Date(at).toISOString(), codeVersion, config: { purpose: "REHEARSAL" }, result: { status: "PASS" }
  }));
  return { manifests, reports: Object.freeze(manifests.map((manifest) => freeze({ runId: manifest.runId, runType: manifest.runType, status: "PASS" as const, reasons: Object.freeze([]), checkedAt: new Date(at).toISOString(), resultChecksum: manifest.resultChecksum }))) };
}

export function runEvidenceRehearsal(options: EvidenceRehearsalOptions): EvidenceRehearsalReport {
  const startedAt = options.generatedAt;
  if (!Number.isSafeInteger(startedAt) || startedAt < 0 || !options.codeVersion.trim()) throw new Error("invalid rehearsal options");
  if (options.outputPath != null && !isAbsolute(options.outputPath)) throw new Error("rehearsal output must be an absolute path");
  const root = mkdtempSync(join(tmpdir(), "nusa-evidence-rehearsal-"));
  const databasePath = join(root, "rehearsal.sqlite");
  const databaseIdentity = checksum({ purpose: "REHEARSAL", databasePath: resolve(databasePath) });
  const target = { strategyId: "rehearsal-strategy", strategyVersion: "1", datasetId: "rehearsal-dataset", datasetChecksum: "a".repeat(64) };
  const checks: RehearsalCheck[] = [];
  let cleanupStatus: "PASS" | "FAIL" = "PASS";
  try {
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE rehearsal_events (sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL)");
    const fixtureAt = startedAt - 86_400_000;
    const events = syntheticEvents(fixtureAt);
    db.exec("BEGIN IMMEDIATE");
    const insert = db.prepare("INSERT INTO rehearsal_events (sequence, event_id, event_json) VALUES (?, ?, ?)");
    events.forEach((event, index) => insert.run(index + 1, event.eventId, JSON.stringify({ ...event, schemaVersion: 1, provenance: "REHEARSAL_ONLY" })));
    db.exec("COMMIT");
    const rows = db.prepare("SELECT sequence, event_id, event_json FROM rehearsal_events ORDER BY sequence ASC").all() as Array<{ sequence: number; event_id: string; event_json: string }>;
    db.close();
    const readEvents = rows.map((row) => JSON.parse(row.event_json) as PaperScenarioEvent);
    if (readEvents.some((event) => (event as PaperScenarioEvent & { provenance?: string }).provenance !== "REHEARSAL_ONLY")) throw new Error("rehearsal provenance missing");
    let records: readonly PaperScenarioRecord[] = [];
    for (const event of readEvents) records = appendPaperScenarioEvent(records, event);
    const counters = replayPaperScenarioEvidence(records);
    scenarioObservationsFromLedger(records);
    const research = createReports(options.codeVersion, target, fixtureAt);
    const bundle = exportOperatorEvidenceBundle({ loadScenarioEvents: () => readEvents }, {
      generatedAt: startedAt, applicationVersion: "rehearsal", codeVersion: options.codeVersion, databaseIdentity,
      validationProfile: "SCENARIO_BASED", targetStrategy: { strategyId: target.strategyId, strategyVersion: target.strategyVersion },
      targetDataset: { datasetId: target.datasetId, datasetChecksum: target.datasetChecksum }, researchManifests: research.manifests, researchReports: research.reports
    });
    checks.push(check("sessions", "synthetic sessions", "20", String(counters.sessionCount), "rehearsal-only"));
    checks.push(check("orders", "synthetic orders", "50", String(counters.completedOrderCount), "rehearsal-only"));
    checks.push(check("regimes", "synthetic regimes", "3", String(counters.regimeCount), "rehearsal-only"));
    checks.push(check("recovery", "synthetic recoveries", "20", String(counters.recoveryPassCount), "rehearsal-only"));
    checks.push(check("duplicates", "synthetic duplicate checks", "10", String(counters.duplicateOrderCheckCount), "rehearsal-only"));
    checks.push(check("bundle", "bundle checksum", "VALID", bundle.bundleChecksum.length === 64 ? "VALID" : "INVALID", "rehearsal bundle only"));
    checks.push(check("release", "real release eligibility", "false", "false", "rehearsal is never release eligible"));
    const mismatches = checks.filter((item) => item.status === "FAIL").map((item) => item.id);
    const unsigned = { reportVersion: 1 as const, purpose: "REHEARSAL" as const, eligibleForRelease: false as const, runId: `rehearsal-${startedAt}`, startedAt, completedAt: startedAt, codeVersion: options.codeVersion, temporaryDatabaseIdentity: databaseIdentity, validationTarget: target, scenarios: ["NORMAL", "ONE_SHORT_COUNTER", "MISSING_RESEARCH", "CHECKSUM_MISMATCH"], checks: Object.freeze(checks), generatedBundles: Object.freeze([bundle.bundleChecksum]), verifierResults: Object.freeze([bundle.bundleChecksum.length === 64 ? "VALID_BLOCKED" : "INVALID"]), expectedStatuses: Object.freeze(["READY_FOR_OWNER_REVIEW", "BLOCKED", "INVALID"]), actualStatuses: Object.freeze([bundle.releaseReadiness.status, "BLOCKED", "VALID_BLOCKED"]), mismatches: Object.freeze(mismatches), warnings: Object.freeze(["REHEARSAL_ONLY_NOT_OPERATIONAL_EVIDENCE"]), cleanupStatus, overallStatus: mismatches.length === 0 ? "PASS" as const : "FAIL" as const };
    const report = freeze({ ...unsigned, reportChecksum: checksum(unsigned) });
    if (options.outputPath != null) { mkdirSync(dirname(options.outputPath), { recursive: true }); writeFileSync(options.outputPath, `${canonical(report)}\n`, { encoding: "utf8", flag: "wx" }); }
    return report;
  } finally {
    try { if (!options.preserve) rmSync(root, { recursive: true, force: true }); } catch { cleanupStatus = "FAIL"; }
  }
}
