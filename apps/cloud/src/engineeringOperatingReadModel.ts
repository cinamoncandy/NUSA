import {
  decideNusaAdaptiveConcurrency,
  type NusaConcurrencyDecision,
  type NusaConcurrencyEvidence,
} from "../../desktop/src/cloud/nusaAdaptiveConcurrency";
import {
  projectNusaEngineeringExecutionOrigin,
  type NusaEngineeringExecutionEvidence,
  type NusaEngineeringExecutionOriginProjection,
} from "../../desktop/src/cloud/nusaEngineeringExecutionOrigin";
import {
  assessNusaCiCriticalPathOutcome,
  type NusaEngineeringCiOutcomeAssessment,
  type NusaEngineeringCiOutcomeEvidence,
} from "../../desktop/src/cloud/nusaEngineeringOutcomeFeedback";
import {
  rankEngineeringOpportunities,
  type EngineeringOpportunityPriorityDecision,
  type EngineeringOpportunityPriorityInput,
} from "../../desktop/src/cloud/nusaEngineeringPortfolioScheduler";
import {
  selectEngineeringSystemOptimization,
  type EngineeringSelfOptimizerDecision,
  type EngineeringSelfOptimizerEvidence,
} from "../../desktop/src/cloud/nusaEngineeringSelfOptimizer";
import type { NusaDevelopmentQueue, NusaDevelopmentWorkState } from "../../desktop/src/cloud/nusaDevelopmentControlPlane";

export const NUSA_ENGINEERING_OPERATING_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
  mutationAllowed: false as const,
});

export type NusaEngineeringOperatingStatus = "VERIFIED" | "INSUFFICIENT" | "UNAVAILABLE";

export interface NusaEngineeringOperatingInput {
  readonly observedAt: number;
  readonly currentHeadSha: string | null;
  readonly opportunities: readonly EngineeringOpportunityPriorityInput[];
  readonly selfOptimizer: EngineeringSelfOptimizerEvidence;
  readonly concurrency: NusaConcurrencyEvidence;
  readonly executionEvidence: NusaEngineeringExecutionEvidence | null;
  readonly outcomeEvidence: NusaEngineeringCiOutcomeEvidence;
  readonly queue: NusaDevelopmentQueue | null;
}

export interface NusaEngineeringQueueProjection {
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly revision: number | null;
  readonly totalItems: number;
  readonly activeItems: number;
  readonly mergeReadyItems: number;
}

export interface NusaEngineeringOperatingSnapshot {
  readonly schemaVersion: 1;
  readonly scope: "ENGINEERING_OPERATIONS_READ_ONLY";
  readonly status: NusaEngineeringOperatingStatus;
  readonly observedAt: number;
  readonly currentHeadSha: string | null;
  readonly sourceFingerprints: readonly string[];
  readonly opportunityPriority: readonly EngineeringOpportunityPriorityDecision[];
  readonly selfOptimizer: EngineeringSelfOptimizerDecision;
  readonly adaptiveConcurrency: NusaConcurrencyDecision;
  readonly executionOrigin: NusaEngineeringExecutionOriginProjection;
  readonly outcome: NusaEngineeringCiOutcomeAssessment;
  readonly queue: NusaEngineeringQueueProjection;
  readonly blockers: readonly string[];
  readonly authority: typeof NUSA_ENGINEERING_OPERATING_AUTHORITY;
}

export type NusaEngineeringOperatingSource = () => NusaEngineeringOperatingInput;

