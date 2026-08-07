export type ChampionChallengerRecommendation =
  | "KEEP_CHAMPION"
  | "PROMOTE_CHALLENGER"
  | "REJECT_CHALLENGER"
  | "INCONCLUSIVE";

export interface CapabilityImplementationIdentity {
  readonly id: string;
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly implementationVersion: string;
  readonly lineage: {
    readonly model?: string;
    readonly provider?: string;
    readonly data: readonly string[];
    readonly tools: readonly string[];
    readonly implementation: string;
  };
}

export interface SealedEvaluationDataset {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
  readonly registeredAt: string;
  readonly mutableAfterRegistration: false;
  readonly accessibleToCandidateDuringEvaluation: false;
}

export interface EvaluationAuthority {
  readonly proposerId: string;
  readonly evaluatorId: string;
  readonly promotionAuthorityId: string;
  readonly metaAiProposer: boolean;
}

export interface ChampionChallengerEvaluationEvidence {
  readonly id: string;
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly championId: string;
  readonly challengerId: string;
  readonly benchmark: SealedEvaluationDataset;
  readonly holdout: SealedEvaluationDataset;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly failureSemantics: readonly string[];
  readonly authority: EvaluationAuthority;
  readonly recommendation: ChampionChallengerRecommendation;
  readonly observedAt: string;
  readonly provenance: readonly string[];
}
