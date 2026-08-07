export type RestrictedLiveState = "DISABLED" | "AUTHORIZED" | "ACTIVE" | "COOLDOWN" | "HALTED";
export type RestrictedLiveAction = "RISK_INCREASE" | "RISK_REDUCTION" | "EMERGENCY_RISK_REDUCTION";

export interface HumanPrincipal {
  readonly principalId: string;
  readonly kind: "HUMAN";
}

export interface RestrictedLiveScope {
  readonly deploymentBundleId: string;
  readonly capabilityContract: string;
  readonly strategyIdentity: string;
  readonly symbols: readonly string[];
  readonly maxOrderNotional: number;
  readonly maxPortfolioExposure: number;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly cooldownSeconds: number;
  readonly rollbackBundleId: string;
}

export interface RestrictedLiveSafetyEvidence {
  readonly operationalState: "SAFE";
  readonly safetyCriticalUnknown: false;
  readonly hardRiskResult: "PASS";
  readonly deploymentIntegrityResult: "PASS";
  readonly killSwitchActive: false;
  readonly openP0: false;
  readonly evidenceIds: readonly string[];
}

export interface RestrictedLiveAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly state: RestrictedLiveState;
  readonly requester: HumanPrincipal;
  readonly approvers: readonly [HumanPrincipal, HumanPrincipal];
  readonly action: RestrictedLiveAction;
  readonly reason: string;
  readonly issuedAt: string;
  readonly scope: RestrictedLiveScope;
  readonly safety: RestrictedLiveSafetyEvidence;
  readonly singleUse: true;
  readonly executionTransportConnected: false;
  readonly credentialStoragePresent: false;
  readonly automaticActivationAllowed: false;
  readonly aiAuthorityAllowed: false;
  readonly metaAiAuthorityAllowed: false;
  readonly shadowEvidenceGrantsAuthority: false;
  readonly productionPromotionEvidenceGrantsAuthority: false;
}

export interface BreakGlassAuthorization {
  readonly schemaVersion: 1;
  readonly authorizationId: string;
  readonly action: "EMERGENCY_RISK_REDUCTION";
  readonly humanPrincipal: HumanPrincipal;
  readonly reason: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly mayIncreaseRisk: false;
  readonly mayOverrideHardRisk: false;
  readonly mayOverrideKillSwitch: false;
  readonly mayOverrideHalt: false;
  readonly auditRequired: true;
}
