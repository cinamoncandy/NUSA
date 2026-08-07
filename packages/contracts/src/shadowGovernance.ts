export type ShadowExecutionMode = "SHADOW_READ_ONLY";
export type ShadowMutationDomain = "broker" | "order" | "fill" | "cash" | "position";
export type ShadowAuthority = "OBSERVATION_ONLY";

export interface ShadowIdentityBindings {
  readonly sourceRevisionRequired: true;
  readonly deploymentBundleRequired: true;
  readonly strategyIdentityRequired: true;
  readonly safetyPolicyIdentityRequired: true;
  readonly marketDataProvenanceRequired: true;
}

export interface ShadowMutationPolicy {
  readonly broker: "PROHIBITED";
  readonly order: "PROHIBITED";
  readonly fill: "PROHIBITED";
  readonly cash: "PROHIBITED";
  readonly position: "PROHIBITED";
}

export interface ShadowEvidencePolicy {
  readonly hashChainRequired: true;
  readonly zeroActualMutationCountersRequired: true;
  readonly decisionProvenanceRequired: true;
  readonly immutableSessionResultRequired: true;
}

export interface ShadowGovernanceContract {
  readonly version: 1;
  readonly mode: ShadowExecutionMode;
  readonly authority: ShadowAuthority;
  readonly productionEquivalentDecisionPath: true;
  readonly executionTransportConnected: false;
  readonly identities: ShadowIdentityBindings;
  readonly mutations: ShadowMutationPolicy;
  readonly evidence: ShadowEvidencePolicy;
  readonly decisionRewrite: Readonly<{
    hardRiskRejectToAllow: "PROHIBITED";
    hardRiskHaltToAllow: "PROHIBITED";
    safetyRestrictedToAllow: "PROHIBITED";
    safetyHaltToAllow: "PROHIBITED";
  }>;
  readonly promotion: Readonly<{
    observationMayRecommend: true;
    shadowEvidenceSufficientForProductionPromotion: false;
    shadowEvidenceSufficientForLiveAuthorization: false;
    autonomousProductionMutation: false;
  }>;
}

export interface ShadowObservationEvidence {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly sourceRevision: string;
  readonly deploymentBundleId: string;
  readonly strategyIdentity: string;
  readonly safetyPolicyIdentity: string;
  readonly marketDataProvenance: string;
  readonly resultSha256: string;
  readonly actualMutationCounters: Readonly<Record<ShadowMutationDomain, 0>>;
  readonly productionMutationAllowed: false;
  readonly liveAuthorizationGranted: false;
}
