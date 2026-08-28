import { isDuplicateExecution, type AutonomousExecutionState, type ExecutionIdentity } from "./autonomousExecutionState";
import { canAttemptCircuitRecovery, recordCircuitFailure, resetCircuitBreaker, type EvolutionCircuitBreakerPolicy, type EvolutionCircuitBreakerState } from "./evolveCircuitBreaker";
import { createEvolutionExecutionEnvelope, type EvolutionExecutionEnvelope } from "./evolveExecutionAdapter";
import { createEvolutionLearningRecord, type EvolutionLearningRecord } from "./evolveLearningMemory";
import { planEvolutionOpportunity, type EvolutionPlan } from "./evolvePlanner";
import { decideEvolutionPromotion, type EvolutionPromotionDecision } from "./evolvePromotion";
import { rankEvolutionOpportunity, type EvolutionPriority } from "./evolveRanking";
import { decideEvolutionRecovery, type EvolutionRecoveryDecision } from "./evolveRecovery";
import { decideEvolutionSchedule, type EvolutionSchedulePolicy } from "./evolveScheduler";
import { createEvolutionObservation, type EvolutionObservation } from "./evolveObservation";
import { evaluateEvolutionOutcome, type EvolutionOutcomeRecord } from "./evolveOutcome";
import { createEvolutionValidationResult, type EvolutionValidationResult } from "./evolveValidation";
import type { EvolutionOpportunity } from "./evolveOpportunity";

export type EvolutionLifecycleStatus =
  | "DISCOVERED"
  | "ANALYZING"
  | "PLANNED"
  | "READY"
  | "EXECUTING"
  | "VALIDATING"
  | "PROMOTING"
  | "OBSERVING"
  | "EVALUATING"
  | "LEARNING"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED"
  | "ABSTAINED"
  | "CIRCUIT_OPEN";

export interface EvolutionLifecycleEvent {
  readonly phase: EvolutionLifecycleStatus;
  readonly status: EvolutionLifecycleStatus;
  readonly at: string;
  readonly reason: string;
}

export interface EvolutionExecutionResult {
  readonly status: "COMPLETED" | "FAILED" | "ABSTAINED";
  readonly exactHeadSha: string;
  readonly evidence: readonly string[];
  readonly reason: string;
  readonly failureClass?: "KNOWN_TRANSIENT" | "KNOWN_REGRESSION" | "UNKNOWN";
  readonly rollbackEvidence?: boolean;
}

export interface EvolutionLifecycleHandlers {
  readonly execute: (input: {
    readonly envelope: EvolutionExecutionEnvelope;
    readonly plan: EvolutionPlan;
  }) => Promise<EvolutionExecutionResult> | EvolutionExecutionResult;
  readonly validate: (input: {
    readonly envelope: EvolutionExecutionEnvelope;
    readonly plan: EvolutionPlan;
    readonly execution: EvolutionExecutionResult;
  }) => Promise<Parameters<typeof createEvolutionValidationResult>[0]> | Parameters<typeof createEvolutionValidationResult>[0];
  readonly observe: (input: {
    readonly envelope: EvolutionExecutionEnvelope;
    readonly validation: EvolutionValidationResult;
  }) => Promise<Parameters<typeof createEvolutionObservation>[0]> | Parameters<typeof createEvolutionObservation>[0];
  readonly evaluate: (input: {
    readonly envelope: EvolutionExecutionEnvelope;
    readonly validation: EvolutionValidationResult;
    readonly observation: EvolutionObservation;
  }) => Promise<Parameters<typeof evaluateEvolutionOutcome>[0]> | Parameters<typeof evaluateEvolutionOutcome>[0];
  readonly learn: (input: {
    readonly envelope: EvolutionExecutionEnvelope;
    readonly validation: EvolutionValidationResult;
    readonly observation: EvolutionObservation;
    readonly outcome: EvolutionOutcomeRecord;
  }) => Promise<Parameters<typeof createEvolutionLearningRecord>[0]> | Parameters<typeof createEvolutionLearningRecord>[0];
}

