import { createHash } from "node:crypto";
import type { PaperTradePermissionAuthority, PaperTradePermissionQuery, PaperTradePermissionRecord } from "./paperTradePermissionGuard";
import type { TradePermissionPolicy } from "./tradePermissionEngine";

/**
 * Durable, append-only canonical permit store (design: docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md, section 3).
 *
 * NOT WIRED into the runtime. Nothing in production imports this file yet, so the cloud reachability gate
 * (tests/cloud-unreached-baseline.test.js) correctly reports it as unreached and this change cannot merge until a
 * reviewed step wires it in (the gate and its baseline are not changed and the file is not hidden from the gate). A producer and the production wiring are later,
 * separately reviewed steps. The store is the trusted state behind `PaperTradePermissionAuthority.isLatest` and
 * `evidenceExists`: `isLatest` is true only for the highest-sequence record of an intent, so a newer REJECT supersedes an
 * older PERMIT and an older record can never be replayed, across restarts.
 *
 * The writer and the reader are separate classes. The reader takes only a `prepare()` handle (no exec, no run) and issues
 * SELECT statements only; production wiring must give it its own read-only connection. The execution boundary never
 * imports the writer (a source test pins this).
 */

export interface PermitStoreWriteDatabase {
  readonly connection: {
    exec(sql: string): unknown;
    prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  };
  transaction<T>(fn: () => T): T;
}

export interface PermitStoreReadHandle {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
}

/**
 * Evidence is stored WITH its content and is content-addressed: its reference must be `sha256:<hex of the content>`, so a
 * reference can never be an arbitrary label and the store recomputes the hash on write and on read.
 */
export interface PermitEvidenceItem {
  readonly reference: string;
  readonly kind: string;
  readonly source: string;
  readonly observedAt: string;
  readonly content: string;
}

export const evidenceReferenceFor = (content: string): string => `sha256:${createHash("sha256").update(content).digest("hex")}`;

