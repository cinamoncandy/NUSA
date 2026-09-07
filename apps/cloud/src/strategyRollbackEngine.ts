import { createHash } from "node:crypto";
import type { StrategyLifecycle } from "../../../packages/contracts/src/strategyGovernance";

export interface StrategyRollbackInput { readonly now:number; readonly strategyId:string; readonly version:string; readonly previousChampionVersion?:string; readonly maximumDrawdown:number; readonly maximumDrawdownThreshold:number; readonly rollingSharpe:number; readonly minimumRollingSharpe:number; readonly executionQualityScore:number; readonly minimumExecutionQualityScore:number; readonly unresolvedFaultCount:number; readonly partialHedgeRecoveryFailures:number; readonly killSwitchActive:boolean; readonly featureFingerprintMatches:boolean; readonly dataQualityHealthy:boolean; readonly paperAvailabilityRatio:number; readonly minimumAvailabilityRatio:number; readonly strategyDriftDetected:boolean; readonly unresolvedExposure:boolean; }
export interface StrategyRollbackDecision { readonly action:"HOLD"|"SUSPEND"|"ROLLBACK"; readonly strategyId:string; readonly version:string; readonly rollbackTargetVersion?:string; readonly reasons:readonly string[]; readonly decidedAt:number; }
const invalid = (field:string):never => { throw new Error("STRATEGY_ROLLBACK_INVALID_"+field); };
const requireFinite = (value:number, field:string):void => { if(!Number.isFinite(value)) invalid(field+"_NONFINITE"); };
const requireUnitInterval = (value:number, field:string):void => { requireFinite(value,field); if(value<0||value>1) invalid(field+"_RANGE"); };
const requireScore = (value:number, field:string):void => { requireFinite(value,field); if(value<0||value>100) invalid(field+"_RANGE"); };
const requireNonNegativeInteger = (value:number, field:string):void => { if(!Number.isSafeInteger(value)||value<0) invalid(field+"_COUNT"); };
const requireBoolean = (value:boolean, field:string):void => { if(typeof value!=="boolean") invalid(field+"_BOOLEAN"); };

function validateStrategyRollbackInput(input:StrategyRollbackInput):void {
  if(!input||typeof input!=="object") invalid("INPUT");
  if(!Number.isSafeInteger(input.now)||input.now<0||typeof input.strategyId!=="string"||!input.strategyId.trim()||typeof input.version!=="string"||!input.version.trim()) invalid("IDENTITY");
  if(input.previousChampionVersion!==undefined&&(typeof input.previousChampionVersion!=="string"||!input.previousChampionVersion.trim())) invalid("PREVIOUS_CHAMPION_VERSION");
  requireUnitInterval(input.maximumDrawdown,"MAXIMUM_DRAWDOWN");
  requireUnitInterval(input.maximumDrawdownThreshold,"MAXIMUM_DRAWDOWN_THRESHOLD");
  requireFinite(input.rollingSharpe,"ROLLING_SHARPE");
  requireFinite(input.minimumRollingSharpe,"MINIMUM_ROLLING_SHARPE");
  requireScore(input.executionQualityScore,"EXECUTION_QUALITY_SCORE");
  requireScore(input.minimumExecutionQualityScore,"MINIMUM_EXECUTION_QUALITY_SCORE");
  requireNonNegativeInteger(input.unresolvedFaultCount,"UNRESOLVED_FAULT");
  requireNonNegativeInteger(input.partialHedgeRecoveryFailures,"PARTIAL_HEDGE_RECOVERY");
  requireBoolean(input.killSwitchActive,"KILL_SWITCH_ACTIVE");
  requireBoolean(input.featureFingerprintMatches,"FEATURE_FINGERPRINT_MATCHES");
  requireBoolean(input.dataQualityHealthy,"DATA_QUALITY_HEALTHY");
  requireUnitInterval(input.paperAvailabilityRatio,"PAPER_AVAILABILITY_RATIO");
  requireUnitInterval(input.minimumAvailabilityRatio,"MINIMUM_AVAILABILITY_RATIO");
  requireBoolean(input.strategyDriftDetected,"STRATEGY_DRIFT_DETECTED");
  requireBoolean(input.unresolvedExposure,"UNRESOLVED_EXPOSURE");
}

