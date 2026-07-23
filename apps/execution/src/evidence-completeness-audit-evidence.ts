import { DatabaseSync } from "node:sqlite";
import { auditEvidenceCompleteness, type EvidenceCompletenessAuditResult, type EvidenceRequirement } from "./evidence-completeness-audit";

export interface EvidenceCompletenessAuditEvidence extends EvidenceCompletenessAuditResult {
  readonly requirements: readonly EvidenceRequirement[];
}

/**
 * Append-only record of evidence completeness audits.
 *
 * Follows the same rule as the other audit stores: the declared requirements are what is
 * persisted, and the COMPLETE/INCOMPLETE verdict is derived here and re-derived on read. A
 * COMPLETE audit can therefore never be recorded for a requirement set that was actually
 * missing or candidate-mismatched, and an audit row edited in place is rejected rather than
 * trusted. An audit with zero declared requirements stays INCOMPLETE, so "nothing was checked"
 * can never masquerade as "everything passed".
 */
export class SqliteEvidenceCompletenessAuditRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_completeness_audit_evidence (
        audit_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        requirements_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        missing_json TEXT NOT NULL,
        mismatched_json TEXT NOT NULL,
        evaluated_at_ms INTEGER NOT NULL,
        production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0)
      );
    `);
  }

  public append(args: { readonly auditId: string; readonly candidateId: string; readonly requirements: readonly EvidenceRequirement[]; readonly nowMs: number }): EvidenceCompletenessAuditEvidence {
    if (this.get(args.auditId)) throw new Error("duplicate evidence completeness audit id");
    const result = auditEvidenceCompleteness({ auditId: args.auditId, candidateId: args.candidateId, requirements: args.requirements, nowMs: args.nowMs });
    this.db
      .prepare("INSERT INTO evidence_completeness_audit_evidence (audit_id, candidate_id, requirements_json, decision, missing_json, mismatched_json, evaluated_at_ms, production_mutation_allowed) VALUES (?,?,?,?,?,?,?,0)")
      .run(args.auditId, args.candidateId, JSON.stringify(args.requirements), result.decision, JSON.stringify(result.missingRequirementIds), JSON.stringify(result.mismatchedRequirementIds), args.nowMs);
    return this.get(args.auditId)!;
  }

  public get(auditId: string): EvidenceCompletenessAuditEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM evidence_completeness_audit_evidence WHERE audit_id = ?").get(auditId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    if (Number(row.production_mutation_allowed) !== 0) throw new Error("persisted Production mutation authorization rejected");
    const requirements = Object.freeze(JSON.parse(String(row.requirements_json)) as EvidenceRequirement[]);
    const rederived = auditEvidenceCompleteness({ auditId: String(row.audit_id), candidateId: String(row.candidate_id), requirements, nowMs: Number(row.evaluated_at_ms) });
    if (rederived.decision !== String(row.decision)) throw new Error("persisted audit verdict does not match its recorded requirements");
    return Object.freeze({ ...rederived, requirements });
  }
}