export interface EvolutionLifecycleOptions {
  readonly opportunity: EvolutionOpportunity;
  readonly repository: string;
  readonly headSha: string;
  readonly targetBranch: string;
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly authority: "ZERO_AUTHORITY";
  readonly now: string;
  readonly handlers: EvolutionLifecycleHandlers;
  readonly activeExecutions?: readonly AutonomousExecutionState[];
  readonly schedule?: {
    readonly policy: EvolutionSchedulePolicy;
    readonly activeExecutions: number;
    readonly elapsedSecondsSinceLastRun: number;
  };
  readonly circuit?: {
    readonly policy: EvolutionCircuitBreakerPolicy;
    readonly state: EvolutionCircuitBreakerState;
  };
}

export interface EvolutionLifecycleResult {
  readonly status: EvolutionLifecycleStatus;
  readonly opportunityId: string;
  readonly priority: EvolutionPriority;
  readonly plan: EvolutionPlan;
  readonly envelope: EvolutionExecutionEnvelope | null;
  readonly execution: EvolutionExecutionResult | null;
  readonly validation: EvolutionValidationResult | null;
  readonly promotion: EvolutionPromotionDecision | null;
  readonly observation: EvolutionObservation | null;
  readonly outcome: EvolutionOutcomeRecord | null;
  readonly learning: EvolutionLearningRecord | null;
  readonly recovery: EvolutionRecoveryDecision | null;
  readonly circuit: EvolutionCircuitBreakerState;
  readonly events: readonly EvolutionLifecycleEvent[];
  readonly reason: string;
}

const SHA40 = /^[0-9a-f]{40}$/i;
const isoTime = (value: string): string => {
  if (!Number.isFinite(Date.parse(value))) throw new Error("EVOLVE_LIFECYCLE_TIME_INVALID");
  return new Date(value).toISOString();
};

const immutable = <T>(value: T): T => Object.freeze(value);
const defaultCircuitPolicy: EvolutionCircuitBreakerPolicy = Object.freeze({ maxFailures: 3, cooldownSeconds: 60 });

function validateExecutionResult(value: EvolutionExecutionResult, expectedHeadSha: string): EvolutionExecutionResult {
  if (!value || !["COMPLETED", "FAILED", "ABSTAINED"].includes(value.status)) throw new Error("EVOLVE_LIFECYCLE_EXECUTION_STATUS_INVALID");
  if (value.exactHeadSha !== expectedHeadSha || !SHA40.test(value.exactHeadSha)) throw new Error("EVOLVE_LIFECYCLE_EXECUTION_HEAD_SHA_MISMATCH");
  if (!value.reason.trim() || value.reason.length > 1000) throw new Error("EVOLVE_LIFECYCLE_EXECUTION_REASON_INVALID");
  if (!value.evidence.length || value.evidence.some((item) => !item.trim() || item.length > 240)) throw new Error("EVOLVE_LIFECYCLE_EXECUTION_EVIDENCE_INVALID");
  return immutable({
    ...value,
    evidence: immutable([...value.evidence]),
  });
}

function resultBase(
  status: EvolutionLifecycleStatus,
  opportunity: EvolutionOpportunity,
  priority: EvolutionPriority,
  plan: EvolutionPlan,
  circuit: EvolutionCircuitBreakerState,
  events: readonly EvolutionLifecycleEvent[],
  reason: string,
  envelope: EvolutionExecutionEnvelope | null = null,
  execution: EvolutionExecutionResult | null = null,
  validation: EvolutionValidationResult | null = null,
  promotion: EvolutionPromotionDecision | null = null,
  observation: EvolutionObservation | null = null,
  outcome: EvolutionOutcomeRecord | null = null,
  learning: EvolutionLearningRecord | null = null,
  recovery: EvolutionRecoveryDecision | null = null,
): EvolutionLifecycleResult {
  return immutable({ status, opportunityId: opportunity.id, priority, plan, envelope, execution, validation, promotion, observation, outcome, learning, recovery, circuit, events: immutable([...events]), reason });
}

/**
 * Coordinates the existing EVOLVE primitives and execution handoff. This function is
 * deliberately non-mutating: the injected execute handler owns the canonical boundary,
 * while validation, promotion, observation and learning remain evidence-only stages.
 */
