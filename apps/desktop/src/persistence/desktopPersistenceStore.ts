import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../../../../packages/storage/src/migrationRunner";
import type { ControlPlaneState } from "../control/controlPlane";
import type { PaperBrokerState, PaperOrder } from "../paper/paperBroker";
import type { PaperScenarioEvent } from "../../../cloud/src/paperScenarioEvidenceLedger";
import { validateResearchRunManifest, type ResearchRunManifest, type ResearchValidationReport } from "../../../cloud/src/researchRunValidation";
import type { OwnerReviewRecord } from "../../../cloud/src/releaseEvidenceDashboard";
import type { PaperSafetySnapshot } from "../../../../packages/contracts/src/paperSafetySnapshot";
import { validatePaperSafetySnapshot } from "../paper/paperSafetySnapshot";
import { SqliteDurableExecutionRepository } from "../../../../packages/storage/src/durable-execution";
import { SqliteRiskEvidenceRepository } from "../../../../packages/storage/src/risk-evidence";
import { SqliteRiskSafetyPersistence } from "../../../../packages/storage/src/risk-safety";
import { replayCommitteeLedger, type CommitteeLedgerRecord, type RecordedCommitteeDecision } from "../../../cloud/src/investmentCommitteeLedger";
import type { OpportunitySchedule } from "../../../cloud/src/opportunityScheduler";
import { validateOpportunitySchedule } from "../cloud/opportunityDashboardProjection";

const SCENARIO_EVENT_TYPES = new Set(["SESSION_OBSERVED", "ORDER_COMPLETED", "REGIME_OBSERVED", "RECOVERY_COMPLETED", "DUPLICATE_ORDER_CHECKED", "FAULT_SCENARIO_PASSED"]);
const RESEARCH_RUN_TYPES = new Set(["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"]);
const SHA256 = /^[a-f0-9]{64}$/i;

export interface DesktopPersistenceState { readonly paper: PaperBrokerState; readonly control: ControlPlaneState; }
export interface OperationsAuditRecord { readonly auditId: string; readonly actor: string; readonly action: string; readonly target: string | null; readonly metadata: Readonly<Record<string, unknown>>; readonly createdAt: string; }
export interface OperationsAlertRecord { readonly alertId: string; readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; readonly source: string; readonly code: string; readonly message: string; readonly createdAt: string; }

const migrations = [{ id: "001_desktop_runtime", sql: `
CREATE TABLE desktop_account_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
CREATE TABLE desktop_orders (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE desktop_control_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
CREATE TABLE desktop_control_events (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE desktop_processed_signal_keys (signal_key TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE);
CREATE TABLE desktop_imports (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
` }, { id: "002_desktop_scenario_evidence", sql: `
CREATE TABLE desktop_paper_scenario_evidence (sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL);
` }, { id: "003_desktop_research_evidence", sql: `
CREATE TABLE desktop_research_manifests (run_id TEXT PRIMARY KEY, run_type TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_checksum TEXT NOT NULL, manifest_json TEXT NOT NULL);
CREATE TABLE desktop_research_reports (run_id TEXT NOT NULL, run_type TEXT NOT NULL, report_json TEXT NOT NULL, PRIMARY KEY (run_id, run_type));
` }, { id: "004_desktop_owner_reviews", sql: `
CREATE TABLE desktop_owner_review_records (review_id TEXT PRIMARY KEY, bundle_checksum TEXT NOT NULL, reviewer_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT, reviewed_at TEXT NOT NULL, record_checksum TEXT NOT NULL UNIQUE);
` }, { id: "005_desktop_strategy_state", sql: `
CREATE TABLE desktop_strategy_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
` }, { id: "006_desktop_paper_safety_snapshot", sql: `
CREATE TABLE desktop_paper_safety_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
` }, { id: "007_desktop_operations", sql: `
CREATE TABLE desktop_operations_audit (audit_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE desktop_operations_alerts (alert_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, severity TEXT NOT NULL, payload TEXT NOT NULL);
` }, { id: "008_desktop_opportunity_schedules", sql: `
CREATE TABLE desktop_opportunity_schedules (schedule_id TEXT PRIMARY KEY, source TEXT NOT NULL, generated_at INTEGER NOT NULL, payload TEXT NOT NULL, payload_checksum TEXT NOT NULL UNIQUE);
` }, { id: "009_desktop_risk_safety", sql: `
CREATE TABLE risk_paper_approvals (approval_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('VALID', 'REVOKED')));
CREATE TABLE risk_daily_loss_state (account_id TEXT PRIMARY KEY, trading_day TEXT NOT NULL, day_start_equity REAL NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE risk_idempotency_records (account_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_id TEXT NOT NULL, signal_id TEXT NOT NULL, client_order_id TEXT NOT NULL, payload_fingerprint TEXT NOT NULL, created_at_ms INTEGER NOT NULL, PRIMARY KEY(account_id, idempotency_key), UNIQUE(account_id, command_id), UNIQUE(account_id, signal_id), UNIQUE(account_id, client_order_id));
CREATE TABLE risk_order_state (account_id TEXT NOT NULL, order_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPEN', 'PENDING', 'FILLED', 'CANCELLED', 'REJECTED')), updated_at_ms INTEGER NOT NULL, PRIMARY KEY(account_id, order_id));
` }];

