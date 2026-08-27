import type { NusaDevelopmentPriority, NusaDevelopmentQueue, NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";

export const NUSA_DEVELOPMENT_MERGE_TRAIN_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

export interface NusaExactHeadMergeEvidence {
  readonly workItemId: string;
  readonly headSha: string;
  readonly validatedHeadSha: string;
  readonly requiredChecksPassed: boolean;
  readonly safetyChecksPassed: boolean;
  readonly unresolvedReviewThreads: number;
  readonly observedAt: number;
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

function mergeBlockers(item: NusaDevelopmentWorkItem, evidence: NusaExactHeadMergeEvidence | undefined, queue: NusaDevelopmentQueue): readonly string[] {
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
  if (!Number.isSafeInteger(evidence.unresolvedReviewThreads) || evidence.unresolvedReviewThreads < 0) blockers.push("REVIEW_THREAD_COUNT_INVALID");
  else if (evidence.unresolvedReviewThreads > 0) blockers.push("UNRESOLVED_REVIEW_THREADS");
  if (!isTimestamp(evidence.observedAt)) blockers.push("EVIDENCE_TIMESTAMP_INVALID");
  return Object.freeze(blockers);
}

export function planNusaDevelopmentMergeTrain(queue: NusaDevelopmentQueue, evidence: readonly NusaExactHeadMergeEvidence[]): NusaMergeTrainPlan {
  const evidenceById = new Map<string, NusaExactHeadMergeEvidence>();
  for (const item of evidence) {
    if (!item.workItemId.trim()) throw new Error("MERGE_EVIDENCE_WORK_ID_REQUIRED");
    if (evidenceById.has(item.workItemId)) throw new Error(`MERGE_EVIDENCE_DUPLICATE:${item.workItemId}`);
    evidenceById.set(item.workItemId, item);
  }

  const blocked: Record<string, readonly string[]> = {};
  const ready: NusaMergeTrainEntry[] = [];
  for (const item of queue.items.filter((candidate) => candidate.state === "MERGE_READY")) {
    const itemEvidence = evidenceById.get(item.id);
    const blockers = mergeBlockers(item, itemEvidence, queue);
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
