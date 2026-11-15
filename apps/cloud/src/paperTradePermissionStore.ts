import { createHash } from "node:crypto";
import type { PaperTradePermissionAuthority, PaperTradePermissionQuery, PaperTradePermissionRecord } from "./paperTradePermissionGuard";
import type { TradePermissionPolicy } from "./tradePermissionEngine";

/**
 * Durable, append-only canonical permit store (design: docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md, section 3).
 *
 * NOT WIRED into the runtime. Nothing in production imports this file; a producer and the production wiring are later,
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

export interface PermitEvidenceItem {
  readonly reference: string;
  readonly kind: string;
  readonly source: string;
  readonly observedAt: string;
  /** SHA-256 (hex) of the evidence content held by the producer. */
  readonly contentSha256: string;
}

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
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  PRIMARY KEY (decision_id, reference)
);
CREATE TRIGGER IF NOT EXISTS trade_permission_records_no_update BEFORE UPDATE ON trade_permission_records BEGIN SELECT RAISE(ABORT, 'trade_permission_records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_records_no_delete BEFORE DELETE ON trade_permission_records BEGIN SELECT RAISE(ABORT, 'trade_permission_records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_evidence_no_update BEFORE UPDATE ON trade_permission_evidence BEGIN SELECT RAISE(ABORT, 'trade_permission_evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trade_permission_evidence_no_delete BEFORE DELETE ON trade_permission_evidence BEGIN SELECT RAISE(ABORT, 'trade_permission_evidence is append-only'); END;
`;

const SHA256_HEX = /^[0-9a-f]{64}$/;
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
    for (const item of evidence) if (!SHA256_HEX.test(item.contentSha256)) throw new Error(`evidence ${item.reference} needs a SHA-256 content hash`);
    return this.db.transaction(() => {
      const selectEvidence = this.db.connection.prepare("SELECT content_sha256 FROM trade_permission_evidence WHERE decision_id = ? AND reference = ?");
      const insertEvidence = this.db.connection.prepare("INSERT INTO trade_permission_evidence(decision_id, reference, kind, source, observed_at, content_sha256) VALUES(?,?,?,?,?,?)");
      for (const reference of references) {
        const supplied = evidence.find((item) => item.reference === reference);
        const stored = selectEvidence.get(permit.decisionId, reference) as { content_sha256?: unknown } | undefined;
        if (supplied == null && stored == null) throw new Error(`evidence ${reference} is not in the store and was not supplied`);
        if (supplied != null && stored != null) {
          if (String(stored.content_sha256) !== supplied.contentSha256) throw new Error(`evidence ${reference} already exists with different content`);
        } else if (supplied != null) {
          insertEvidence.run(permit.decisionId, supplied.reference, supplied.kind, supplied.source, supplied.observedAt, supplied.contentSha256);
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
      "SELECT sequence, strategy_id, market, policy_version, model_version, permit_json, input_json, permit_sha256 FROM trade_permission_records WHERE decision_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(decisionId) as RecordRow | undefined;
  }

  public latestPermit(query: PaperTradePermissionQuery): PaperTradePermissionRecord | null {
    const row = this.latestRow(query.decisionId);
    if (row == null) return null;
    // A stored row that no longer matches its own hash is corruption: refuse by throwing, never by guessing.
    if (createHash("sha256").update(row.permit_json).digest("hex") !== row.permit_sha256) throw new Error("stored permit does not match its hash");
    const permit = JSON.parse(row.permit_json);
    const input = JSON.parse(row.input_json);
    if (permit.strategyId !== row.strategy_id || permit.market !== row.market || permit.policyVersion !== row.policy_version || permit.probabilityModelVersion !== row.model_version) {
      throw new Error("stored permit does not match its row");
    }
    return { permit, input };
  }

  public evidenceExists(references: readonly string[], query: PaperTradePermissionQuery): boolean {
    if (!Array.isArray(references) || references.length === 0) return false;
    const select = this.handle.prepare("SELECT 1 AS present FROM trade_permission_evidence WHERE decision_id = ? AND reference = ?");
    return references.every((reference) => select.get(query.decisionId, reference) != null);
  }

  public isLatest(record: PaperTradePermissionRecord, query: PaperTradePermissionQuery): boolean {
    const row = this.latestRow(query.decisionId);
    return row != null && row.permit_sha256 === permitSha256(record.permit);
  }
}
