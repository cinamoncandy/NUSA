import type { NusaDevelopmentPriority, NusaDevelopmentQueue, NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";

export const NUSA_DEVELOPMENT_MERGE_TRAIN_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

export type NusaAuditVerdict = "PASS" | "PASS_WITH_NOTES" | "FAIL";

export interface NusaExactHeadMergeEvidence {
  readonly workItemId: string;
  readonly headSha: string;
  readonly validatedHeadSha: string;
  readonly requiredChecksPassed: boolean;
  readonly safetyChecksPassed: boolean;
  readonly auditedHeadSha: string;
  readonly auditVerdict: NusaAuditVerdict;
  readonly auditMergeAllowed: boolean;
  readonly auditObservedAt: number;
  readonly unresolvedReviewThreads: number;
  readonly observedAt: number;
}

export type NusaMainMovementCrossCuttingImpact = "NONE" | "MATERIAL" | "UNKNOWN";
export type NusaMainMovementImpact = "UNCHANGED" | "NON_MATERIAL" | "REVALIDATION_REQUIRED" | "UNKNOWN";

export interface NusaMainMovementEvidence {
  readonly workItemId: string;
  readonly validatedBaseSha: string;
  readonly currentBaseSha: string;
  readonly changedFilesSinceValidation: readonly string[] | null;
  readonly mergedWorkItemIdsSinceValidation: readonly string[] | null;
  readonly crossCuttingImpact: NusaMainMovementCrossCuttingImpact;
  readonly observedAt: number;
}

export interface NusaMergeTrainPlanningContext {
  readonly mainMovementEvidence: readonly NusaMainMovementEvidence[];
}

export interface NusaMergeTrainEntry {
  readonly workItemId: string;
  readonly priority: NusaDevelopmentPriority;
  readonly headSha: string;
  readonly dependencies: readonly string[];
}

export interface NusaMergeTrainPlan {
  readonly schemaVersion: 1;
  readonly status: "READY" | "BLOCKED";
  readonly entries: readonly NusaMergeTrainEntry[];
  readonly blocked: Readonly<Record<string, readonly string[]>>;
}

const PRIORITY_RANK: Readonly<Record<NusaDevelopmentPriority, number>> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const isTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

function isCanonicalRepoPath(path: string): boolean {
  if (!path || path.startsWith("/") || path.endsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function assertMainMovementEvidence(evidence: NusaMainMovementEvidence): void {
  if (!evidence.workItemId.trim()) throw new Error("MAIN_MOVEMENT_WORK_ID_REQUIRED");
  if (!evidence.validatedBaseSha.trim() || !evidence.currentBaseSha.trim()) throw new Error(`MAIN_MOVEMENT_BASE_SHA_REQUIRED:${evidence.workItemId}`);
  if (!isTimestamp(evidence.observedAt)) throw new Error(`MAIN_MOVEMENT_TIMESTAMP_INVALID:${evidence.workItemId}`);
  if (evidence.changedFilesSinceValidation !== null) {
    const seen = new Set<string>();
    for (const path of evidence.changedFilesSinceValidation) {
      if (!isCanonicalRepoPath(path)) throw new Error(`MAIN_MOVEMENT_FILE_NOT_CANONICAL:${evidence.workItemId}:${path || "empty"}`);
      if (seen.has(path)) throw new Error(`MAIN_MOVEMENT_FILE_DUPLICATE:${evidence.workItemId}:${path}`);
      seen.add(path);
    }
  }
  if (evidence.mergedWorkItemIdsSinceValidation !== null) {
    const seen = new Set<string>();
    for (const id of evidence.mergedWorkItemIdsSinceValidation) {
      if (!id.trim()) throw new Error(`MAIN_MOVEMENT_MERGED_WORK_ID_REQUIRED:${evidence.workItemId}`);
      if (seen.has(id)) throw new Error(`MAIN_MOVEMENT_MERGED_WORK_ID_DUPLICATE:${evidence.workItemId}:${id}`);
      seen.add(id);
    }
  }
}

export function assessNusaDevelopmentMainMovement(
  item: NusaDevelopmentWorkItem,
  evidence: NusaMainMovementEvidence | undefined,
): NusaMainMovementImpact {
  if (!evidence) return "UNKNOWN";
  assertMainMovementEvidence(evidence);
  if (evidence.workItemId !== item.id) throw new Error(`MAIN_MOVEMENT_WORK_ID_MISMATCH:${item.id}:${evidence.workItemId}`);
  if (evidence.validatedBaseSha === evidence.currentBaseSha) return "UNCHANGED";
  if (evidence.crossCuttingImpact === "MATERIAL") return "REVALIDATION_REQUIRED";
  if (evidence.crossCuttingImpact === "UNKNOWN") return "UNKNOWN";
  if (evidence.changedFilesSinceValidation === null || evidence.mergedWorkItemIdsSinceValidation === null) return "UNKNOWN";
  if (item.touchedFiles.length === 0) return "UNKNOWN";

  const changedFiles = new Set(evidence.changedFilesSinceValidation);
  if (item.touchedFiles.some((path) => changedFiles.has(path))) return "REVALIDATION_REQUIRED";
  const mergedWorkItems = new Set(evidence.mergedWorkItemIdsSinceValidation);
  if (item.dependencies.some((dependency) => mergedWorkItems.has(dependency))) return "REVALIDATION_REQUIRED";
  return "NON_MATERIAL";
}

function mergeBlockers(
  item: NusaDevelopmentWorkItem,
  evidence: NusaExactHeadMergeEvidence | undefined,
  queue: NusaDevelopmentQueue,
  mainMovementImpact: NusaMainMovementImpact,
): readonly string[] {
  const blockers: string[] = [];
  if (item.state !== "MERGE_READY") blockers.push("STATE_NOT_MERGE_READY");
  for (const dependency of item.dependencies) {
    if (queue.items.find((candidate) => candidate.id === dependency)?.state !== "MERGED") blockers.push(`DEPENDENCY_NOT_MERGED:${dependency}`);
  }
  if (!evidence) return Object.freeze([...blockers, "EXACT_HEAD_EVIDENCE_MISSING"]);
  if (!evidence.headSha.trim() || !evidence.validatedHeadSha.trim()) blockers.push("HEAD_SHA_MISSING");
  if (evidence.headSha !== evidence.validatedHeadSha) blockers.push("EXACT_HEAD_MISMATCH");
  if (!evidence.requiredChecksPassed) blockers.push("REQUIRED_CHECKS_NOT_PASSED");
  if (!evidence.safetyChecksPassed) blockers.push("SAFETY_CHECKS_NOT_PASSED");
  if (!evidence.auditedHeadSha?.trim()) blockers.push("AUDIT_HEAD_SHA_MISSING");
  else if (evidence.auditedHeadSha !== evidence.headSha) blockers.push("AUDIT_HEAD_MISMATCH");
  if (evidence.auditVerdict !== "PASS" && evidence.auditVerdict !== "PASS_WITH_NOTES" && evidence.auditVerdict !== "FAIL") {
    blockers.push("AUDIT_VERDICT_INVALID");
  } else if (evidence.auditVerdict === "FAIL") {
    blockers.push("AUDIT_NOT_PASSED");
  }
  if (evidence.auditMergeAllowed !== true) blockers.push("AUDIT_MERGE_NOT_ALLOWED");
  if (!isTimestamp(evidence.auditObservedAt)) blockers.push("AUDIT_EVIDENCE_TIMESTAMP_INVALID");
  if (!Number.isSafeInteger(evidence.unresolvedReviewThreads) || evidence.unresolvedReviewThreads < 0) blockers.push("REVIEW_THREAD_COUNT_INVALID");
  else if (evidence.unresolvedReviewThreads > 0) blockers.push("UNRESOLVED_REVIEW_THREADS");
  if (!isTimestamp(evidence.observedAt)) blockers.push("EVIDENCE_TIMESTAMP_INVALID");
  if (mainMovementImpact === "REVALIDATION_REQUIRED") blockers.push("MAIN_MOVEMENT_REVALIDATION_REQUIRED");
  else if (mainMovementImpact === "UNKNOWN") blockers.push("MAIN_MOVEMENT_PROVENANCE_UNKNOWN");
  return Object.freeze(blockers);
}

export function planNusaDevelopmentMergeTrain(
  queue: NusaDevelopmentQueue,
  evidence: readonly NusaExactHeadMergeEvidence[],
  context?: NusaMergeTrainPlanningContext,
): NusaMergeTrainPlan {
  const evidenceById = new Map<string, NusaExactHeadMergeEvidence>();
  for (const item of evidence) {
    if (!item.workItemId.trim()) throw new Error("MERGE_EVIDENCE_WORK_ID_REQUIRED");
    if (evidenceById.has(item.workItemId)) throw new Error(`MERGE_EVIDENCE_DUPLICATE:${item.workItemId}`);
    evidenceById.set(item.workItemId, item);
  }

  const mainMovementById = new Map<string, NusaMainMovementEvidence>();
  for (const movement of context?.mainMovementEvidence ?? []) {
    assertMainMovementEvidence(movement);
    if (mainMovementById.has(movement.workItemId)) throw new Error(`MAIN_MOVEMENT_EVIDENCE_DUPLICATE:${movement.workItemId}`);
    mainMovementById.set(movement.workItemId, movement);
  }

  const blocked: Record<string, readonly string[]> = {};
  const ready: NusaMergeTrainEntry[] = [];
  for (const item of queue.items.filter((candidate) => candidate.state === "MERGE_READY")) {
    const itemEvidence = evidenceById.get(item.id);
    const mainMovementImpact = assessNusaDevelopmentMainMovement(item, mainMovementById.get(item.id));
    const blockers = mergeBlockers(item, itemEvidence, queue, mainMovementImpact);
    if (blockers.length > 0) {
      blocked[item.id] = blockers;
      continue;
    }
    ready.push(Object.freeze({
      workItemId: item.id,
      priority: item.priority,
      headSha: itemEvidence!.headSha,
      dependencies: Object.freeze([...item.dependencies]),
    }));
  }

  ready.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.workItemId.localeCompare(b.workItemId));
  return Object.freeze({
    schemaVersion: 1 as const,
    status: Object.keys(blocked).length > 0 ? "BLOCKED" as const : "READY" as const,
    entries: Object.freeze(ready),
    blocked: Object.freeze(blocked),
  });
}