export function evaluateStrategyRollback(input:StrategyRollbackInput):StrategyRollbackDecision {
  validateStrategyRollbackInput(input);
  const r:string[]=[];
  if(input.killSwitchActive)r.push("KILL_SWITCH");if(input.unresolvedExposure)r.push("UNRESOLVED_EXPOSURE");if(input.unresolvedFaultCount>0)r.push("UNRESOLVED_FAULT");if(input.partialHedgeRecoveryFailures>0)r.push("PARTIAL_HEDGE_RECOVERY_FAILURE");if(!input.featureFingerprintMatches)r.push("FEATURE_DRIFT");if(!input.dataQualityHealthy)r.push("DATA_QUALITY");if(input.strategyDriftDetected)r.push("STRATEGY_DRIFT");if(input.maximumDrawdown>input.maximumDrawdownThreshold)r.push("DRAWDOWN");if(input.rollingSharpe<input.minimumRollingSharpe)r.push("SHARPE");if(input.executionQualityScore<input.minimumExecutionQualityScore)r.push("EXECUTION_QUALITY");if(input.paperAvailabilityRatio<input.minimumAvailabilityRatio)r.push("AVAILABILITY");
  const critical=r.some(x=>["KILL_SWITCH","UNRESOLVED_EXPOSURE","UNRESOLVED_FAULT"].includes(x)); const action=r.length===0?"HOLD":input.previousChampionVersion&&critical?"ROLLBACK":"SUSPEND";
  return Object.freeze({action,strategyId:input.strategyId,version:input.version,rollbackTargetVersion:action==="ROLLBACK"?input.previousChampionVersion:undefined,reasons:Object.freeze(r.sort()),decidedAt:input.now});
}

export type StrategyContainmentEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "STALE" | "CONFLICTING" | "UNAVAILABLE";
export interface StrategyContainmentEvidence {
  readonly status: StrategyContainmentEvidenceStatus;
  readonly observedAt: number;
  readonly fingerprint: string;
  readonly references: readonly string[];
}
export interface StrategyRetirementReview {
  readonly eligible: boolean;
  readonly consecutiveFailurePeriods: number;
  readonly minimumConsecutiveFailurePeriods: number;
}
export interface StrategyContainmentInput {
  readonly currentLifecycle: StrategyLifecycle;
  readonly rollback: StrategyRollbackInput;
  readonly evidence: StrategyContainmentEvidence;
  readonly retirement?: StrategyRetirementReview;
}
export interface StrategyContainmentDecision {
  readonly action: "HOLD" | "SUSPEND" | "ROLLBACK" | "RETIRE";
  readonly targetLifecycle: StrategyLifecycle;
  readonly currentLifecycle: StrategyLifecycle;
  readonly strategyId: string;
  readonly version: string;
  readonly reasons: readonly string[];
  readonly evidenceStatus: StrategyContainmentEvidenceStatus;
  readonly evidenceObservedAt: number;
  readonly evidenceFingerprint: string;
  readonly evidenceReferences: readonly string[];
  readonly decidedAt: number;
  readonly requiresHumanApproval: true;
  readonly productionMutationAllowed: false;
  readonly liveAuthority: "NONE";
}

const strategyLifecycles = new Set<StrategyLifecycle>([
  "DRAFT", "RESEARCHING", "VALIDATED", "PAPER_CANDIDATE", "PAPER_ACTIVE", "PROMOTION_PENDING",
  "CHAMPION", "CHALLENGER", "SUSPENDED", "ROLLED_BACK", "RETIRED", "REJECTED"
]);
const protectiveLifecycles = new Set<StrategyLifecycle>(["PAPER_ACTIVE", "PROMOTION_PENDING", "CHAMPION", "CHALLENGER"]);
const terminalLifecycles = new Set<StrategyLifecycle>(["RETIRED", "REJECTED"]);
const retirementReviewLifecycles = new Set<StrategyLifecycle>(["SUSPENDED", "ROLLED_BACK"]);
const containmentStatuses = new Set<StrategyContainmentEvidenceStatus>(["VERIFIED", "INSUFFICIENT", "STALE", "CONFLICTING", "UNAVAILABLE"]);
const sha256 = /^[a-f0-9]{64}$/;

const orderedReasons = (reasons: readonly string[]): readonly string[] => Object.freeze([...new Set(reasons)].sort());

const containmentDecisionPayload = (decision: StrategyContainmentDecision): Record<string, unknown> => ({
  action: decision.action,
  currentLifecycle: decision.currentLifecycle,
  decidedAt: decision.decidedAt,
  evidenceFingerprint: decision.evidenceFingerprint,
  evidenceObservedAt: decision.evidenceObservedAt,
  evidenceReferences: [...decision.evidenceReferences],
  evidenceStatus: decision.evidenceStatus,
  liveAuthority: decision.liveAuthority,
  productionMutationAllowed: decision.productionMutationAllowed,
  reasons: [...decision.reasons],
  strategyId: decision.strategyId,
  targetLifecycle: decision.targetLifecycle,
  version: decision.version,
});

