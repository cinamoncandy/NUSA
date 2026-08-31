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
import {
  createNusaDevelopmentQueue,
  type NusaDevelopmentQueue,
  type NusaDevelopmentWorkState,
} from "../../desktop/src/cloud/nusaDevelopmentControlPlane";

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
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_REASON = /^[A-Z0-9_.:-]{1,160}$/;
const SAFE_URI = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._:/-]+$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?(?:id|identifier)|exchange[_-]?account[_-]?(?:id|identifier)|order[_-]?(?:id|identifier)|fill[_-]?(?:id|identifier))/i;
const ACTIVE_STATES: ReadonlySet<NusaDevelopmentWorkState> = new Set([
  "CLAIMED",
  "IMPLEMENTING",
  "VALIDATING",
  "CI",
  "MERGE_READY",
]);
const QUEUE_STATES: ReadonlySet<NusaDevelopmentWorkState> = new Set([
  "READY",
  "CLAIMED",
  "IMPLEMENTING",
  "VALIDATING",
  "CI",
  "MERGE_READY",
  "MERGED",
  "BLOCKED_HUMAN",
]);
const QUEUE_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const MAX_QUEUE_TEXT_LENGTH = 1024;

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
  if (typeof queue !== "object" || Array.isArray(queue) || queue.schemaVersion !== 1 || !Number.isSafeInteger(queue.revision) || queue.revision < 0 || !Array.isArray(queue.items)) {
    throw new Error("ENGINEERING_QUEUE_EVIDENCE_INVALID");
  }
  for (const rawItem of queue.items as readonly unknown[]) {
    const item = record(rawItem, "ENGINEERING_QUEUE_ITEM_INVALID");
    queueText(item.id, "ENGINEERING_QUEUE_ITEM_ID_INVALID");
    if (typeof item.state !== "string" || !QUEUE_STATES.has(item.state as NusaDevelopmentWorkState)) throw new Error("ENGINEERING_QUEUE_ITEM_STATE_INVALID");
    if (typeof item.priority !== "string" || !QUEUE_PRIORITIES.has(item.priority)) throw new Error("ENGINEERING_QUEUE_ITEM_PRIORITY_INVALID");
    queueTextArray(item.dependencies, "ENGINEERING_QUEUE_ITEM_DEPENDENCIES_INVALID");
    queueTextArray(item.touchedFiles, "ENGINEERING_QUEUE_ITEM_TOUCHED_FILES_INVALID");
    queueTextArray(item.evidenceRequirements, "ENGINEERING_QUEUE_ITEM_EVIDENCE_INVALID");
    if (item.canonicalOwner !== null) queueText(item.canonicalOwner, "ENGINEERING_QUEUE_ITEM_OWNER_INVALID");
    queueText(item.nextAction, "ENGINEERING_QUEUE_ITEM_NEXT_ACTION_INVALID");
    nonNegativeInteger(item.createdAt, "ENGINEERING_QUEUE_ITEM_CREATED_AT_INVALID");
    if (item.claim !== null) {
      const claim = record(item.claim, "ENGINEERING_QUEUE_ITEM_CLAIM_INVALID");
      queueText(claim.owner, "ENGINEERING_QUEUE_ITEM_CLAIM_OWNER_INVALID");
      queueText(claim.requestId, "ENGINEERING_QUEUE_ITEM_CLAIM_REQUEST_INVALID");
      const claimedAt = nonNegativeIntegerValue(claim.claimedAt, "ENGINEERING_QUEUE_ITEM_CLAIMED_AT_INVALID");
      const leaseExpiresAt = nonNegativeIntegerValue(claim.leaseExpiresAt, "ENGINEERING_QUEUE_ITEM_LEASE_EXPIRES_AT_INVALID");
      if (leaseExpiresAt <= claimedAt) throw new Error("ENGINEERING_QUEUE_ITEM_LEASE_INVALID");
    }
  }
  const canonicalQueue = createNusaDevelopmentQueue(queue.items, queue.revision);
  return freeze({
    status: "AVAILABLE",
    revision: canonicalQueue.revision,
    totalItems: canonicalQueue.items.length,
    activeItems: canonicalQueue.items.filter((item) => ACTIVE_STATES.has(item.state)).length,
    mergeReadyItems: canonicalQueue.items.filter((item) => item.state === "MERGE_READY").length,
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

export function validateNusaEngineeringOperatingSnapshot(value: unknown): NusaEngineeringOperatingSnapshot {
  if (value == null || typeof value !== "object") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_INVALID");
  rejectForbiddenKeys(value);
  const candidate = value as Partial<NusaEngineeringOperatingSnapshot>;
  if (candidate.schemaVersion !== 1 || candidate.scope !== "ENGINEERING_OPERATIONS_READ_ONLY") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_SCHEMA_INVALID");
  if (candidate.status !== "VERIFIED" && candidate.status !== "INSUFFICIENT" && candidate.status !== "UNAVAILABLE") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_STATUS_INVALID");
  if (!Number.isSafeInteger(candidate.observedAt) || (candidate.observedAt as number) < 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_TIME_INVALID");
  if (candidate.currentHeadSha != null && !SHA40.test(candidate.currentHeadSha)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_HEAD_INVALID");
  if (!Array.isArray(candidate.blockers) || candidate.blockers.some((reason) => typeof reason !== "string")) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_BLOCKERS_INVALID");
  if (!Array.isArray(candidate.sourceFingerprints) || candidate.sourceFingerprints.some((fingerprint) => typeof fingerprint !== "string" || !SHA64.test(fingerprint))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_PROVENANCE_INVALID");
  validateSnapshotCollections(candidate);
  if (candidate.status === "VERIFIED" && candidate.blockers.length !== 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_VERIFIED_WITH_BLOCKERS");
  if (candidate.status === "INSUFFICIENT" && candidate.blockers.length === 0) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_INSUFFICIENT_WITHOUT_BLOCKER");
  if (candidate.authority?.liveAuthority !== "NONE" || candidate.authority?.productionMutationAllowed !== false || candidate.authority?.aiAuthority !== "ZERO_AUTHORITY" || candidate.authority?.mutationAllowed !== false) throw new Error("ENGINEERING_OPERATIONS_AUTHORITY_VIOLATION");
  return value as NusaEngineeringOperatingSnapshot;
}

function rejectForbiddenKeys(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("ENGINEERING_OPERATIONS_CYCLIC_VALUE");
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error("ENGINEERING_OPERATIONS_FORBIDDEN_FIELD");
    rejectForbiddenKeys(child, seen);
  }
  seen.delete(value);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, code: string): void {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) throw new Error(code);
}

function reasons(value: unknown, code: string): void {
  if (!Array.isArray(value) || value.some((reason) => typeof reason !== "string" || !SAFE_REASON.test(reason))) throw new Error(code);
}

function nonNegativeInteger(value: unknown, code: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
}

function nonNegativeIntegerValue(value: unknown, code: string): number {
  nonNegativeInteger(value, code);
  return value as number;
}

function queueText(value: unknown, code: string): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_QUEUE_TEXT_LENGTH) throw new Error(code);
}

function queueTextArray(value: unknown, code: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "" || entry.length > MAX_QUEUE_TEXT_LENGTH)) {
    throw new Error(code);
  }
}