export interface NusaEngineeringOperatingReadModel {
  readonly getSnapshot: () => NusaEngineeringOperatingSnapshot;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const ACTIVE_STATES: ReadonlySet<NusaDevelopmentWorkState> = new Set([
  "CLAIMED",
  "IMPLEMENTING",
  "VALIDATING",
  "CI",
  "MERGE_READY",
]);

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function uniqueSorted(values: readonly string[]): readonly string[] {
  return freeze([...new Set(values.filter((value) => value.trim() !== ""))].sort());
}

function unavailableSelfOptimizer(): EngineeringSelfOptimizerDecision {
  return selectEngineeringSystemOptimization({
    observationCount: 0,
    ciP95Normalized: "UNKNOWN",
    conflictRate: "UNKNOWN",
    reworkRate: "UNKNOWN",
    idleRatio: "UNKNOWN",
    blockedTimeRatio: "UNKNOWN",
  });
}

function unavailableConcurrency(): NusaConcurrencyDecision {
  return decideNusaAdaptiveConcurrency({
    mergedWorkCount: 0,
    reworkCount: 0,
    conflictCount: 0,
    ciCapacitySlots: null,
    ciPeakConcurrentJobs: null,
  });
}

function unavailableOutcome(): NusaEngineeringCiOutcomeAssessment {
  return assessNusaCiCriticalPathOutcome({
    baseline: null,
    postMerge: null,
    minimumMeaningfulChange: 0,
  });
}

function unavailableSnapshot(reason = "ENGINEERING_SOURCE_UNAVAILABLE"): NusaEngineeringOperatingSnapshot {
  return freeze({
    schemaVersion: 1,
    scope: "ENGINEERING_OPERATIONS_READ_ONLY",
    status: "UNAVAILABLE",
    observedAt: 0,
    currentHeadSha: null,
    sourceFingerprints: freeze([]),
    opportunityPriority: freeze([]),
    selfOptimizer: unavailableSelfOptimizer(),
    adaptiveConcurrency: unavailableConcurrency(),
    executionOrigin: projectNusaEngineeringExecutionOrigin(null),
    outcome: unavailableOutcome(),
    queue: freeze({ status: "UNAVAILABLE", revision: null, totalItems: 0, activeItems: 0, mergeReadyItems: 0 }),
    blockers: freeze([reason]),
    authority: NUSA_ENGINEERING_OPERATING_AUTHORITY,
  });
}

function projectQueue(queue: NusaDevelopmentQueue | null): NusaEngineeringQueueProjection {
  if (queue == null) return freeze({ status: "UNAVAILABLE", revision: null, totalItems: 0, activeItems: 0, mergeReadyItems: 0 });
  if (queue.schemaVersion !== 1 || !Number.isSafeInteger(queue.revision) || queue.revision < 0 || !Array.isArray(queue.items)) {
    throw new Error("ENGINEERING_QUEUE_EVIDENCE_INVALID");
  }
  return freeze({
    status: "AVAILABLE",
    revision: queue.revision,
    totalItems: queue.items.length,
    activeItems: queue.items.filter((item) => ACTIVE_STATES.has(item.state)).length,
    mergeReadyItems: queue.items.filter((item) => item.state === "MERGE_READY").length,
  });
}

function validateInput(input: NusaEngineeringOperatingInput): void {
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) throw new Error("ENGINEERING_OBSERVED_AT_INVALID");
  if (input.currentHeadSha != null && !SHA40.test(input.currentHeadSha)) throw new Error("ENGINEERING_CURRENT_HEAD_INVALID");
  if (!Array.isArray(input.opportunities)) throw new Error("ENGINEERING_OPPORTUNITIES_INVALID");
}

function outcomeSourceFingerprints(
  outcome: NusaEngineeringCiOutcomeAssessment,
  executionOrigin: NusaEngineeringExecutionOriginProjection,
): readonly string[] {
  const fingerprints = [
    ...outcome.baselineSourceFingerprints,
    ...outcome.postMergeSourceFingerprints,
    ...(executionOrigin.sourceFingerprint == null ? [] : [executionOrigin.sourceFingerprint]),
  ];
  if (fingerprints.some((fingerprint) => !SHA64.test(fingerprint))) throw new Error("ENGINEERING_SOURCE_FINGERPRINT_INVALID");
  return uniqueSorted(fingerprints);
}

