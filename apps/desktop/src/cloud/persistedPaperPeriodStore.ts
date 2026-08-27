import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../../packages/storage/src/index";
import type { PersistedPaperPeriodRecord } from "./persistedPaperPeriodAdapter";

export interface PersistedPaperCandidateProvenance {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
}

export interface PersistedPaperPeriodEnvelope {
  readonly record: PersistedPaperPeriodRecord;
  readonly candidateProvenance: readonly PersistedPaperCandidateProvenance[];
}

export class PersistedPaperPeriodStoreError extends Error {
  public constructor(readonly code: string, message: string, readonly recordId?: string) {
    super(message);
    this.name = "PersistedPaperPeriodStoreError";
  }
}

const TABLE = "research_paper_forward_periods";
const SHA256 = /^[a-f0-9]{64}$/;
const checksum = (payload: string): string => createHash("sha256").update(payload, "utf8").digest("hex");
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function validateEnvelope(envelope: PersistedPaperPeriodEnvelope): void {
  const { record } = envelope;
  if (!record.recordId.trim()) throw new PersistedPaperPeriodStoreError("INVALID_RECORD_ID", "PAPER period recordId is required");
  if (!Number.isInteger(record.periodIndex) || record.periodIndex < 0) throw new PersistedPaperPeriodStoreError("INVALID_PERIOD_INDEX", "PAPER periodIndex must be a non-negative integer", record.recordId);
  if (!Number.isSafeInteger(record.periodStartAt) || !Number.isSafeInteger(record.periodEndAt) || record.periodStartAt < 0 || record.periodEndAt <= record.periodStartAt) {
    throw new PersistedPaperPeriodStoreError("INVALID_PERIOD_BOUNDS", "PAPER period bounds are invalid", record.recordId);
  }
  const advisoryIds = new Set(record.advisory.entries.map((entry) => entry.id));
  const provenanceIds = new Set<string>();
  for (const provenance of envelope.candidateProvenance) {
    if (!provenance.candidateId.trim() || provenanceIds.has(provenance.candidateId)) throw new PersistedPaperPeriodStoreError("INVALID_CANDIDATE_PROVENANCE", "candidate provenance identity is missing or duplicated", record.recordId);
    if (!provenance.datasetId.trim() || !SHA256.test(provenance.datasetContentSha256)) throw new PersistedPaperPeriodStoreError("INVALID_DATASET_PROVENANCE", "candidate dataset provenance is incomplete", record.recordId);
    provenanceIds.add(provenance.candidateId);
  }
  for (const id of advisoryIds) if (!provenanceIds.has(id)) throw new PersistedPaperPeriodStoreError("MISSING_CANDIDATE_PROVENANCE", `candidate ${id} has no persisted dataset provenance`, record.recordId);
  for (const id of provenanceIds) if (!advisoryIds.has(id)) throw new PersistedPaperPeriodStoreError("UNKNOWN_CANDIDATE_PROVENANCE", `candidate ${id} is not present in the persisted advisory`, record.recordId);
}

/** Durable append-only storage for realized, provenance-bound PAPER forward periods. */
export class SqlitePersistedPaperPeriodStore {
  public constructor(private readonly db: SqliteDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        record_id TEXT PRIMARY KEY,
        period_index INTEGER NOT NULL UNIQUE,
        period_start_at INTEGER NOT NULL,
        period_end_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_paper_forward_periods_chronology
        ON ${TABLE} (period_index ASC, period_start_at ASC, record_id ASC);
    `);
  }

  public append(envelope: PersistedPaperPeriodEnvelope): PersistedPaperPeriodEnvelope {
    validateEnvelope(envelope);
    const payload = JSON.stringify(envelope);
    const digest = checksum(payload);
    this.db.transaction(() => {
      const existing = this.db.connection.prepare(`SELECT payload_json, checksum FROM ${TABLE} WHERE record_id = ?`).get(envelope.record.recordId) as { payload_json?: string; checksum?: string } | undefined;
      if (existing != null) {
        if (String(existing.checksum) !== digest || String(existing.payload_json) !== payload) throw new PersistedPaperPeriodStoreError("RECORD_ID_CONFLICT", "persisted PAPER recordId was reused with different evidence", envelope.record.recordId);
        return;
      }
      try {
        this.db.connection.prepare(`INSERT INTO ${TABLE} (record_id, period_index, period_start_at, period_end_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(envelope.record.recordId, envelope.record.periodIndex, envelope.record.periodStartAt, envelope.record.periodEndAt, payload, digest);
      } catch (error) {
        throw new PersistedPaperPeriodStoreError("PERIOD_INDEX_CONFLICT", error instanceof Error ? error.message : "PAPER period persistence failed", envelope.record.recordId);
      }
    });
    return envelope;
  }

  public list(): readonly PersistedPaperPeriodEnvelope[] {
    const rows = this.db.connection.prepare(`SELECT record_id, payload_json, checksum FROM ${TABLE} ORDER BY period_index ASC, period_start_at ASC, record_id ASC`).all() as Array<{ record_id: string; payload_json: string; checksum: string }>;
    return freeze(rows.map((row) => {
      if (checksum(row.payload_json) !== row.checksum) throw new PersistedPaperPeriodStoreError("CHECKSUM_MISMATCH", "persisted PAPER period checksum mismatch", row.record_id);
      const envelope = JSON.parse(row.payload_json) as PersistedPaperPeriodEnvelope;
      validateEnvelope(envelope);
      if (envelope.record.recordId !== row.record_id) throw new PersistedPaperPeriodStoreError("RECORD_ID_MISMATCH", "persisted PAPER period row identity mismatch", row.record_id);
      return freeze({ record: freeze(envelope.record), candidateProvenance: freeze(envelope.candidateProvenance.map((item) => freeze({ ...item }))) });
    }));
  }

  public listRecords(): readonly PersistedPaperPeriodRecord[] {
    return freeze(this.list().map((envelope) => envelope.record));
  }
}
