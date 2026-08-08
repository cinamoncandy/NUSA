import { createHash } from "node:crypto";
import type { ResearchComparisonEvidence, ResearchEvaluationLedger } from "../../contracts/src/researchRuntime";

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
}

export class SqliteResearchEvaluationLedger implements ResearchEvaluationLedger {
  public constructor(private readonly db: ResearchEvaluationDatabase) {}

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
}