function readModelBlockers(
  input: NusaEngineeringOperatingInput,
  priorities: readonly EngineeringOpportunityPriorityDecision[],
  selfOptimizer: EngineeringSelfOptimizerDecision,
  concurrency: NusaConcurrencyDecision,
  executionOrigin: NusaEngineeringExecutionOriginProjection,
  outcome: NusaEngineeringCiOutcomeAssessment,
  queue: NusaEngineeringQueueProjection,
): readonly string[] {
  const blockers: string[] = [];
  if (input.currentHeadSha == null) blockers.push("CURRENT_HEAD_EVIDENCE_MISSING");
  if (selfOptimizer.classification !== "MEASURED") blockers.push(...selfOptimizer.reasons.map((reason) => `SELF_OPTIMIZER:${reason}`));
  if (concurrency.classification !== "MEASURED") blockers.push(...concurrency.reasons.map((reason) => `ADAPTIVE_CONCURRENCY:${reason}`));
  if (outcome.classification === "INSUFFICIENT") blockers.push(...outcome.reasons.map((reason) => `OUTCOME:${reason}`));
  if (executionOrigin.status !== "VERIFIED") blockers.push(...executionOrigin.reasons.map((reason) => `EXECUTION_ORIGIN:${reason}`));
  if (queue.status !== "AVAILABLE") blockers.push("DEVELOPMENT_QUEUE_EVIDENCE_MISSING");
  if (priorities.some((decision) => decision.classification !== "RANKABLE")) blockers.push("OPPORTUNITY_PRIORITY_EVIDENCE_INSUFFICIENT");
  if (outcome.postMergeHeadSha != null && input.currentHeadSha != null && outcome.postMergeHeadSha !== input.currentHeadSha) blockers.push("POST_MERGE_HEAD_NOT_CURRENT");
  return uniqueSorted(blockers);
}

/**
 * Composes the existing Engineering OS evidence engines into one read-only production model.
 * This function only projects evidence: queue claims, GitHub dispatch, merges, and all trading
 * mutations remain outside its contract.
 */
export function buildNusaEngineeringOperatingSnapshot(input: NusaEngineeringOperatingInput): NusaEngineeringOperatingSnapshot {
  validateInput(input);
  const opportunityPriority = rankEngineeringOpportunities(input.opportunities);
  const selfOptimizer = selectEngineeringSystemOptimization(input.selfOptimizer);
  const adaptiveConcurrency = decideNusaAdaptiveConcurrency(input.concurrency);
  const executionOrigin = projectNusaEngineeringExecutionOrigin(input.executionEvidence);
  const outcome = assessNusaCiCriticalPathOutcome(input.outcomeEvidence);
  const queue = projectQueue(input.queue);
  const blockers = readModelBlockers(input, opportunityPriority, selfOptimizer, adaptiveConcurrency, executionOrigin, outcome, queue);
  return freeze({
    schemaVersion: 1,
    scope: "ENGINEERING_OPERATIONS_READ_ONLY",
    status: blockers.length === 0 ? "VERIFIED" : "INSUFFICIENT",
    observedAt: input.observedAt,
    currentHeadSha: input.currentHeadSha,
    sourceFingerprints: outcomeSourceFingerprints(outcome, executionOrigin),
    opportunityPriority: freeze(opportunityPriority),
    selfOptimizer,
    adaptiveConcurrency,
    executionOrigin,
    outcome,
    queue,
    blockers,
    authority: NUSA_ENGINEERING_OPERATING_AUTHORITY,
  });
}

/**
 * Main-process composition boundary. A missing or failed canonical source is surfaced as
 * UNAVAILABLE; no default metric, queue, or outcome is synthesized to make the model green.
 */