export const PERMIT_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS trade_permission_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL CHECK(length(decision_id) > 0),
  strategy_id TEXT NOT NULL CHECK(length(strategy_id) > 0),
  market TEXT NOT NULL CHECK(length(market) > 0),
  policy_version TEXT NOT NULL CHECK(length(policy_version) > 0),
  model_version TEXT NOT NULL CHECK(length(model_version) > 0),
  decision TEXT NOT NULL CHECK(decision IN ('PERMIT','REJECT')),
  permit_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  permit_sha256 TEXT NOT NULL CHECK(length(permit_sha256) = 64),
  created_at TEXT NOT NULL CHECK(length(created_at) > 0)
);
CREATE INDEX IF NOT EXISTS trade_permission_records_decision ON trade_permission_records(decision_id, sequence);
CREATE TABLE IF NOT EXISTS trade_permission_evidence (
  decision_id TEXT NOT NULL CHECK(length(decision_id) > 0),
  reference TEXT NOT NULL CHECK(length(reference) > 0),
  kind TEXT NOT NULL CHECK(length(kind) > 0),
  source TEXT NOT NULL CHECK(length(source) > 0),
  observed_at TEXT NOT NULL CHECK(length(observed_at) > 0),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  PRIMARY KEY (decision_id, reference)
);
CREATE TRIGGER IF NOT EXISTS trade_permission_records_no_update BEFORE UPDATE ON trade_permission_records BEGIN SELECT RAISE(ABORT, 'trade_permission_records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_records_no_delete BEFORE DELETE ON trade_permission_records BEGIN SELECT RAISE(ABORT, 'trade_permission_records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_evidence_no_update BEFORE UPDATE ON trade_permission_evidence BEGIN SELECT RAISE(ABORT, 'trade_permission_evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_evidence_no_delete BEFORE DELETE ON trade_permission_evidence BEGIN SELECT RAISE(ABORT, 'trade_permission_evidence is append-only'); END;
`;

export const permitSha256 = (permit: unknown): string => createHash("sha256").update(JSON.stringify(permit)).digest("hex");

export class PaperTradePermissionStoreWriter {
  public constructor(private readonly db: PermitStoreWriteDatabase) {
    this.db.connection.exec(PERMIT_STORE_SCHEMA);
  }

  /**
   * Appends one record and the evidence items it cites, atomically. Every evidence reference of the permit must be
   * supplied (or already stored with the same content hash); anything else throws and nothing is written.
   * Returns the new sequence number.
   */
  public append(record: PaperTradePermissionRecord, evidence: readonly PermitEvidenceItem[], createdAt: string): number {
    const { permit, input } = record;
    if (permit == null || input == null) throw new Error("permit record requires both the permit and its evidence input");
    if (permit.decisionId !== input.decisionId || permit.strategyId !== input.strategyId || permit.market !== input.market) {
      throw new Error("permit and evidence input are bound to different intents");
    }
    if (typeof createdAt !== "string" || createdAt.trim() === "" || !Number.isFinite(Date.parse(createdAt))) throw new Error("createdAt must be an ISO timestamp");
    const references = [...permit.evidenceReferences];
    if (references.length === 0 || new Set(references).size !== references.length) throw new Error("a permit record needs unique evidence references");
    for (const item of evidence) {
      if (typeof item.content !== "string" || item.content === "") throw new Error(`evidence ${item.reference} needs its content`);
      if (item.reference !== evidenceReferenceFor(item.content)) throw new Error(`evidence reference ${item.reference} is not the hash of its content`);
    }
    return this.db.transaction(() => {
      // Replay: a record must be strictly newer than the latest one of the intent, so an old PERMIT can never be re-appended
      // above a newer REJECT (and the same permit can never be appended twice).
      const latest = this.db.connection.prepare("SELECT permit_json FROM trade_permission_records WHERE decision_id = ? ORDER BY sequence DESC LIMIT 1").get(permit.decisionId) as { permit_json?: unknown } | undefined;
      const newTime = Date.parse(permit.generatedAt);
      if (!Number.isFinite(newTime)) throw new Error("permit generatedAt must be an ISO timestamp");
      if (latest != null) {
        const latestTime = Date.parse((JSON.parse(String(latest.permit_json)) as { generatedAt: string }).generatedAt);
        if (!(newTime > latestTime)) throw new Error("a record must be strictly newer than the latest record of the intent");
      }
      const selectEvidence = this.db.connection.prepare("SELECT content_sha256 FROM trade_permission_evidence WHERE decision_id = ? AND reference = ?");
      const insertEvidence = this.db.connection.prepare("INSERT INTO trade_permission_evidence(decision_id, reference, kind, source, observed_at, content, content_sha256) VALUES(?,?,?,?,?,?,?)");
      for (const reference of references) {
        const supplied = evidence.find((item) => item.reference === reference);
        const stored = selectEvidence.get(permit.decisionId, reference) as { content_sha256?: unknown } | undefined;
        if (supplied == null && stored == null) throw new Error(`evidence ${reference} is not in the store and was not supplied`);
        if (supplied != null && stored == null) {
          insertEvidence.run(permit.decisionId, supplied.reference, supplied.kind, supplied.source, supplied.observedAt, supplied.content, createHash("sha256").update(supplied.content).digest("hex"));
        }
      }
      const result = this.db.connection.prepare(
        "INSERT INTO trade_permission_records(decision_id, strategy_id, market, policy_version, model_version, decision, permit_json, input_json, permit_sha256, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
      ).run(permit.decisionId, permit.strategyId, permit.market, permit.policyVersion, permit.probabilityModelVersion, permit.decision, JSON.stringify(permit), JSON.stringify(input), permitSha256(permit), createdAt) as { lastInsertRowid?: number | bigint };
      return Number(result.lastInsertRowid);
    });
  }
}

interface RecordRow {
  readonly sequence: number | bigint;
  readonly strategy_id: string;
  readonly market: string;
  readonly policy_version: string;
  readonly model_version: string;
  readonly decision: string;
  readonly permit_json: string;
  readonly input_json: string;
  readonly permit_sha256: string;
}

/** Read-only authority over the store. Any storage problem throws, which the guard turns into a refusal. */
export class PaperTradePermissionStoreReader implements PaperTradePermissionAuthority {
  public readonly policy: TradePermissionPolicy;
  public readonly probabilityModelVersion: string;
  public constructor(private readonly handle: PermitStoreReadHandle, options: { readonly policy: TradePermissionPolicy; readonly probabilityModelVersion: string }) {
    this.policy = options.policy;
    this.probabilityModelVersion = options.probabilityModelVersion;
  }

  private latestRow(decisionId: string): RecordRow | undefined {
    return this.handle.prepare(
      "SELECT sequence, strategy_id, market, policy_version, model_version, decision, permit_json, input_json, permit_sha256 FROM trade_permission_records WHERE decision_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(decisionId) as RecordRow | undefined;
  }

  public latestPermit(query: PaperTradePermissionQuery): PaperTradePermissionRecord | null {
    const row = this.latestRow(query.decisionId);
    if (row == null) return null;
    // A stored row that no longer matches its own hash is corruption: refuse by throwing, never by guessing.
    if (createHash("sha256").update(row.permit_json).digest("hex") !== row.permit_sha256) throw new Error("stored permit does not match its hash");
    const permit = JSON.parse(row.permit_json);
    const input = JSON.parse(row.input_json);
    if (permit.strategyId !== row.strategy_id || permit.market !== row.market || permit.policyVersion !== row.policy_version || permit.probabilityModelVersion !== row.model_version || permit.decision !== row.decision) {
      throw new Error("stored permit does not match its row");
    }
    return { permit, input };
  }

  public evidenceExists(references: readonly string[], query: PaperTradePermissionQuery): boolean {
    if (!Array.isArray(references) || references.length === 0) return false;
    const select = this.handle.prepare("SELECT content, content_sha256 FROM trade_permission_evidence WHERE decision_id = ? AND reference = ?");
    return references.every((reference) => {
      const row = select.get(query.decisionId, reference) as { content?: unknown; content_sha256?: unknown } | undefined;
      if (row == null || typeof row.content !== "string") return false;
      // The stored content must still hash to its address and to its recorded hash; a damaged or edited item is not evidence.
      return reference === evidenceReferenceFor(row.content) && String(row.content_sha256) === createHash("sha256").update(row.content).digest("hex");
    });
  }

  public isLatest(record: PaperTradePermissionRecord, query: PaperTradePermissionQuery): boolean {
    const row = this.latestRow(query.decisionId);
    return row != null && row.permit_sha256 === permitSha256(record.permit);
  }
}
