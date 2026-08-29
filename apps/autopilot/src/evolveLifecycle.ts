import {
  recordCircuitFailure,
  validateCircuitBreakerPolicy,
  validateCircuitBreakerState,
  validateCircuitBreakerTimestamp,
  type EvolutionCircuitBreakerPolicy,
  type EvolutionCircuitBreakerState,
} from "./evolveCircuitBreaker";
import { createEvolutionControlSnapshot, type EvolutionControlSnapshot } from "./evolveControlRoom";
import { createEvolutionExecutionEnvelope, type EvolutionExecutionEnvelope, type EvolutionExecutionRequest } from "./evolveExecutionAdapter";
import { createEvolutionLearningRecord, type EvolutionLearningRecord } from "./evolveLearningMemory";
import { createEvolutionObservation, type EvolutionObservation } from "./evolveObservation";
import { validateEvolutionOpportunity, type EvolutionOpportunity } from "./evolveOpportunity";
import { evaluateEvolutionOutcome, type EvolutionOutcomeRecord } from "./evolveOutcome";
import { planEvolutionOpportunity, type EvolutionPlan } from "./evolvePlanner";
import { decideEvolutionPromotion, type EvolutionPromotionDecision } from "./evolvePromotion";
import { decideEvolutionRecovery, type EvolutionRecoveryDecision } from "./evolveRecovery";
import { decideEvolutionSchedule, type EvolutionScheduleDecision, type EvolutionSchedulePolicy } from "./evolveScheduler";
import { validateEvolutionValidationResult, type EvolutionValidationResult } from "./evolveValidation";

export type EvolutionLifecycleStatus = "COMPLETED" | "ABSTAINED" | "RECOVERING" | "CIRCUIT_OPEN";

export interface EvolutionLifecycleInput {
  readonly opportunity: unknown;
  readonly execution: EvolutionExecutionRequest;
  readonly validation: EvolutionValidationResult;
  readonly targetBranch: string;
  readonly observation: {
    readonly revision: string;
    readonly health: boolean;
    readonly errors?: number;
    readonly latencyMs?: number | null;
  };
  readonly outcome: {
    readonly expectedMetric: number;
    readonly actualMetric: number;
    readonly tolerance?: number;
    readonly evidence: readonly string[];
    readonly observedAt?: string;
  };
  readonly changeReference: string;
  readonly rollbackReference?: string | null;
  readonly recovery: {
    readonly failureClass: "KNOWN_TRANSIENT" | "KNOWN_REGRESSION" | "UNKNOWN";
    readonly attempts: number;
    readonly rollbackEvidence: boolean;
  };
  readonly circuit: {
    readonly state: EvolutionCircuitBreakerState;
    readonly policy: EvolutionCircuitBreakerPolicy;
    readonly now: string;
  };
  readonly schedule: {
    readonly policy: EvolutionSchedulePolicy;
    readonly activeExecutions: number;
    readonly elapsedSecondsSinceLastRun: number;
    readonly queuedOpportunities: number;
    readonly generatedAt: string;
  };
}

export interface EvolutionLifecycleResult {
  readonly status: EvolutionLifecycleStatus;
  readonly opportunity: EvolutionOpportunity;
  readonly plan: EvolutionPlan;
  readonly execution: EvolutionExecutionEnvelope;
  readonly promotion: EvolutionPromotionDecision;
  readonly observation?: EvolutionObservation;
  readonly outcome?: EvolutionOutcomeRecord;
  readonly learning?: EvolutionLearningRecord;
  readonly recovery?: EvolutionRecoveryDecision;
  readonly circuit: EvolutionCircuitBreakerState;
  readonly schedule: EvolutionScheduleDecision;
  readonly control: EvolutionControlSnapshot;
  readonly reason: string;
}

const freezeResult = (result: EvolutionLifecycleResult): EvolutionLifecycleResult => Object.freeze(result);