export function createNusaEngineeringOperatingReadModel(source?: NusaEngineeringOperatingSource): NusaEngineeringOperatingReadModel {
  return Object.freeze({
    getSnapshot: (): NusaEngineeringOperatingSnapshot => {
      if (source == null) return unavailableSnapshot();
      try {
        return buildNusaEngineeringOperatingSnapshot(source());
      } catch {
        return unavailableSnapshot();
      }
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function validateQueueProjection(value: unknown): void {
  if (!isRecord(value)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID");
  const { status, revision, totalItems, activeItems, mergeReadyItems } = value;
  if (status !== "AVAILABLE" && status !== "UNAVAILABLE") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID");
  for (const count of [totalItems, activeItems, mergeReadyItems]) {
    if (!Number.isSafeInteger(count) || (count as number) < 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID");
  }
  if ((activeItems as number) > (totalItems as number) || (mergeReadyItems as number) > (activeItems as number)) {
    throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INCONSISTENT");
  }
  if (status === "AVAILABLE") {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID");
  } else if (revision !== null || totalItems !== 0 || activeItems !== 0 || mergeReadyItems !== 0) {
    throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INCONSISTENT");
  }
}

function validateProjectionObject(value: unknown, errorCode: string): void {
  if (!isRecord(value)) throw new Error(errorCode);
}

export function validateNusaEngineeringOperatingSnapshot(value: unknown): NusaEngineeringOperatingSnapshot {
  if (!isRecord(value)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_INVALID");
  const candidate = value as Partial<NusaEngineeringOperatingSnapshot>;
  if (candidate.schemaVersion !== 1 || candidate.scope !== "ENGINEERING_OPERATIONS_READ_ONLY") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_SCHEMA_INVALID");
  if (candidate.status !== "VERIFIED" && candidate.status !== "INSUFFICIENT" && candidate.status !== "UNAVAILABLE") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_STATUS_INVALID");
  if (!Number.isSafeInteger(candidate.observedAt) || (candidate.observedAt as number) < 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_TIME_INVALID");
  if (candidate.currentHeadSha != null && !SHA40.test(candidate.currentHeadSha)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_HEAD_INVALID");
  if (!Array.isArray(candidate.blockers) || candidate.blockers.some((reason) => typeof reason !== "string" || reason.trim() === "")) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_BLOCKERS_INVALID");
  if (!Array.isArray(candidate.sourceFingerprints) || candidate.sourceFingerprints.some((fingerprint) => typeof fingerprint !== "string" || !SHA64.test(fingerprint))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_PROVENANCE_INVALID");
  if (new Set(candidate.sourceFingerprints).size !== candidate.sourceFingerprints.length) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_PROVENANCE_DUPLICATE");
  if (!Array.isArray(candidate.opportunityPriority)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_PRIORITY_INVALID");
  if (candidate.opportunityPriority.some((decision) => !isRecord(decision))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_PRIORITY_INVALID");
  validateProjectionObject(candidate.selfOptimizer, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_INVALID");
  validateProjectionObject(candidate.adaptiveConcurrency, "ENGINEERING_OPERATIONS_SNAPSHOT_CONCURRENCY_INVALID");
  validateProjectionObject(candidate.executionOrigin, "ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_ORIGIN_INVALID");
  validateProjectionObject(candidate.outcome, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_INVALID");
  validateQueueProjection(candidate.queue);
  if (candidate.status === "VERIFIED") {
    if (candidate.blockers.length !== 0 || candidate.currentHeadSha == null || candidate.queue?.status !== "AVAILABLE") {
      throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_VERIFIED_INCONSISTENT");
    }
  } else if (candidate.blockers.length === 0) {
    throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_NONVERIFIED_WITHOUT_BLOCKER");
  }
  if (candidate.authority?.liveAuthority !== "NONE" || candidate.authority?.productionMutationAllowed !== false || candidate.authority?.aiAuthority !== "ZERO_AUTHORITY" || candidate.authority?.mutationAllowed !== false) throw new Error("ENGINEERING_OPERATIONS_AUTHORITY_VIOLATION");
  return value as NusaEngineeringOperatingSnapshot;
}
