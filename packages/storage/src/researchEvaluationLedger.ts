import { createHash } from "node:crypto";
import type { ResearchComparisonEvidence, ResearchEvaluationLedger, ResearchExecutionLifecycle } from "../../contracts/src/researchRuntime";
import { validateResearchProvenance } from "../../contracts/src/researchHardening";

export interface ResearchEvaluationDatabase {
  readonly connection: { prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }; };
  transaction<T>(fn: () => T): T;
}

const genesis = "0".repeat(64);
const recordJson = (record: ResearchComparisonEvidence): string => JSON.stringify(record);
const recordHash = (sequence: number, previousHash: string, record: string): string => createHash("sha256").update(`${sequence}\n${previousHash}\n${record}`, "utf8").digest("hex");

function validateRecord(record: ResearchComparisonEvidence): void {
  if (record.schemaVersion !== 1 || !record.researchRunId.trim() || !record.evaluationId.trim() || !record.canonicalInputHash.match(/^[a-f0-9]{64}$/)) throw new Error("research comparison record is invalid");
  if (record.productionMutationAllowed !== false || record.promotionAllowed !== false) throw new Error("research comparison authority invariant failed");
  if (record.provenance != null && validateResearchProvenance(record.provenance).length > 0) throw new Error("research comparison provenance is invalid");
}

export class SqliteResearchEvaluationLedger implements ResearchEvaluationLedger {
  public constructor(private readonly db: ResearchEvaluationDatabase) { db.connection.prepare("CREATE TABLE IF NOT EXISTS research_execution_lifecycle (execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, stage TEXT NOT NULL, precommit_fingerprint TEXT NOT NULL, input_fingerprint TEXT NOT NULL, payload_fingerprint TEXT NOT NULL, PRIMARY KEY(execution_id, sequence), UNIQUE(execution_id, stage))").run(); }

  public append(record: ResearchComparisonEvidence): void {
    validateRecord(record);
    this.db.transaction(() => {
      const existing = this.db.connection.prepare("SELECT record_json FROM research_evaluation_ledger WHERE evaluation_id = ?").get(record.evaluationId) as { record_json: string } | undefined;
      const json = recordJson(record);
      if (existing != null) {
        if (existing.record_json !== json) throw new Error("research evaluation id conflict");
        return;
      }
      const prior = this.db.connection.prepare("SELECT sequence, hash FROM research_evaluation_ledger ORDER BY sequence DESC LIMIT 1").get() as { sequence: number; hash: string } | undefined;
      const sequence = Number(prior?.sequence ?? 0) + 1;
      const previousHash = prior?.hash ?? genesis;
      this.db.connection.prepare("INSERT INTO research_evaluation_ledger (sequence, evaluation_id, previous_hash, record_json, hash) VALUES (?, ?, ?, ?, ?)").run(sequence, record.evaluationId, previousHash, json, recordHash(sequence, previousHash, json));
    });
  }

  public list(): readonly ResearchComparisonEvidence[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, record_json, hash FROM research_evaluation_ledger ORDER BY sequence ASC").all() as Array<{ sequence: number; previous_hash: string; record_json: string; hash: string }>;
    let previous = genesis;
    return Object.freeze(rows.map((row) => {
      if (row.sequence <= 0 || row.previous_hash !== previous || row.hash !== recordHash(row.sequence, row.previous_hash, row.record_json)) throw new Error("research evaluation ledger integrity violation");
      const record = JSON.parse(row.record_json) as ResearchComparisonEvidence;
      validateRecord(record);
      previous = row.hash;
      return Object.freeze(record);
    }));
  }

  public headHash(): string {
    const row = this.db.connection.prepare("SELECT hash FROM research_evaluation_ledger ORDER BY sequence DESC LIMIT 1").get() as { hash: string } | undefined;
    return row?.hash ?? genesis;
  }

  public appendLifecycle(record: ResearchExecutionLifecycle): void {
    this.db.transaction(() => {
      const prior = this.db.connection.prepare("SELECT sequence FROM research_execution_lifecycle WHERE execution_id = ? ORDER BY sequence DESC LIMIT 1").get(record.executionId) as { sequence: number } | undefined;
      if (Number(prior?.sequence ?? 0) + 1 !== record.sequence) throw new Error("RESEARCH_LIFECYCLE_SEQUENCE_CONFLICT");
      const existing = this.db.connection.prepare("SELECT execution_id, sequence, stage, precommit_fingerprint AS precommitFingerprint, input_fingerprint AS inputFingerprint, payload_fingerprint AS payloadFingerprint FROM research_execution_lifecycle WHERE execution_id = ? AND stage = ?").get(record.executionId, record.stage) as ResearchExecutionLifecycle | undefined;
      if (existing != null) { if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("RESEARCH_LIFECYCLE_ID_CONFLICT"); return; }
      if (record.stage === "EXECUTION_OUTPUT") {
        const start = this.db.connection.prepare("SELECT precommit_fingerprint, input_fingerprint FROM research_execution_lifecycle WHERE execution_id = ? AND stage = 'EXECUTION_START'").get(record.executionId) as { precommit_fingerprint: string; input_fingerprint: string } | undefined;
        if (start == null || start.precommit_fingerprint !== record.precommitFingerprint || start.input_fingerprint !== record.inputFingerprint) throw new Error("RESEARCH_LIFECYCLE_BINDING_MISMATCH");
      }
      this.db.connection.prepare("INSERT INTO research_execution_lifecycle(execution_id,sequence,stage,precommit_fingerprint,input_fingerprint,payload_fingerprint) VALUES(?,?,?,?,?,?)").run(record.executionId, record.sequence, record.stage, record.precommitFingerprint, record.inputFingerprint, record.payloadFingerprint);
    });
  }
  public lifecycle(executionId: string): readonly ResearchExecutionLifecycle[] { return Object.freeze((this.db.connection.prepare("SELECT execution_id, sequence, stage, precommit_fingerprint AS precommitFingerprint, input_fingerprint AS inputFingerprint, payload_fingerprint AS payloadFingerprint FROM research_execution_lifecycle WHERE execution_id = ? ORDER BY sequence").all(executionId) as ResearchExecutionLifecycle[]).map((row) => Object.freeze({ ...row }))); }
}