function nullableFinite(value: unknown, code: string): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(code);
}

function boundedMetric(value: unknown, code: string): void {
  if (value === "UNKNOWN") return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
}

function validateSnapshotCollections(candidate: Partial<NusaEngineeringOperatingSnapshot>): void {
  if (!Array.isArray(candidate.opportunityPriority)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITIES_INVALID");
  for (const raw of candidate.opportunityPriority) {
    const item = record(raw, "ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_INVALID");
    identifier(item.opportunityId, "ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_ID_INVALID");
    if (item.classification !== "RANKABLE" && item.classification !== "INSUFFICIENT") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_CLASSIFICATION_INVALID");
    nullableFinite(item.score, "ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_SCORE_INVALID");
    const components = record(item.components, "ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_COMPONENTS_INVALID");
    for (const name of ["expectedProductValue", "riskReduction", "evidenceGain", "criticalPathUnlock", "effortCost", "dependencyFanOut", "uncertainty"] as const) {
      const component = components[name];
      if (component !== "UNKNOWN" && (typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 100)) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_COMPONENT_INVALID");
    }
    reasons(item.reasons, "ENGINEERING_OPERATIONS_SNAPSHOT_OPPORTUNITY_REASONS_INVALID");
  }

  const selfOptimizer = record(candidate.selfOptimizer, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_INVALID");
  if (!["CI_CRITICAL_PATH", "CONFLICT_ALLOCATION", "REWORK_REDUCTION", "IDLE_DEPENDENCY_FLOW", "BLOCKED_TIME_REDUCTION", "INSUFFICIENT_EVIDENCE"].includes(String(selfOptimizer.target))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_TARGET_INVALID");
  if (selfOptimizer.classification !== "MEASURED" && selfOptimizer.classification !== "INSUFFICIENT") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_CLASSIFICATION_INVALID");
  const selfEvidence = record(selfOptimizer.evidence, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_EVIDENCE_INVALID");
  nonNegativeInteger(selfEvidence.observationCount, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_COUNT_INVALID");
  for (const name of ["ciP95Normalized", "conflictRate", "reworkRate", "idleRatio", "blockedTimeRatio"] as const) boundedMetric(selfEvidence[name], "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_METRIC_INVALID");
  if (selfOptimizer.dominantMetric !== null && typeof selfOptimizer.dominantMetric !== "string") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_DOMINANT_INVALID");
  nullableFinite(selfOptimizer.dominantValue, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_VALUE_INVALID");
  reasons(selfOptimizer.reasons, "ENGINEERING_OPERATIONS_SNAPSHOT_SELF_OPTIMIZER_REASONS_INVALID");

  const concurrency = record(candidate.adaptiveConcurrency, "ENGINEERING_OPERATIONS_SNAPSHOT_CONCURRENCY_INVALID");
  if (concurrency.classification !== "CONSERVATIVE" && concurrency.classification !== "MEASURED") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_CONCURRENCY_CLASSIFICATION_INVALID");
  if (!Number.isSafeInteger(concurrency.maximumActiveWorkPerOwner) || (concurrency.maximumActiveWorkPerOwner as number) < 1) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_CONCURRENCY_LIMIT_INVALID");
  reasons(concurrency.reasons, "ENGINEERING_OPERATIONS_SNAPSHOT_CONCURRENCY_REASONS_INVALID");

  const executionOrigin = record(candidate.executionOrigin, "ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_ORIGIN_INVALID");
  if (executionOrigin.schemaVersion !== 1 || (executionOrigin.status !== "VERIFIED" && executionOrigin.status !== "UNKNOWN")) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_ORIGIN_SCHEMA_INVALID");
  if (executionOrigin.origin !== null && executionOrigin.origin !== "AUTO_BACKGROUND" && executionOrigin.origin !== "USER_TRIGGERED") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_ORIGIN_VALUE_INVALID");
  if (executionOrigin.executionId !== null) identifier(executionOrigin.executionId, "ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_ID_INVALID");
  if (executionOrigin.observedAt !== null) nonNegativeInteger(executionOrigin.observedAt, "ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_TIME_INVALID");
  if (executionOrigin.sourceRef !== null && (typeof executionOrigin.sourceRef !== "string" || !SAFE_URI.test(executionOrigin.sourceRef))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_SOURCE_INVALID");
  if (executionOrigin.sourceFingerprint !== null && (typeof executionOrigin.sourceFingerprint !== "string" || !SHA64.test(executionOrigin.sourceFingerprint))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_FINGERPRINT_INVALID");
  if (!Array.isArray(executionOrigin.evidenceRefs) || executionOrigin.evidenceRefs.some((ref) => typeof ref !== "string" || !SAFE_URI.test(ref))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_REFS_INVALID");
  reasons(executionOrigin.reasons, "ENGINEERING_OPERATIONS_SNAPSHOT_EXECUTION_REASONS_INVALID");

  const outcome = record(candidate.outcome, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_INVALID");
  if (outcome.schemaVersion !== 1 || outcome.metricId !== "ci-workflow-p95-ms") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_SCHEMA_INVALID");
  if (!["VERIFIED_IMPROVEMENT", "NEUTRAL", "REGRESSION", "INSUFFICIENT"].includes(String(outcome.classification))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_CLASSIFICATION_INVALID");
  if (outcome.recommendation !== "KEEP" && outcome.recommendation !== "OBSERVE" && outcome.recommendation !== "ROLLBACK_OR_REWORK") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_RECOMMENDATION_INVALID");
  nullableFinite(outcome.baseline, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_BASELINE_INVALID");
  nullableFinite(outcome.postMerge, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_POST_MERGE_INVALID");
  nullableFinite(outcome.delta, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_DELTA_INVALID");
  if (outcome.baselineHeadSha !== null && (typeof outcome.baselineHeadSha !== "string" || !SHA40.test(outcome.baselineHeadSha))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_BASELINE_HEAD_INVALID");
  if (outcome.postMergeHeadSha !== null && (typeof outcome.postMergeHeadSha !== "string" || !SHA40.test(outcome.postMergeHeadSha))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_POST_HEAD_INVALID");
  for (const name of ["baselineSourceFingerprints", "postMergeSourceFingerprints"] as const) {
    const fingerprints = outcome[name];
    if (!Array.isArray(fingerprints) || fingerprints.some((fingerprint) => typeof fingerprint !== "string" || !SHA64.test(fingerprint))) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_PROVENANCE_INVALID");
  }
  reasons(outcome.reasons, "ENGINEERING_OPERATIONS_SNAPSHOT_OUTCOME_REASONS_INVALID");

  const queue = record(candidate.queue, "ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID");
  if (queue.status !== "AVAILABLE" && queue.status !== "UNAVAILABLE") throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_STATUS_INVALID");
  if (queue.revision !== null) nonNegativeInteger(queue.revision, "ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_REVISION_INVALID");
  for (const name of ["totalItems", "activeItems", "mergeReadyItems"] as const) nonNegativeInteger(queue[name], "ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_COUNT_INVALID");
  if (queue.status === "AVAILABLE" && queue.revision === null) throw new Error("ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_REVISION_MISSING");
}