export class DesktopPersistenceStore {
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;

  constructor(filename: string, options: Readonly<{ readOnly?: boolean }> = {}) {
    this.readOnly = options.readOnly === true;
    if (!this.readOnly) mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, this.readOnly ? { readOnly: true } : {});
    try {
      if (this.readOnly) this.verifyStartupIntegrity();
      else {
        this.configureSafetyPragmas();
        this.verifyStartupIntegrity();
        runMigrations(this.db, migrations);
      }
    } catch (error) {
      this.db.close();
      throw new Error("desktop persistence startup verification failed", { cause: error });
    }
  }

  load(): DesktopPersistenceState | undefined {
    const account = this.db.prepare("SELECT payload FROM desktop_account_state WHERE id = 1").get() as { payload: string } | undefined;
    const control = this.db.prepare("SELECT payload FROM desktop_control_state WHERE id = 1").get() as { payload: string } | undefined;
    if (account == null && control == null) return undefined;
    if (account == null || control == null) throw new Error("partial desktop persistence state");
    const paperBase = JSON.parse(account.payload) as Omit<PaperBrokerState, "orders">;
    const controlBase = JSON.parse(control.payload) as Omit<ControlPlaneState, "events" | "processedSignalKeys">;
    const orders = (this.db.prepare("SELECT payload FROM desktop_orders ORDER BY ordinal").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as PaperOrder);
    const events = (this.db.prepare("SELECT payload FROM desktop_control_events ORDER BY ordinal").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as ControlPlaneState["events"][number]);
    const processedSignalKeys = (this.db.prepare("SELECT signal_key FROM desktop_processed_signal_keys ORDER BY ordinal").all() as Array<{ signal_key: string }>).map((row) => row.signal_key);
    return { paper: { ...paperBase, orders }, control: { ...controlBase, events, processedSignalKeys } };
  }

  importLegacy(state: DesktopPersistenceState): boolean {
    if (this.load() != null) return false;
    return this.transaction(() => {
      const imported = this.db.prepare("SELECT 1 FROM desktop_imports WHERE source = 'paper-control-json'").get();
      if (imported != null) return false;
      this.write(state);
      this.db.prepare("INSERT INTO desktop_imports (source, imported_at) VALUES (?, ?)").run("paper-control-json", new Date().toISOString());
      return true;
    });
  }

  save(paper: PaperBrokerState, control: ControlPlaneState): void {
    this.transaction(() => this.write({ paper, control }));
  }

  saveWithPaperSafetySnapshot(paper: PaperBrokerState, control: ControlPlaneState, snapshot: PaperSafetySnapshot): void {
    validatePaperSafetySnapshot(snapshot);
    this.transaction(() => {
      this.write({ paper, control });
      this.writePaperSafetySnapshot(snapshot);
    });
  }

  /** The snapshot is replaced in a SQLite transaction: readers see either the prior valid snapshot or the new one. */
  savePaperSafetySnapshot(snapshot: PaperSafetySnapshot): void {
    validatePaperSafetySnapshot(snapshot);
    this.transaction(() => {
      this.writePaperSafetySnapshot(snapshot);
    });
  }

  loadPaperSafetySnapshot(): PaperSafetySnapshot | undefined {
    const row = this.db.prepare("SELECT payload FROM desktop_paper_safety_snapshot WHERE id = 1").get() as { payload: string } | undefined;
    if (row == null) return undefined;
    let snapshot: unknown;
    try { snapshot = JSON.parse(row.payload); } catch (error) { throw new Error("paper safety snapshot JSON is invalid", { cause: error }); }
    try { validatePaperSafetySnapshot(snapshot); } catch (error) { throw new Error("paper safety snapshot validation failed", { cause: error }); }
    return Object.freeze(snapshot);
  }

  /**
   * Best-effort continuity data only: the strategy's recent tick price history, so a
   * restart doesn't need to silently re-warm-up from zero. Deliberately independent
   * of save()/saveWithScenarioEvent(s) -- it carries no accounting or control-audit
   * meaning, so a failure here must never affect paperTradingAvailable or trigger the
   * fail-closed evidence path those methods use.
   */
  saveStrategyPriceHistory(prices: readonly number[]): void {
    if (!prices.every((price) => Number.isFinite(price) && price > 0)) {
      throw new Error("strategy price history must contain only positive finite numbers");
    }
    this.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO desktop_strategy_state (id, payload) VALUES (1, ?)").run(JSON.stringify({ version: 1, priceHistory: prices }));
    });
  }

  loadStrategyPriceHistory(): readonly number[] | undefined {
    const row = this.db.prepare("SELECT payload FROM desktop_strategy_state WHERE id = 1").get() as { payload: string } | undefined;
    if (row == null) return undefined;
    const parsed = JSON.parse(row.payload) as { version?: number; priceHistory?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.priceHistory) || !parsed.priceHistory.every((price) => Number.isFinite(price) && price > 0)) {
      throw new Error("stored strategy price history is invalid");
    }
    return parsed.priceHistory as readonly number[];
  }

  saveWithScenarioEvent(paper: PaperBrokerState, control: ControlPlaneState, event: PaperScenarioEvent): void {
    this.saveWithScenarioEvents(paper, control, [event]);
  }

  saveWithScenarioEvents(paper: PaperBrokerState, control: ControlPlaneState, events: readonly PaperScenarioEvent[]): void {
    this.saveWithScenarioEventsAndPaperSafetySnapshot(paper, control, events, undefined);
  }

  saveWithScenarioEventsAndPaperSafetySnapshot(paper: PaperBrokerState, control: ControlPlaneState, events: readonly PaperScenarioEvent[], snapshot: PaperSafetySnapshot | undefined): void {
    if (events.length === 0) throw new Error("scenario evidence batch must not be empty");
    if (snapshot) validatePaperSafetySnapshot(snapshot);
    this.transaction(() => {
      this.write({ paper, control });
      if (snapshot) this.writePaperSafetySnapshot(snapshot);
      let next = Number((this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM desktop_paper_scenario_evidence").get() as { sequence: number }).sequence) + 1;
      const insert = this.db.prepare("INSERT INTO desktop_paper_scenario_evidence (sequence, event_id, event_json) VALUES (?, ?, ?)");
      for (const event of events) {
        insert.run(next, event.eventId, JSON.stringify(event));
        next += 1;
      }
    });
  }

  loadScenarioEvents(): readonly PaperScenarioEvent[] {
    const rows = this.db.prepare("SELECT sequence, event_id, event_json FROM desktop_paper_scenario_evidence ORDER BY sequence ASC").all() as Array<{ sequence: number; event_id: string; event_json: string }>;
    const events: PaperScenarioEvent[] = [];
    let expectedSequence = 1;
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.sequence !== expectedSequence) throw new Error("scenario evidence sequence is not contiguous");
      expectedSequence += 1;
      if (ids.has(row.event_id)) throw new Error("duplicate scenario evidence event id");
      ids.add(row.event_id);
      let event: PaperScenarioEvent;
      try { event = JSON.parse(row.event_json) as PaperScenarioEvent; } catch (error) { throw new Error("scenario evidence event JSON is invalid", { cause: error }); }
      if (event.eventId !== row.event_id) throw new Error("scenario evidence DB/event ID mismatch");
      if (!SCENARIO_EVENT_TYPES.has(event.type)) throw new Error("unsupported scenario evidence event type");
      if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("scenario evidence occurredAt is invalid");
      if (event.sessionId !== undefined && (!event.sessionId || typeof event.sessionId !== "string")) throw new Error("scenario evidence sessionId is invalid");
      if (event.scenario !== undefined && (!event.scenario || typeof event.scenario !== "string")) throw new Error("scenario evidence scenario is invalid");
      events.push(Object.freeze({ ...event }));
    }
    for (let index = 1; index < events.length; index += 1) if (events[index]!.occurredAt < events[index - 1]!.occurredAt) throw new Error("scenario evidence ordering is invalid");
    return Object.freeze(events);
  }

  loadScenarioEvidenceRecords(): readonly PaperScenarioEvent[] {
    return this.loadScenarioEvents();
  }

  appendResearchRunManifest(manifest: ResearchRunManifest): void {
    validateResearchRunManifest(manifest);
    this.transaction(() => {
      const existing = this.db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(manifest.runId) as { manifest_json: string } | undefined;
      const payload = JSON.stringify(manifest);
      if (existing != null) {
        if (existing.manifest_json !== payload) throw new Error("research manifest identity conflict");
        return;
      }
      this.db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(manifest.runId, manifest.runType, manifest.strategyId, manifest.strategyVersion, manifest.datasetId, manifest.datasetChecksum, payload);
    });
  }

  loadResearchRunManifests(): readonly ResearchRunManifest[] {
    const rows = this.db.prepare("SELECT manifest_json FROM desktop_research_manifests ORDER BY run_id ASC").all() as Array<{ manifest_json: string }>;
    return Object.freeze(rows.map((row) => this.parseResearchManifest(row.manifest_json)));
  }

  appendResearchValidationReport(report: ResearchValidationReport): void {
    this.assertResearchReport(report);
    this.transaction(() => {
      const manifest = this.db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(report.runId) as { manifest_json: string } | undefined;
      if (manifest == null) throw new Error("research report manifest is missing");
      const parsedManifest = this.parseResearchManifest(manifest.manifest_json);
      if (parsedManifest.runType !== report.runType || parsedManifest.resultChecksum !== report.resultChecksum) throw new Error("research report does not match manifest");
      const existing = this.db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(report.runId, report.runType) as { report_json: string } | undefined;
      const payload = JSON.stringify(report);
      if (existing != null) {
        if (existing.report_json !== payload) throw new Error("research validation report identity conflict");
        return;
      }
      this.db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(report.runId, report.runType, payload);
    });
  }

  appendResearchEvidence(manifest: ResearchRunManifest, report: ResearchValidationReport): void {
    validateResearchRunManifest(manifest);
    this.assertResearchReport(report);
    if (manifest.runId !== report.runId || manifest.runType !== report.runType) throw new Error("research evidence manifest/report identity mismatch");
    if (manifest.resultChecksum !== report.resultChecksum) throw new Error("research evidence result checksum mismatch");
    this.transaction(() => {
      const manifestPayload = JSON.stringify(manifest);
      const reportPayload = JSON.stringify(report);
      const existingManifest = this.db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(manifest.runId) as { manifest_json: string } | undefined;
      const existingReport = this.db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(report.runId, report.runType) as { report_json: string } | undefined;
      if (existingManifest != null && existingManifest.manifest_json !== manifestPayload) throw new Error("research manifest identity conflict");
      if (existingReport != null && existingReport.report_json !== reportPayload) throw new Error("research validation report identity conflict");
      if (existingManifest == null) {
        this.db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(manifest.runId, manifest.runType, manifest.strategyId, manifest.strategyVersion, manifest.datasetId, manifest.datasetChecksum, manifestPayload);
      }
      if (existingReport == null) this.db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(report.runId, report.runType, reportPayload);
    });
  }

  loadResearchValidationReports(): readonly ResearchValidationReport[] {
    const rows = this.db.prepare("SELECT report_json FROM desktop_research_reports ORDER BY run_id ASC, run_type ASC").all() as Array<{ report_json: string }>;
    const manifests = new Map(this.loadResearchRunManifests().map((manifest) => [manifest.runId, manifest]));
    return Object.freeze(rows.map((row) => {
      let report: ResearchValidationReport;
      try { report = Object.freeze(JSON.parse(row.report_json) as ResearchValidationReport); }
      catch (error) { throw new Error("research validation report JSON is invalid", { cause: error }); }
      this.assertResearchReport(report);
      const manifest = manifests.get(report.runId);
      if (manifest == null || manifest.runType !== report.runType || manifest.resultChecksum !== report.resultChecksum) throw new Error("research report does not match persisted manifest");
      return report;
    }));
  }

  appendOwnerReview(record: OwnerReviewRecord, currentBundleStatus: "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED"): void {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(record.reviewerId)) throw new Error("reviewer id must be a local owner alias");
    if (!/^[a-f0-9]{64}$/i.test(record.bundleChecksum) || !/^[a-f0-9]{64}$/i.test(record.recordChecksum)) throw new Error("review checksum is invalid");
    if (!["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE"].includes(record.decision)) throw new Error("review decision is invalid");
    if (record.decision === "APPROVE" && currentBundleStatus !== "READY_FOR_OWNER_REVIEW") throw new Error("approval requires READY_FOR_OWNER_REVIEW");
    const canonical = JSON.stringify({ reviewId: record.reviewId, bundleChecksum: record.bundleChecksum, reviewerId: record.reviewerId, decision: record.decision, note: record.note ?? null, reviewedAt: record.reviewedAt });
    const expectedChecksum = createHash("sha256").update(canonical, "utf8").digest("hex");
    if (record.recordChecksum !== expectedChecksum) throw new Error("review record checksum mismatch");
    this.transaction(() => {
      const existing = this.db.prepare("SELECT review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum FROM desktop_owner_review_records WHERE review_id = ?").get(record.reviewId) as OwnerReviewRecord | undefined;
      if (existing != null) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("review id conflict");
        return;
      }
      this.db.prepare("INSERT INTO desktop_owner_review_records (review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.reviewId, record.bundleChecksum, record.reviewerId, record.decision, record.note ?? null, record.reviewedAt, record.recordChecksum);
    });
  }

  loadOwnerReviews(): readonly OwnerReviewRecord[] {
    const rows = this.db.prepare("SELECT review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum FROM desktop_owner_review_records ORDER BY reviewed_at ASC, review_id ASC").all() as Array<Record<string, unknown>>;
    return Object.freeze(rows.map((row) => Object.freeze({
      reviewId: String(row.review_id),
      bundleChecksum: String(row.bundle_checksum),
      reviewerId: String(row.reviewer_id),
      decision: String(row.decision) as OwnerReviewRecord["decision"],
      note: row.note == null ? undefined : String(row.note),
      reviewedAt: String(row.reviewed_at),
      recordChecksum: String(row.record_checksum)
    })));
  }

  close(): void { this.db.close(); }

  /**
   * A5D uses the same durable SQLite file as Paper and recovery. The returned repository is
   * read/write for future execution orchestration, but this method alone performs no order
   * mutation; the desktop currently exposes only its read-only projections to the renderer.
   */
  executionRepository(): SqliteDurableExecutionRepository {
    return new SqliteDurableExecutionRepository({
      connection: this.db,
      transaction: <T>(operation: () => T): T => this.transaction(operation)
    });
  }

  riskEvidenceRepository(): SqliteRiskEvidenceRepository {
    return new SqliteRiskEvidenceRepository({ connection: this.db });
  }

  riskSafetyRepository(): SqliteRiskSafetyPersistence {
    return new SqliteRiskSafetyPersistence({
      connection: this.db,
      transaction: <T>(operation: () => T): T => this.transaction(operation)
    });
  }

  appendResearchEvidenceBundle(entries: readonly Readonly<{ manifest: ResearchRunManifest; report: ResearchValidationReport }>[]): void {
    if (entries.length === 0) throw new Error("research evidence bundle is empty");
    const seen = new Set<string>();
    for (const entry of entries) {
      validateResearchRunManifest(entry.manifest);
      this.assertResearchReport(entry.report);
      if (entry.manifest.runId !== entry.report.runId || entry.manifest.runType !== entry.report.runType || entry.manifest.resultChecksum !== entry.report.resultChecksum) {
        throw new Error("research evidence bundle identity mismatch");
      }
      if (seen.has(entry.manifest.runId)) throw new Error("research evidence bundle contains duplicate runId");
      seen.add(entry.manifest.runId);
    }
    this.transaction(() => {
      for (const entry of entries) {
        const manifestPayload = JSON.stringify(entry.manifest);
        const reportPayload = JSON.stringify(entry.report);
        const existingManifest = this.db.prepare("SELECT manifest_json FROM desktop_research_manifests WHERE run_id = ?").get(entry.manifest.runId) as { manifest_json: string } | undefined;
        const existingReport = this.db.prepare("SELECT report_json FROM desktop_research_reports WHERE run_id = ? AND run_type = ?").get(entry.report.runId, entry.report.runType) as { report_json: string } | undefined;
        if (existingManifest != null && existingManifest.manifest_json !== manifestPayload) throw new Error("research manifest identity conflict");
        if (existingReport != null && existingReport.report_json !== reportPayload) throw new Error("research validation report identity conflict");
        if (existingManifest == null) this.db.prepare("INSERT INTO desktop_research_manifests (run_id, run_type, strategy_id, strategy_version, dataset_id, dataset_checksum, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(entry.manifest.runId, entry.manifest.runType, entry.manifest.strategyId, entry.manifest.strategyVersion, entry.manifest.datasetId, entry.manifest.datasetChecksum, manifestPayload);
        if (existingReport == null) this.db.prepare("INSERT INTO desktop_research_reports (run_id, run_type, report_json) VALUES (?, ?, ?)").run(entry.report.runId, entry.report.runType, reportPayload);
      }
    });
  }

  /** Reads the existing append-only committee ledger without creating or mutating it. */
  loadCommitteeDashboardSource(): Readonly<{ decision: RecordedCommitteeDecision | null; integrity: "VALID" | "UNAVAILABLE" | "INVALID" }> {
    try {
      const rows = this.db.prepare("SELECT sequence, previous_hash, decision_json, hash FROM investment_committee_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
      if (rows.length === 0) return Object.freeze({ decision: null, integrity: "UNAVAILABLE" as const });
      const records = rows.map((row) => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), decision: JSON.parse(String(row.decision_json)) as RecordedCommitteeDecision, hash: String(row.hash) })) as readonly CommitteeLedgerRecord[];
      replayCommitteeLedger(records);
      return Object.freeze({ decision: records[records.length - 1]!.decision, integrity: "VALID" as const });
    } catch {
      return Object.freeze({ decision: null, integrity: "INVALID" as const });
    }
  }

  appendOperationsAudit(record: OperationsAuditRecord): void {
    this.db.prepare("INSERT INTO desktop_operations_audit (audit_id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(audit_id) DO NOTHING").run(record.auditId, record.createdAt, JSON.stringify(record));
  }

  loadOperationsAudit(limit = 50): readonly OperationsAuditRecord[] {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
    const rows = this.db.prepare("SELECT payload FROM desktop_operations_audit ORDER BY created_at DESC, audit_id DESC LIMIT ?").all(safeLimit) as Array<{ payload: string }>;
    return Object.freeze(rows.map((row) => Object.freeze(JSON.parse(row.payload) as OperationsAuditRecord)));
  }

  appendOperationsAlert(record: OperationsAlertRecord): void {
    this.db.prepare("INSERT INTO desktop_operations_alerts (alert_id, created_at, severity, payload) VALUES (?, ?, ?, ?) ON CONFLICT(alert_id) DO NOTHING").run(record.alertId, record.createdAt, record.severity, JSON.stringify(record));
  }

  loadOperationsAlerts(limit = 50): readonly OperationsAlertRecord[] {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
    const rows = this.db.prepare("SELECT payload FROM desktop_operations_alerts ORDER BY created_at DESC, alert_id DESC LIMIT ?").all(safeLimit) as Array<{ payload: string }>;
    return Object.freeze(rows.map((row) => Object.freeze(JSON.parse(row.payload) as OperationsAlertRecord)));
  }

  appendOpportunitySchedule(input: Readonly<{ scheduleId: string; source: string; generatedAt: number; schedule: OpportunitySchedule }>): void {
    if (!input.scheduleId.trim() || !input.source.trim() || !Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("opportunity schedule identity is invalid");
    validateOpportunitySchedule(input.schedule);
    const payload = JSON.stringify(input.schedule);
    const payloadChecksum = createHash("sha256").update(payload, "utf8").digest("hex");
    this.transaction(() => {
      const existing = this.db.prepare("SELECT source, generated_at, payload, payload_checksum FROM desktop_opportunity_schedules WHERE schedule_id = ?").get(input.scheduleId) as { source: string; generated_at: number; payload: string; payload_checksum: string } | undefined;
      if (existing != null) {
        if (existing.source !== input.source || existing.generated_at !== input.generatedAt || existing.payload !== payload || existing.payload_checksum !== payloadChecksum) throw new Error("opportunity schedule identity conflict");
        return;
      }
      this.db.prepare("INSERT INTO desktop_opportunity_schedules (schedule_id, source, generated_at, payload, payload_checksum) VALUES (?, ?, ?, ?, ?)").run(input.scheduleId, input.source, input.generatedAt, payload, payloadChecksum);
    });
  }

  loadLatestOpportunitySchedule(): Readonly<{ scheduleId: string; source: string; generatedAt: number; schedule: OpportunitySchedule }> | undefined {
    const row = this.db.prepare("SELECT schedule_id, source, generated_at, payload, payload_checksum FROM desktop_opportunity_schedules ORDER BY generated_at DESC, schedule_id DESC LIMIT 1").get() as { schedule_id: string; source: string; generated_at: number; payload: string; payload_checksum: string } | undefined;
    if (row == null) return undefined;
    const checksum = createHash("sha256").update(row.payload, "utf8").digest("hex");
    if (checksum !== row.payload_checksum) throw new Error("opportunity schedule checksum mismatch");
    const schedule = JSON.parse(row.payload) as OpportunitySchedule;
    validateOpportunitySchedule(schedule);
    return Object.freeze({ scheduleId: row.schedule_id, source: row.source, generatedAt: Number(row.generated_at), schedule: Object.freeze(schedule) });
  }

  private configureSafetyPragmas(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA busy_timeout = 5000");

    const foreignKeys = Number((this.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys);
    const journalMode = String((this.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase();
    const synchronous = Number((this.db.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous);
    const busyTimeout = Number((this.db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout);
    if (foreignKeys !== 1 || journalMode !== "wal" || synchronous !== 2 || busyTimeout !== 5000) {
      throw new Error("required SQLite safety pragmas were not applied");
    }
  }

  private verifyStartupIntegrity(): void {
    const rows = this.db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
    if (rows.length !== 1 || rows[0]?.quick_check !== "ok") throw new Error("SQLite quick_check failed");
  }

  private parseResearchManifest(payload: string): ResearchRunManifest {
    try {
      const manifest = Object.freeze(JSON.parse(payload) as ResearchRunManifest);
      validateResearchRunManifest(manifest);
      return manifest;
    } catch (error) { throw new Error("research manifest JSON is invalid", { cause: error }); }
  }

  private assertResearchReport(report: ResearchValidationReport): void {
    if (!report.runId.trim() || !RESEARCH_RUN_TYPES.has(report.runType) || !["PASS", "FAIL"].includes(report.status)) throw new Error("research validation report identity is invalid");
    if (!Number.isFinite(Date.parse(report.checkedAt)) || !SHA256.test(report.resultChecksum) || report.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) throw new Error("research validation report content is invalid");
  }

  private write({ paper, control }: DesktopPersistenceState): void {
    const { orders, ...paperBase } = paper;
    const { events, processedSignalKeys, ...controlBase } = control;
    this.db.prepare("INSERT OR REPLACE INTO desktop_account_state (id, payload) VALUES (1, ?)").run(JSON.stringify(paperBase));
    this.db.exec("DELETE FROM desktop_orders");
    const orderInsert = this.db.prepare("INSERT INTO desktop_orders (id, ordinal, payload) VALUES (?, ?, ?)");
    orders.forEach((order, ordinal) => orderInsert.run(order.id, ordinal, JSON.stringify(order)));
    this.db.prepare("INSERT OR REPLACE INTO desktop_control_state (id, payload) VALUES (1, ?)").run(JSON.stringify(controlBase));
    this.db.exec("DELETE FROM desktop_control_events; DELETE FROM desktop_processed_signal_keys");
    const eventInsert = this.db.prepare("INSERT INTO desktop_control_events (id, ordinal, payload) VALUES (?, ?, ?)");
    events.forEach((event, ordinal) => eventInsert.run(event.id, ordinal, JSON.stringify(event)));
    const signalInsert = this.db.prepare("INSERT INTO desktop_processed_signal_keys (signal_key, ordinal) VALUES (?, ?)");
    processedSignalKeys.forEach((key, ordinal) => signalInsert.run(key, ordinal));
  }

  private writePaperSafetySnapshot(snapshot: PaperSafetySnapshot): void {
    this.db.prepare("INSERT OR REPLACE INTO desktop_paper_safety_snapshot (id, payload) VALUES (1, ?)").run(JSON.stringify(snapshot));
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ } throw error; }
  }
}
