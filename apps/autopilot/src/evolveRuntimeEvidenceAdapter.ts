import type { EvolutionLifecycleInput } from "./evolveLifecycle";
import { validateEvolutionValidationResult } from "./evolveValidation";

export interface EvolutionRuntimeEvidenceSnapshot {
  readonly lifecycle: Omit<EvolutionLifecycleInput, "opportunity">;
  readonly sources: readonly string[];
}

export type EvolutionRuntimeEvidenceAdapterResult =
  | {
      readonly status: "READY";
      readonly lifecycle: Omit<EvolutionLifecycleInput, "opportunity">;
      readonly sources: readonly string[];
    }
  | {
      readonly status: "ABSTAIN";
      readonly reason: string;
      readonly sources: readonly string[];
    };

const SHA40 = /^[0-9a-f]{40}$/i;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDate = (value: string): boolean => Number.isFinite(Date.parse(value));
const freezeSources = (sources: readonly string[]): readonly string[] => Object.freeze(sources.map((source) => source.trim()));

function abstain(reason: string, sources: readonly string[]): EvolutionRuntimeEvidenceAdapterResult {
  return Object.freeze({ status: "ABSTAIN", reason, sources: freezeSources(sources) });
}

/**
 * Converts already-observed runtime evidence into the existing lifecycle input.
 * It does not synthesize validation, deployment health, outcomes, execution
 * identity, scheduling state, or circuit state. Any missing or incoherent
 * evidence fails closed so scheduled execution cannot manufacture a lifecycle.
 */
export function adaptRuntimeEvidenceToLifecycle(
  snapshot: EvolutionRuntimeEvidenceSnapshot,
): EvolutionRuntimeEvidenceAdapterResult {
  const sources = snapshot.sources ?? [];
  if (sources.length === 0 || sources.some((source) => !text(source))) return abstain("runtime-evidence-sources-required", sources);

  const lifecycle = snapshot.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") return abstain("runtime-lifecycle-evidence-required", sources);

  if (!text(lifecycle.execution.executionId) || !text(lifecycle.execution.dedupeKey) || !text(lifecycle.execution.repository)) {
    return abstain("runtime-execution-identity-required", sources);
  }
  if (lifecycle.execution.authority !== "ZERO_AUTHORITY") return abstain("runtime-execution-authority-invalid", sources);
  if (!SHA40.test(lifecycle.execution.headSha)) return abstain("runtime-execution-head-invalid", sources);

  try {
    validateEvolutionValidationResult(lifecycle.validation);
  } catch {
    return abstain("runtime-validation-evidence-invalid", sources);
  }

  if (!SHA40.test(lifecycle.validation.exactHeadSha) || lifecycle.validation.evidence.length === 0) {
    return abstain("runtime-validation-evidence-required", sources);
  }
  if (!text(lifecycle.validation.opportunityId) || !text(lifecycle.validation.reason)) {
    return abstain("runtime-validation-identity-required", sources);
  }
  if (lifecycle.validation.evidence.some((item) => !text(item.check) || !text(item.reference))) {
    return abstain("runtime-validation-reference-invalid", sources);
  }

  if (lifecycle.execution.headSha !== lifecycle.validation.exactHeadSha) return abstain("runtime-exact-head-mismatch", sources);
  if (!SHA40.test(lifecycle.observation.revision)) return abstain("runtime-observation-revision-invalid", sources);
  if (lifecycle.observation.revision !== lifecycle.validation.exactHeadSha) return abstain("runtime-observation-revision-mismatch", sources);

  if (lifecycle.outcome.evidence.length === 0 || lifecycle.outcome.evidence.some((reference) => !text(reference))) {
    return abstain("runtime-outcome-evidence-required", sources);
  }
  if (lifecycle.outcome.observedAt !== undefined && !validDate(lifecycle.outcome.observedAt)) {
    return abstain("runtime-outcome-time-invalid", sources);
  }
  if (!text(lifecycle.changeReference) || !text(lifecycle.targetBranch)) return abstain("runtime-change-reference-required", sources);

  if (!validDate(lifecycle.circuit.now) || !validDate(lifecycle.schedule.generatedAt)) {
    return abstain("runtime-control-time-invalid", sources);
  }
  if (!Number.isInteger(lifecycle.schedule.activeExecutions) || lifecycle.schedule.activeExecutions < 0
    || !Number.isInteger(lifecycle.schedule.elapsedSecondsSinceLastRun) || lifecycle.schedule.elapsedSecondsSinceLastRun < 0
    || !Number.isInteger(lifecycle.schedule.queuedOpportunities) || lifecycle.schedule.queuedOpportunities < 0) {
    return abstain("runtime-schedule-state-invalid", sources);
  }
  if (!Number.isInteger(lifecycle.recovery.attempts) || lifecycle.recovery.attempts < 0) {
    return abstain("runtime-recovery-state-invalid", sources);
  }

  return Object.freeze({
    status: "READY",
    lifecycle: Object.freeze({ ...lifecycle }),
    sources: freezeSources(sources),
  });
}
