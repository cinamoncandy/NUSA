import type { JevShadowDecision, JevShadowProjection } from "./jevShadowRouter";

export interface JevExistingDecision {
  readonly rootCause: JevShadowDecision["rootCause"];
  readonly safeToAutofix: JevShadowDecision["safeToAutofix"];
  readonly requiredModel: JevShadowDecision["requiredModel"];
}

export interface JevCalibrationRecord {
  readonly schemaVersion: 1;
  readonly mode: "DISABLED" | "SHADOW";
  readonly fallbackApplied: boolean;
  readonly confidence: number;
  readonly rootCauseAgreement: boolean;
  readonly autofixAgreement: boolean;
  readonly modelAgreement: boolean;
  readonly usableForRouting: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

export function projectJevCalibration(
  existing: JevExistingDecision,
  shadow: JevShadowProjection
): JevCalibrationRecord {
  return Object.freeze({
    schemaVersion: 1 as const,
    mode: shadow.mode,
    fallbackApplied: shadow.fallbackApplied,
    confidence: shadow.decision.confidence,
    rootCauseAgreement: existing.rootCause === shadow.decision.rootCause,
    autofixAgreement: existing.safeToAutofix === shadow.decision.safeToAutofix,
    modelAgreement: existing.requiredModel === shadow.decision.requiredModel,
    usableForRouting: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    productionMutationAllowed: false as const,
    liveAuthority: "NONE" as const
  });
}
