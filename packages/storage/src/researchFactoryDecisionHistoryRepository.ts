import { createHash } from "node:crypto";
import type {
  ResearchFactoryDecisionHistoryRecord,
  ResearchFactoryDecisionHistoryState,
} from "../../contracts/src/researchFactoryDecisionHistory";

export interface ResearchFactoryDecisionHistoryDatabase {
  readonly connection: {
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
  };
  transaction<T>(fn: () => T): T;
}

export const researchFactoryDecisionHistoryMigration = Object.freeze({
  id: "021_research_factory_decision_history",
  sql: `
CREATE TABLE IF NOT EXISTS research_factory_decision_history_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  ledger_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_factory_decision_history (
  sequence INTEGER PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('REJECTED','INSUFFICIENT','QUALIFIED_FOR_LEAGUE')),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  previous_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  record_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_research_factory_decision_history_candidate
  ON research_factory_decision_history (candidate_id, sequence);
INSERT OR IGNORE INTO research_factory_decision_history_meta (id, schema_version, event_count, ledger_hash)
  VALUES (1, 1, 0, '0000000000000000000000000000000000000000000000000000000000000000');
`,
});

const GENESIS = "0".repeat(64);
const OUTCOMES = new Set<ResearchFactoryDecisionHistoryRecord["outcome"]>([
  "REJECTED",
  "INSUFFICIENT",
  "QUALIFIED_FOR_LEAGUE",
]);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const recordJson = (record: ResearchFactoryDecisionHistoryRecord): string => JSON.stringify(record);
const eventHash = (sequence: number, previousHash: string, json: string): string =>
  hash(`${sequence}\n${previousHash}\n${json}`);

function validateRecord(record: ResearchFactoryDecisionHistoryRecord): void {
  if (!record || typeof record !== "object" ||
      typeof record.candidateId !== "string" || record.candidateId.length === 0 ||
      typeof record.evaluationId !== "string" || record.evaluationId.length === 0 ||
      !OUTCOMES.has(record.outcome) ||
      !Array.isArray(record.reasons) || !record.reasons.every((reason) => typeof reason === "string") ||
      !Number.isSafeInteger(record.observedAt) || record.observedAt < 0) {
    throw new Error("RESEARCH_FACTORY_HISTORY_STATE_INVALID");
  }
  if (record.authority !== "PAPER_ONLY" ||
      record.liveAuthority !== "NONE" ||
      record.productionMutationAllowed !== false ||
      record.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID");
  }
}

function freezeRecord(record: ResearchFactoryDecisionHistoryRecord): ResearchFactoryDecisionHistoryRecord {
  return Object.freeze({ ...record, reasons: Object.freeze([...record.reasons]) });
}

export class SqliteResearchFactoryDecisionHistoryRepository {
  public constructor(private readonly db: ResearchFactoryDecisionHistoryDatabase) {}

  public append(record: ResearchFactoryDecisionHistoryRecord): { readonly record: ResearchFactoryDecisionHistoryRecord; readonly appended: boolean } {
    validateRecord(record);
    const json = recordJson(record);
    return this.db.transaction(() => {
      // Every write starts from a fully verified chain+meta state. This prevents
      // replay or a later append from normalizing pre-existing corruption.
      this.list();
      const existing = this.db.connection.prepare(
        "SELECT record_json FROM research_factory_decision_history WHERE evaluation_id = ?",
      ).get(record.evaluationId) as { record_json: string } | undefined;
      if (existing != null) {
        if (existing.record_json !== json) throw new Error("RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH");
        return Object.freeze({ record: freezeRecord(record), appended: false });
      }

      const meta = this.readMeta();
      const sequence = meta.eventCount + 1;
      const previousHash = meta.ledgerHash;
      const nextHash = eventHash(sequence, previousHash, json);
      this.db.connection.prepare(
        "INSERT INTO research_factory_decision_history (sequence, evaluation_id, candidate_id, outcome, observed_at, previous_hash, record_json, record_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(sequence, record.evaluationId, record.candidateId, record.outcome, record.observedAt, previousHash, json, nextHash);
      this.db.connection.prepare(
        "UPDATE research_factory_decision_history_meta SET event_count = ?, ledger_hash = ? WHERE id = 1",
      ).run(sequence, nextHash);
      return Object.freeze({ record: freezeRecord(record), appended: true });
    });
  }

  public list(): readonly ResearchFactoryDecisionHistoryRecord[] {
    const rows = this.db.connection.prepare(
      "SELECT sequence, evaluation_id, candidate_id, outcome, observed_at, previous_hash, record_json, record_hash FROM research_factory_decision_history ORDER BY sequence ASC",
    ).all() as Array<{
      sequence: number;
      evaluation_id: string;
      candidate_id: string;
      outcome: string;
      observed_at: number;
      previous_hash: string;
      record_json: string;
      record_hash: string;
    }>;

    let previousHash = GENESIS;
    const records = rows.map((row, index) => {
      const expectedSequence = index + 1;
      if (row.sequence !== expectedSequence || row.previous_hash !== previousHash ||
          row.record_hash !== eventHash(row.sequence, row.previous_hash, row.record_json)) {
        throw new Error("RESEARCH_FACTORY_HISTORY_LEDGER_INTEGRITY_VIOLATION");
      }
      let record: ResearchFactoryDecisionHistoryRecord;
      try {
        record = JSON.parse(row.record_json) as ResearchFactoryDecisionHistoryRecord;
      } catch {
        throw new Error("RESEARCH_FACTORY_HISTORY_LEDGER_INTEGRITY_VIOLATION");
      }
      validateRecord(record);
      if (record.evaluationId !== row.evaluation_id || record.candidateId !== row.candidate_id ||
          record.outcome !== row.outcome || record.observedAt !== row.observed_at) {
        throw new Error("RESEARCH_FACTORY_HISTORY_LEDGER_INTEGRITY_VIOLATION");
      }
      previousHash = row.record_hash;
      return freezeRecord(record);
    });

    const meta = this.readMeta();
    if (meta.eventCount !== records.length || meta.ledgerHash !== previousHash) {
      throw new Error("RESEARCH_FACTORY_HISTORY_LEDGER_META_MISMATCH");
    }
    return Object.freeze(records);
  }

  public state(): ResearchFactoryDecisionHistoryState {
    const records = this.list();
    return Object.freeze({
      records,
      totalDecisions: records.length,
      rejected: records.filter((record) => record.outcome === "REJECTED").length,
      insufficient: records.filter((record) => record.outcome === "INSUFFICIENT").length,
      qualifiedForLeague: records.filter((record) => record.outcome === "QUALIFIED_FOR_LEAGUE").length,
    });
  }

  public headHash(): string {
    const meta = this.readMeta();
    // Validate rows before exposing the durable head so a forged meta row cannot be trusted.
    this.list();
    return meta.ledgerHash;
  }

  private readMeta(): { readonly eventCount: number; readonly ledgerHash: string } {
    const row = this.db.connection.prepare(
      "SELECT schema_version, event_count, ledger_hash FROM research_factory_decision_history_meta WHERE id = 1",
    ).get() as { schema_version: number; event_count: number; ledger_hash: string } | undefined;
    if (row == null || row.schema_version !== 1 || !Number.isSafeInteger(row.event_count) || row.event_count < 0 ||
        !/^[a-f0-9]{64}$/.test(row.ledger_hash)) {
      throw new Error("RESEARCH_FACTORY_HISTORY_LEDGER_META_INVALID");
    }
    return Object.freeze({ eventCount: row.event_count, ledgerHash: row.ledger_hash });
  }
}
