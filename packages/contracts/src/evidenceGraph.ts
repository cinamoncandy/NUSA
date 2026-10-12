export type EvidenceProvenanceSourceType = "CANONICAL" | "EXTERNAL" | "MODEL_GENERATED";
export type EvidenceVerificationState = "UNVERIFIED" | "VERIFIED" | "CONTRADICTED" | "STALE" | "SUPERSEDED" | "REJECTED";

/**
 * Provenance metadata attached to a graph assertion. This metadata describes the assertion;
 * it does not grant authority. EXTERNAL and MODEL_GENERATED assertions must remain explicitly
 * distinguishable from canonical observations. VERIFIED requires a separate verifier evidence node
 * and an INDEPENDENTLY_VERIFIES edge in the same sealed graph.
 */
export interface EvidenceGraphProvenance {
  readonly sourceType: EvidenceProvenanceSourceType;
  readonly verificationState: EvidenceVerificationState;
  readonly sourceRef?: string;
  readonly sourceFingerprint?: string;
  readonly observedAtMs?: number;
  readonly validUntilMs?: number;
  readonly verifierEvidenceId?: string;
}

export interface EvidenceGraphSealNode {
  readonly evidenceId: string;
  readonly kind: string;
  readonly candidateId: string;
  readonly provenance?: EvidenceGraphProvenance;
}
export interface EvidenceGraphSealEdge { readonly fromEvidenceId: string; readonly toEvidenceId: string; readonly relation: string; }
export const GENESIS_SEAL_HASH = "GENESIS";
export interface EvidenceGraphHashSeal { readonly sealId: string; readonly candidateId: string; readonly graphHash: string; readonly previousSealHash: string; readonly chainHash: string; readonly nodeCount: number; readonly edgeCount: number; readonly sealedAtMs: number; readonly deploymentAllowed: false; readonly productionMutationAllowed: false; }