export async function runEvolutionLifecycle(options: EvolutionLifecycleOptions): Promise<EvolutionLifecycleResult> {
  if (!options.repository.trim() || !options.targetBranch.trim() || !options.executionId.trim() || !options.dedupeKey.trim()) {
    throw new Error("EVOLVE_LIFECYCLE_IDENTITY_REQUIRED");
  }
  if (!SHA40.test(options.headSha)) throw new Error("EVOLVE_LIFECYCLE_HEAD_SHA_INVALID");
  const at = isoTime(options.now);
  const events: EvolutionLifecycleEvent[] = [{ phase: "DISCOVERED", status: "DISCOVERED", at, reason: "opportunity-discovered" }];
  const priority = rankEvolutionOpportunity(options.opportunity);
  events.push({ phase: "ANALYZING", status: "ANALYZING", at, reason: priority.reason });

  const circuitConfig = options.circuit ?? { policy: defaultCircuitPolicy, state: resetCircuitBreaker() };
  const circuitPolicy = circuitConfig.policy;
  let circuit = circuitConfig.state;
  if (!canAttemptCircuitRecovery(circuit, circuitPolicy, at)) {
    events.push({ phase: "CIRCUIT_OPEN", status: "CIRCUIT_OPEN", at, reason: "circuit-cooldown-not-reached" });
    return resultBase("CIRCUIT_OPEN", options.opportunity, priority, planEvolutionOpportunity(options.opportunity), circuit, events, "circuit-open");
  }
  if (options.schedule) {
    const schedule = decideEvolutionSchedule(options.schedule.policy, options.schedule.activeExecutions, options.schedule.elapsedSecondsSinceLastRun);
    if (!schedule.allowed) {
      events.push({ phase: "ABSTAINED", status: "ABSTAINED", at, reason: schedule.reason });
      return resultBase("ABSTAINED", options.opportunity, priority, planEvolutionOpportunity(options.opportunity), circuit, events, schedule.reason);
    }
  }
  if (!priority.eligible) {
    events.push({ phase: "ABSTAINED", status: "ABSTAINED", at, reason: "opportunity-not-eligible" });
    return resultBase("ABSTAINED", options.opportunity, priority, planEvolutionOpportunity(options.opportunity), circuit, events, "opportunity-not-eligible");
  }

  const plan = planEvolutionOpportunity(options.opportunity);
  events.push({ phase: plan.status === "PLANNED" ? "PLANNED" : "ABSTAINED", status: plan.status === "PLANNED" ? "PLANNED" : "ABSTAINED", at, reason: plan.reason });
  if (plan.status !== "PLANNED") return resultBase("ABSTAINED", options.opportunity, priority, plan, circuit, events, plan.reason);

  const identity: ExecutionIdentity = {
    cycleId: `evolve:${options.opportunity.id}`,
    workItemId: `evolve:${options.opportunity.id}:${options.headSha}`,
    executionId: options.executionId,
    dedupeKey: options.dedupeKey,
  };
  if (isDuplicateExecution(options.activeExecutions ?? [], identity)) {
    events.push({ phase: "ABSTAINED", status: "ABSTAINED", at, reason: "duplicate-execution-suppressed" });
    return resultBase("ABSTAINED", options.opportunity, priority, plan, circuit, events, "duplicate-execution-suppressed");
  }

  const envelope = createEvolutionExecutionEnvelope({
    executionId: options.executionId,
    dedupeKey: options.dedupeKey,
    repository: options.repository,
    headSha: options.headSha,
    authority: options.authority,
  });
  events.push({ phase: "READY", status: "READY", at, reason: "safe-execution-envelope-created" });
  events.push({ phase: "EXECUTING", status: "EXECUTING", at, reason: "handoff-to-canonical-execution-boundary" });

  let execution: EvolutionExecutionResult | null = null;
  let recovery: EvolutionRecoveryDecision | null = null;
  let attempts = 0;
  while (true) {
    execution = validateExecutionResult(await options.handlers.execute({ envelope, plan }), options.headSha);
    if (execution.status !== "FAILED") break;
    recovery = decideEvolutionRecovery({
      failureClass: execution.failureClass ?? "UNKNOWN",
      attempts,
      rollbackEvidence: execution.rollbackEvidence === true,
    });
    events.push({ phase: "RECOVERING", status: "RECOVERING", at, reason: recovery.reason });
    if (recovery.action !== "RETRY") break;
    attempts = recovery.attempts;
  }
  if (!execution || execution.status === "FAILED") {
    circuit = recordCircuitFailure(circuit, circuitPolicy, at);
    events.push({ phase: "FAILED", status: "FAILED", at, reason: execution?.reason ?? "execution-failed" });
    return resultBase("FAILED", options.opportunity, priority, plan, circuit, events, execution?.reason ?? "execution-failed", envelope, execution, null, null, null, null, null, recovery);
  }
  if (execution.status === "ABSTAINED") {
    events.push({ phase: "ABSTAINED", status: "ABSTAINED", at, reason: execution.reason });
    return resultBase("ABSTAINED", options.opportunity, priority, plan, circuit, events, execution.reason, envelope, execution, null, null, null, null, null, recovery);
  }

  events.push({ phase: "VALIDATING", status: "VALIDATING", at, reason: "canonical-validation" });
  const validation = createEvolutionValidationResult(await options.handlers.validate({ envelope, plan, execution }));
  if (validation.exactHeadSha !== options.headSha) {
    circuit = recordCircuitFailure(circuit, circuitPolicy, at);
    events.push({ phase: "FAILED", status: "FAILED", at, reason: "stale-exact-head" });
    return resultBase("FAILED", options.opportunity, priority, plan, circuit, events, "stale-exact-head", envelope, execution, validation, null, null, null, null, recovery);
  }
  const promotion = decideEvolutionPromotion(validation, options.targetBranch);
  events.push({ phase: "PROMOTING", status: "PROMOTING", at, reason: promotion.reason });
  if (!promotion.eligible) {
    const status: EvolutionLifecycleStatus = validation.status === "FAIL" ? "FAILED" : "ABSTAINED";
    if (status === "FAILED") circuit = recordCircuitFailure(circuit, circuitPolicy, at);
    events.push({ phase: status, status, at, reason: validation.reason });
    return resultBase(status, options.opportunity, priority, plan, circuit, events, validation.reason, envelope, execution, validation, promotion, null, null, null, recovery);
  }

  events.push({ phase: "OBSERVING", status: "OBSERVING", at, reason: "post-change-observation" });
  const observation = createEvolutionObservation(await options.handlers.observe({ envelope, validation }));
  if (observation.status === "FAILED") {
    circuit = recordCircuitFailure(circuit, circuitPolicy, at);
    events.push({ phase: "FAILED", status: "FAILED", at, reason: "post-change-observation-failed" });
    return resultBase("FAILED", options.opportunity, priority, plan, circuit, events, "post-change-observation-failed", envelope, execution, validation, promotion, observation, null, null, recovery);
  }

  events.push({ phase: "EVALUATING", status: "EVALUATING", at, reason: "canonical-outcome-evaluation" });
  const outcome = evaluateEvolutionOutcome(await options.handlers.evaluate({ envelope, validation, observation }));
  events.push({ phase: "LEARNING", status: "LEARNING", at, reason: "bounded-learning-memory" });
  const learning = createEvolutionLearningRecord(await options.handlers.learn({ envelope, validation, observation, outcome }));
  const terminalStatus: EvolutionLifecycleStatus = outcome.outcome === "REGRESSION" || outcome.outcome === "UNDERPERFORMED" ? "FAILED" : outcome.outcome === "UNKNOWN" ? "ABSTAINED" : "COMPLETED";
  if (terminalStatus === "FAILED") circuit = recordCircuitFailure(circuit, circuitPolicy, at);
  else if (terminalStatus === "COMPLETED") circuit = resetCircuitBreaker();
  events.push({ phase: terminalStatus, status: terminalStatus, at, reason: outcome.outcome.toLowerCase() });
  return resultBase(terminalStatus, options.opportunity, priority, plan, circuit, events, outcome.outcome.toLowerCase(), envelope, execution, validation, promotion, observation, outcome, learning, recovery);
}
