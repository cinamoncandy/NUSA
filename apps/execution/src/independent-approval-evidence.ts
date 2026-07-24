import { DatabaseSync } from "node:sqlite";
import { IndependentApprovalDecision, type IndependentApprovalResult } from "./independent-approval";

export interface IndependentApprovalEvidence extends IndependentApprovalResult {
  readonly requesterId: string;
  readonly approverId: string;
  readonly verifierId: string;
  readonly approved: boolean;
}

/**
 * Append-only, permanent record of independent-approval evaluations, including the actual
 * requester/approver/verifier identities. Records every evaluation, not only VALID ones: a
 * rejected self-approval attempt is itself audit-relevant and must not be discarded once
 * evaluated. Consumers that require an approval to authorize something else (e.g. promotion
 * evidence) must look the record up here rather than trust a caller-supplied in-memory result,
 * so an approval can't be fabricated without ever being durably recorded.
 */
export class SqliteIndependentApprovalEvidenceRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS independent_approval_evidence (
        approval_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        approver_id TEXT NOT NULL,
        verifier_id TEXT NOT NULL,
        approved INTEGER NOT NULL,
        decision TEXT NOT NULL,
        blockers_json TEXT NOT NULL,
        approved_at_ms INTEGER NOT NULL
      );
    `);
  }

  public append(input: {
    readonly result: IndependentApprovalResult;
    readonly requesterId: string;
    readonly approverId: string;
    readonly verifierId: string;
    readonly approved: boolean;
  }): IndependentApprovalEvidence {
    if (!input.requesterId.trim() || !input.approverId.trim() || !input.verifierId.trim()) throw new Error("requester, approver, and verifier identities are required");
    if (this.get(input.result.approvalId)) throw new Error("duplicate independent approval evidence id");
    this.db
      .prepare("INSERT INTO independent_approval_evidence (approval_id, candidate_id, requester_id, approver_id, verifier_id, approved, decision, blockers_json, approved_at_ms) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(input.result.approvalId, input.result.candidateId, input.requesterId, input.approverId, input.verifierId, input.approved ? 1 : 0, input.result.decision, JSON.stringify(input.result.blockers), input.result.approvedAtMs);
    return this.get(input.result.approvalId)!;
  }

  public get(approvalId: string): IndependentApprovalEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM independent_approval_evidence WHERE approval_id = ?").get(approvalId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return Object.freeze({
      approvalId: String(row.approval_id),
      candidateId: String(row.candidate_id),
      requesterId: String(row.requester_id),
      approverId: String(row.approver_id),
      verifierId: String(row.verifier_id),
      approved: Number(row.approved) === 1,
      decision: String(row.decision) as IndependentApprovalDecision,
      blockers: Object.freeze(JSON.parse(String(row.blockers_json)) as string[]),
      approvedAtMs: Number(row.approved_at_ms)
    });
  }
}