export function coordinateEvolutionLifecycle(input: EvolutionLifecycleInput): EvolutionLifecycleResult {
  const circuitState = validateCircuitBreakerState(input.circuit.state);
  const circuitPolicy = validateCircuitBreakerPolicy(input.circuit.policy);
  const circuitNow = validateCircuitBreakerTimestamp(input.circuit.now);
  const opportunity = validateEvolutionOpportunity(input.opportunity);
  validateEvolutionValidationResult(input.validation);
  const plan = planEvolutionOpportunity(opportunity);
  const execution = createEvolutionExecutionEnvelope(input.execution);
  const schedule = decideEvolutionSchedule(
    input.schedule.policy,
    input.schedule.activeExecutions,
    input.schedule.elapsedSecondsSinceLastRun,
  );

  const baseControl = (circuitOpen: boolean, lastOutcome?: string): EvolutionControlSnapshot =>
    createEvolutionControlSnapshot({
      generatedAt: input.schedule.generatedAt,
      activeExecutions: input.schedule.activeExecutions,
      queuedOpportunities: input.schedule.queuedOpportunities,
      circuitOpen,
      ...(lastOutcome ? { lastOutcome } : {}),
    });

  if (circuitState.state === "OPEN") {
    const promotion = Object.freeze({ eligible: false, exactHeadSha: input.validation.exactHeadSha, reason: "blocked:circuit-open" });
    return freezeResult({
      status: "CIRCUIT_OPEN",
      opportunity,
      plan,
      execution,
      promotion,
      circuit: circuitState,
      schedule,
      control: baseControl(true),
      reason: "circuit-open",
    });
  }

  if (!schedule.allowed) {
    const promotion = Object.freeze({ eligible: false, exactHeadSha: input.validation.exactHeadSha, reason: `blocked:schedule:${schedule.reason}` });
    return freezeResult({
      status: "ABSTAINED",
      opportunity,
      plan,
      execution,
      promotion,
      circuit: circuitState,
      schedule,
      control: baseControl(false),
      reason: `schedule-blocked:${schedule.reason}`,
    });
  }

  if (plan.status !== "PLANNED") {
    const promotion = decideEvolutionPromotion(input.validation, input.targetBranch);
    return freezeResult({
      status: "ABSTAINED",
      opportunity,
      plan,
      execution,
      promotion,
      circuit: circuitState,
      schedule,
      control: baseControl(false),
      reason: "plan-abstained",
    });
  }

  if (input.validation.opportunityId !== opportunity.id) {
    const promotion = Object.freeze({ eligible: false, exactHeadSha: input.validation.exactHeadSha, reason: "blocked:opportunity-mismatch" });
    return freezeResult({
      status: "ABSTAINED",
      opportunity,
      plan,
      execution,
      promotion,
      circuit: circuitState,
      schedule,
      control: baseControl(false),
      reason: "validation-opportunity-mismatch",
    });
  }

  if (input.validation.exactHeadSha !== execution.headSha) {
    const promotion = Object.freeze({ eligible: false, exactHeadSha: input.validation.exactHeadSha, reason: "blocked:stale-head" });
    return freezeResult({
      status: "ABSTAINED",
      opportunity,
      plan,
      execution,
      promotion,
      circuit: circuitState,
      schedule,
      control: baseControl(false),
      reason: "stale-exact-head",
    });
  }

  const promotion = decideEvolutionPromotion(input.validation, input.targetBranch);
  if (!promotion.eligible) {
    const recovery = decideEvolutionRecovery(input.recovery);
    const circuit = recordCircuitFailure(circuitState, circuitPolicy, circuitNow);
    const status: EvolutionLifecycleStatus = circuit.state === "OPEN" ? "CIRCUIT_OPEN" : recovery.action === "ABSTAIN" ? "ABSTAINED" : "RECOVERING";
    return freezeResult({
      status,
      opportunity,
      plan,
      execution,
      promotion,
      recovery,
      circuit,
      schedule,
      control: baseControl(circuit.state === "OPEN"),
      reason: `promotion-blocked:${input.validation.status.toLowerCase()}`,
    });
  }

  if (input.observation.revision !== promotion.exactHeadSha) {
    const recovery = decideEvolutionRecovery({ ...input.recovery, failureClass: "UNKNOWN" });
    const circuit = recordCircuitFailure(circuitState, circuitPolicy, circuitNow);
    const status: EvolutionLifecycleStatus = circuit.state === "OPEN" ? "CIRCUIT_OPEN" : "ABSTAINED";
    return freezeResult({
      status,
      opportunity,
      plan,
      execution,
      promotion,
      recovery,
      circuit,
      schedule,
      control: baseControl(circuit.state === "OPEN"),
      reason: "runtime-revision-mismatch",
    });
  }

  const observation = createEvolutionObservation(input.observation);
  const trustedEvidenceReferences = Object.freeze([
    ...opportunity.evidence.map((evidence) => evidence.reference),
    ...input.validation.evidence.map((evidence) => evidence.reference),
    "health:exact-revision",
  ]);
  const outcome = evaluateEvolutionOutcome({ opportunityId: opportunity.id, ...input.outcome, trustedEvidenceReferences });
  const learning = createEvolutionLearningRecord({
    opportunityId: opportunity.id,
    problem: opportunity.problem,
    evidenceReferences: Object.freeze([
      ...opportunity.evidence.map((evidence) => evidence.reference),
      ...input.validation.evidence.map((evidence) => evidence.reference),
      ...input.outcome.evidence,
    ]),
    hypothesis: plan.hypothesis,
    changeReference: input.changeReference,
    validationStatus: input.validation.status,
    outcome: outcome.outcome,
    failureReason: outcome.outcome === "SUCCESS" || outcome.outcome === "PARTIAL_SUCCESS" ? null : `outcome:${outcome.outcome.toLowerCase()}`,
    rollbackReference: input.rollbackReference ?? null,
    reusable: outcome.outcome === "SUCCESS" || outcome.outcome === "PARTIAL_SUCCESS",
    recordedAt: outcome.observedAt,
  });

  if (!observation.health || outcome.outcome === "UNDERPERFORMED" || outcome.outcome === "REGRESSION" || outcome.outcome === "FAILED" || outcome.outcome === "UNKNOWN") {
    const recovery = decideEvolutionRecovery(input.recovery);
    const circuit = recordCircuitFailure(circuitState, circuitPolicy, circuitNow);
    const status: EvolutionLifecycleStatus = circuit.state === "OPEN" ? "CIRCUIT_OPEN" : recovery.action === "ABSTAIN" ? "ABSTAINED" : "RECOVERING";
    return freezeResult({
      status,
      opportunity,
      plan,
      execution,
      promotion,
      observation,
      outcome,
      learning,
      recovery,
      circuit,
      schedule,
      control: baseControl(circuit.state === "OPEN", outcome.outcome),
      reason: !observation.health ? "runtime-observation-failed" : `outcome:${outcome.outcome.toLowerCase()}`,
    });
  }

  return freezeResult({
    status: "COMPLETED",
    opportunity,
    plan,
    execution,
    promotion,
    observation,
    outcome,
    learning,
    circuit: circuitState,
    schedule,
    control: baseControl(false, outcome.outcome),
    reason: "bounded-lifecycle-complete",
  });
}