const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("STRATEGY_CONTAINMENT_DECISION_NONFINITE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  throw new Error("STRATEGY_CONTAINMENT_DECISION_CANONICAL_INVALID");
};

/** Stable binding for an advisory decision and the evidence it evaluated. */
export function fingerprintStrategyContainmentDecision(decision: StrategyContainmentDecision): string {
  return createHash("sha256").update(canonical(containmentDecisionPayload(decision)), "utf8").digest("hex");
}

function validateContainmentInput(input: StrategyContainmentInput): void {
  if (input == null || typeof input !== "object") throw new Error("STRATEGY_CONTAINMENT_INVALID_INPUT");
  if (!strategyLifecycles.has(input.currentLifecycle)) throw new Error("STRATEGY_CONTAINMENT_INVALID_LIFECYCLE");
  if (!containmentStatuses.has(input.evidence?.status)) throw new Error("STRATEGY_CONTAINMENT_INVALID_EVIDENCE_STATUS");
  if (!Number.isSafeInteger(input.evidence.observedAt) || input.evidence.observedAt < 0 || input.evidence.observedAt > input.rollback.now) throw new Error("STRATEGY_CONTAINMENT_INVALID_EVIDENCE_TIME");
  if (!sha256.test(input.evidence.fingerprint)) throw new Error("STRATEGY_CONTAINMENT_INVALID_EVIDENCE_FINGERPRINT");
  if (!Array.isArray(input.evidence.references) || input.evidence.references.length === 0 || input.evidence.references.some((reference) => typeof reference !== "string" || !reference.trim()) || new Set(input.evidence.references).size !== input.evidence.references.length) throw new Error("STRATEGY_CONTAINMENT_INVALID_EVIDENCE_REFERENCES");
  const retirement = input.retirement;
  if (retirement != null && (typeof retirement.eligible !== "boolean" || !Number.isSafeInteger(retirement.consecutiveFailurePeriods) || retirement.consecutiveFailurePeriods < 0 || !Number.isSafeInteger(retirement.minimumConsecutiveFailurePeriods) || retirement.minimumConsecutiveFailurePeriods < 1)) throw new Error("STRATEGY_CONTAINMENT_INVALID_RETIREMENT_REVIEW");
}

const decision = (input: StrategyContainmentInput, action: StrategyContainmentDecision["action"], targetLifecycle: StrategyLifecycle, reasons: readonly string[]): StrategyContainmentDecision => Object.freeze({
  action,
  targetLifecycle,
  currentLifecycle: input.currentLifecycle,
  strategyId: input.rollback.strategyId,
  version: input.rollback.version,
  reasons: orderedReasons(reasons),
  evidenceStatus: input.evidence.status,
  evidenceObservedAt: input.evidence.observedAt,
  evidenceFingerprint: input.evidence.fingerprint,
  evidenceReferences: Object.freeze([...input.evidence.references].sort()),
  decidedAt: input.rollback.now,
  requiresHumanApproval: true as const,
  productionMutationAllowed: false as const,
  liveAuthority: "NONE" as const
});

/**
 * Converts existing rollback evidence into a review-only containment recommendation.
 * It never appends a governance event or changes a registry entry. Missing or
 * contradictory evidence protects active strategies and suppresses permissive advice.
 */
export function evaluateStrategyContainment(input: StrategyContainmentInput): StrategyContainmentDecision {
  validateContainmentInput(input);
  const rollback = evaluateStrategyRollback(input.rollback);
  if (terminalLifecycles.has(input.currentLifecycle)) return decision(input, "HOLD", input.currentLifecycle, ["TERMINAL_LIFECYCLE"]);

  if (input.evidence.status !== "VERIFIED") {
    const reason = `${input.evidence.status}_EVIDENCE`;
    return protectiveLifecycles.has(input.currentLifecycle)
      ? decision(input, "SUSPEND", "SUSPENDED", [reason])
      : decision(input, "HOLD", input.currentLifecycle, [reason, "PROMOTION_BLOCKED"]);
  }

  const retirement = input.retirement;
  if (retirementReviewLifecycles.has(input.currentLifecycle) && retirement?.eligible === true && retirement.consecutiveFailurePeriods >= retirement.minimumConsecutiveFailurePeriods) {
    return decision(input, "RETIRE", "RETIRED", [...rollback.reasons, "RETIREMENT_THRESHOLD_MET"]);
  }

  if (rollback.action === "ROLLBACK") return decision(input, "ROLLBACK", "ROLLED_BACK", rollback.reasons);
  if (rollback.action === "SUSPEND") return decision(input, "SUSPEND", "SUSPENDED", rollback.reasons);
  return decision(input, "HOLD", input.currentLifecycle, ["NO_CONTAINMENT_TRIGGER"]);
}
