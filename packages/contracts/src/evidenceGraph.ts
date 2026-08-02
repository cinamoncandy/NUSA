export interface EvidenceGraphSealNode { readonly evidenceId: string; readonly kind: string; readonly candidateId: string; }
export interface EvidenceGraphSealEdge { readonly fromEvidenceId: string; readonly toEvidenceId: string; readonly relation: string; }
export const GENESIS_SEAL_HASH = "GENESIS";
export interface EvidenceGraphHashSeal { readonly sealId: string; readonly candidateId: string; readonly graphHash: string; readonly previousSealHash: string; readonly chainHash: string; readonly nodeCount: number; readonly edgeCount: number; readonly sealedAtMs: number; readonly deploymentAllowed: false; readonly productionMutationAllowed: false; }
