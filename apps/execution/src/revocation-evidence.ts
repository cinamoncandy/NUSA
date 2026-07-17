import { DatabaseSync } from "node:sqlite";

export interface SyntheticReleaseRevocationEvidence {
  readonly revocationId: string;
  readonly envelopeId: string;
  readonly candidateId: string;
  readonly previousHeadSha: string;
  readonly currentHeadSha: string;
  readonly reasons: readonly string[];
  readonly revokedAtMs: number;
  readonly deploymentAllowed: false;
  readonly productionMutationAllowed: false;
}

export class SqliteSyntheticReleaseRevocationEvidenceRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS synthetic_release_revocation_evidence(
      revocation_id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      previous_head_sha TEXT NOT NULL,
      current_head_sha TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      revoked_at_ms INTEGER NOT NULL,
      deployment_allowed INTEGER NOT NULL CHECK(deployment_allowed=0),
      production_mutation_allowed INTEGER NOT NULL CHECK(production_mutation_allowed=0)
    )`);
  }

  public append(evidence: SyntheticReleaseRevocationEvidence): SyntheticReleaseRevocationEvidence {
    if (!evidence.revocationId.trim() || !evidence.envelopeId.trim() || !evidence.candidateId.trim()) throw new Error("valid revocation identity is required");
    if (!evidence.previousHeadSha.trim() || !evidence.currentHeadSha.trim()) throw new Error("valid revocation head SHAs are required");
    if (!Number.isSafeInteger(evidence.revokedAtMs) || evidence.revokedAtMs < 0) throw new Error("valid revocation time is required");
    if (evidence.reasons.length < 1) throw new Error("at least one revocation reason is required");
    if (evidence.deploymentAllowed !== false || evidence.productionMutationAllowed !== false) throw new Error("revocation evidence cannot grant authority");
    this.db.prepare("INSERT INTO synthetic_release_revocation_evidence VALUES(?,?,?,?,?,?,?,?,?)").run(
      evidence.revocationId,
      evidence.envelopeId,
      evidence.candidateId,
      evidence.previousHeadSha,
      evidence.currentHeadSha,
      JSON.stringify([...new Set(evidence.reasons)].sort()),
      evidence.revokedAtMs,
      0,
      0,
    );
    return this.get(evidence.revocationId)!;
  }

  public get(revocationId: string): SyntheticReleaseRevocationEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM synthetic_release_revocation_evidence WHERE revocation_id=?").get(revocationId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (Number(row.deployment_allowed) !== 0 || Number(row.production_mutation_allowed) !== 0) throw new Error("invalid persisted revocation authority");
    return Object.freeze({
      revocationId: String(row.revocation_id),
      envelopeId: String(row.envelope_id),
      candidateId: String(row.candidate_id),
      previousHeadSha: String(row.previous_head_sha),
      currentHeadSha: String(row.current_head_sha),
      reasons: Object.freeze(JSON.parse(String(row.reasons_json)) as string[]),
      revokedAtMs: Number(row.revoked_at_ms),
      deploymentAllowed: false,
      productionMutationAllowed: false,
    });
  }
}
