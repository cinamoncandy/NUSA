export type NusaDevelopmentWorkState =
  | "READY"
  | "CLAIMED"
  | "IMPLEMENTING"
  | "VALIDATING"
  | "CI"
  | "AUDIT"
  | "MERGE_READY"
  | "MERGED"
  | "BLOCKED_HUMAN";

export type NusaDevelopmentPriority = "P0" | "P1" | "P2" | "P3";

export const NUSA_DEVELOPMENT_CONTROL_PLANE_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

export interface NusaDevelopmentClaim {
  readonly owner: string;
  readonly requestId: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
}

export interface NusaStaleClaimEvidence {
  readonly claimRequestId: string;
  readonly sourceSha: string;
  readonly activeCi: boolean;
  readonly activePr: boolean;
  readonly checkpointAvailable: boolean;
  readonly executionStatus: "RUNNING" | "STOPPED" | "UNKNOWN";
}

export type NusaStaleClaimRecoveryOutcome =
  | "CLAIM_VALID"
  | "CLAIM_STALE_REQUEUE"
  | "CLAIM_STALE_RESUME"
  | "CLAIM_BLOCKED_HUMAN"
  | "CLAIM_FAIL_CLOSED";

export interface NusaDevelopmentWorkItem {
  readonly id: string;
  readonly state: NusaDevelopmentWorkState;
  readonly priority: NusaDevelopmentPriority;
  readonly dependencies: readonly string[];
  readonly canonicalOwner: string | null;
  readonly touchedFiles: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly nextAction: string;
  readonly createdAt: number;
  readonly claim: NusaDevelopmentClaim | null;
}

export interface NusaDevelopmentQueue {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly items: readonly NusaDevelopmentWorkItem[];
}

export interface NusaDevelopmentAllocationPolicy {
  /** Maximum active work items owned by the requesting lane. Omit the policy to preserve legacy unconstrained claiming. */
  readonly maximumActiveWorkPerOwner: number;
  /** Prevent a READY item from being claimed when any active item touches the same canonical file path. */
  readonly preventTouchedFileConflicts: boolean;
}

export interface ClaimNextWorkRequest {
  readonly owner: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly now: number;
  readonly leaseMs: number;
  readonly allocationPolicy?: NusaDevelopmentAllocationPolicy;
}

export type ClaimNextWorkResult =
  | { readonly status: "CLAIMED" | "IDEMPOTENT_REPLAY"; readonly queue: NusaDevelopmentQueue; readonly item: NusaDevelopmentWorkItem }
  | { readonly status: "NO_READY_WORK" | "REVISION_CONFLICT" | "WIP_LIMIT_REACHED"; readonly queue: NusaDevelopmentQueue; readonly item: null };

export interface ClaimNusaDevelopmentPortfolioRequest {
  readonly owner: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly now: number;
  readonly leaseMs: number;
  readonly maximumItems: number;
  readonly allocationPolicy?: NusaDevelopmentAllocationPolicy;
}

export type ClaimNusaDevelopmentPortfolioStopReason =
  | "NO_READY_WORK"
  | "REVISION_CONFLICT"
  | "WIP_LIMIT_REACHED"
  | null;

export interface ClaimNusaDevelopmentPortfolioResult {
  readonly status: "CLAIMED" | "PARTIAL" | "IDEMPOTENT_REPLAY" | "NO_READY_WORK" | "REVISION_CONFLICT" | "WIP_LIMIT_REACHED";
  readonly queue: NusaDevelopmentQueue;
  readonly items: readonly NusaDevelopmentWorkItem[];
  readonly claimedCount: number;
  readonly replayedCount: number;
  readonly stopReason: ClaimNusaDevelopmentPortfolioStopReason;
}

const PRIORITY_RANK: Readonly<Record<NusaDevelopmentPriority, number>> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const ACTIVE_STATES: ReadonlySet<NusaDevelopmentWorkState> = new Set(["CLAIMED", "IMPLEMENTING", "VALIDATING", "CI", "AUDIT", "MERGE_READY"]);

const isCanonicalTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const freezeItem = (item: NusaDevelopmentWorkItem): NusaDevelopmentWorkItem => Object.freeze({
  ...item,
  dependencies: Object.freeze([...item.dependencies]),
  touchedFiles: Object.freeze([...item.touchedFiles]),
  evidenceRequirements: Object.freeze([...item.evidenceRequirements]),
  claim: item.claim ? Object.freeze({ ...item.claim }) : null,
});

const freezeQueue = (revision: number, items: readonly NusaDevelopmentWorkItem[]): NusaDevelopmentQueue => Object.freeze({
  schemaVersion: 1 as const,
  revision,
  items: Object.freeze(items.map(freezeItem)),
});

function assertCanonicalTouchedFiles(item: NusaDevelopmentWorkItem): void {
  const seen = new Set<string>();
  for (const path of item.touchedFiles) {
    const segments = path.split("/");
    const invalid = path.length === 0
      || path.startsWith("/")
      || path.endsWith("/")
      || path.includes("\\")
      || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..");
    if (invalid) throw new Error(`WORK_TOUCHED_FILE_NOT_CANONICAL:${item.id}:${path || "empty"}`);
    if (seen.has(path)) throw new Error(`WORK_TOUCHED_FILE_DUPLICATE:${item.id}:${path}`);
    seen.add(path);
  }
}

function assertAcyclicDependencies(items: readonly NusaDevelopmentWorkItem[]): void {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`WORK_DEPENDENCY_CYCLE:${id}`);
    visiting.add(id);
    const item = byId.get(id);
    for (const dependency of item?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of items) visit(item.id);
}

export function createNusaDevelopmentQueue(items: readonly NusaDevelopmentWorkItem[], revision = 0): NusaDevelopmentQueue {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("QUEUE_REVISION_INVALID");
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new Error("WORK_ID_REQUIRED");
    if (ids.has(item.id)) throw new Error(`WORK_ID_DUPLICATE:${item.id}`);
    ids.add(item.id);
    if (!isCanonicalTimestamp(item.createdAt)) throw new Error(`WORK_CREATED_AT_INVALID:${item.id}`);
    assertCanonicalTouchedFiles(item);
  }
  for (const item of items) {
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) throw new Error(`WORK_DEPENDENCY_UNKNOWN:${item.id}:${dependency}`);
      if (dependency === item.id) throw new Error(`WORK_DEPENDENCY_SELF:${item.id}`);
    }
  }
  assertAcyclicDependencies(items);
  return freezeQueue(revision, items);
}

function dependenciesMerged(item: NusaDevelopmentWorkItem, queue: NusaDevelopmentQueue): boolean {
  return item.dependencies.every((dependency) => queue.items.find((candidate) => candidate.id === dependency)?.state === "MERGED");
}

function compareReadyWork(a: NusaDevelopmentWorkItem, b: NusaDevelopmentWorkItem): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id);
}

function validateAllocationPolicy(policy: NusaDevelopmentAllocationPolicy | undefined): void {
  if (policy == null) return;
  if (!Number.isSafeInteger(policy.maximumActiveWorkPerOwner) || policy.maximumActiveWorkPerOwner <= 0) {
    throw new Error("ALLOCATION_WIP_LIMIT_INVALID");
  }
}

function activeOwnerCount(queue: NusaDevelopmentQueue, owner: string): number {
  return queue.items.filter((item) => ACTIVE_STATES.has(item.state) && item.canonicalOwner === owner).length;
}

function hasTouchedFileConflict(item: NusaDevelopmentWorkItem, queue: NusaDevelopmentQueue): boolean {
  if (item.touchedFiles.length === 0) return false;
  const files = new Set(item.touchedFiles);
  return queue.items.some((active) => active.id !== item.id
    && ACTIVE_STATES.has(active.state)
    && active.touchedFiles.some((file) => files.has(file)));
}

function validateClaimRequest(request: ClaimNextWorkRequest): void {
  if (!request.owner.trim()) throw new Error("CLAIM_OWNER_REQUIRED");
  if (!request.requestId.trim()) throw new Error("CLAIM_REQUEST_ID_REQUIRED");
  if (!isCanonicalTimestamp(request.now)) throw new Error("CLAIM_NOW_INVALID");
  if (!Number.isSafeInteger(request.leaseMs) || request.leaseMs <= 0) throw new Error("CLAIM_LEASE_INVALID");
  const leaseExpiresAt = request.now + request.leaseMs;
  if (!isCanonicalTimestamp(leaseExpiresAt) || leaseExpiresAt <= request.now) throw new Error("CLAIM_LEASE_EXPIRES_AT_INVALID");
  validateAllocationPolicy(request.allocationPolicy);
}

export function claimNextNusaDevelopmentWork(queue: NusaDevelopmentQueue, request: ClaimNextWorkRequest): ClaimNextWorkResult {
  validateClaimRequest(request);
  const leaseExpiresAt = request.now + request.leaseMs;

  const replay = queue.items.find((item) => item.claim?.requestId === request.requestId && item.claim.owner === request.owner);
  if (replay) return { status: "IDEMPOTENT_REPLAY", queue, item: replay };

  if (request.expectedRevision !== queue.revision) return { status: "REVISION_CONFLICT", queue, item: null };

  if (request.allocationPolicy != null && activeOwnerCount(queue, request.owner) >= request.allocationPolicy.maximumActiveWorkPerOwner) {
    return { status: "WIP_LIMIT_REACHED", queue, item: null };
  }

  const selected = queue.items
    .filter((item) => item.state === "READY" && dependenciesMerged(item, queue))
    .filter((item) => request.allocationPolicy?.preventTouchedFileConflicts !== true || !hasTouchedFileConflict(item, queue))
    .sort(compareReadyWork)[0];
  if (!selected) return { status: "NO_READY_WORK", queue, item: null };

  const claimed = freezeItem({
    ...selected,
    state: "CLAIMED",
    canonicalOwner: request.owner,
    claim: {
      owner: request.owner,
      requestId: request.requestId,
      claimedAt: request.now,
      leaseExpiresAt,
    },
  });
  const next = freezeQueue(queue.revision + 1, queue.items.map((item) => item.id === selected.id ? claimed : item));
  return { status: "CLAIMED", queue: next, item: claimed };
}

/**
 * Claims a bounded portfolio from the canonical #903 queue. Each child claim
 * reuses the single-item claim path, so dependency, lease, WIP, touched-file
 * conflict, revision, and idempotency rules cannot diverge between one-item
 * and parallel allocation. A partial result is intentional when the safe
 * queue is exhausted or an allocation guard stops further work.
 */
export function claimNusaDevelopmentWorkPortfolio(
  queue: NusaDevelopmentQueue,
  request: ClaimNusaDevelopmentPortfolioRequest,
): ClaimNusaDevelopmentPortfolioResult {
  if (!Number.isSafeInteger(request.maximumItems) || request.maximumItems <= 0) {
    throw new Error("CLAIM_PORTFOLIO_MAXIMUM_ITEMS_INVALID");
  }
  if (!isCanonicalTimestamp(request.expectedRevision)) throw new Error("CLAIM_EXPECTED_REVISION_INVALID");
  validateClaimRequest(request);

  let currentQueue = queue;
  let expectedRevision = request.expectedRevision;
  let stopReason: ClaimNusaDevelopmentPortfolioStopReason = null;
  let claimedCount = 0;
  let replayedCount = 0;
  const items: NusaDevelopmentWorkItem[] = [];
  const boundedMaximum = Math.min(request.maximumItems, queue.items.length);

  for (let index = 0; index < boundedMaximum; index += 1) {
    const result = claimNextNusaDevelopmentWork(currentQueue, {
      owner: request.owner,
      requestId: `${request.requestId}:${index}`,
      expectedRevision,
      now: request.now,
      leaseMs: request.leaseMs,
      allocationPolicy: request.allocationPolicy,
    });

    if (result.status === "CLAIMED") {
      claimedCount += 1;
      items.push(result.item);
      currentQueue = result.queue;
      expectedRevision = currentQueue.revision;
      continue;
    }
    if (result.status === "IDEMPOTENT_REPLAY") {
      replayedCount += 1;
      items.push(result.item);
      currentQueue = result.queue;
      expectedRevision = currentQueue.revision;
      continue;
    }
    stopReason = result.status;
    currentQueue = result.queue;
    break;
  }

  const processedCount = claimedCount + replayedCount;
  if (stopReason === null && processedCount < request.maximumItems) stopReason = "NO_READY_WORK";
  const status = processedCount === 0
    ? stopReason ?? "NO_READY_WORK"
    : claimedCount === 0 && processedCount === request.maximumItems
      ? "IDEMPOTENT_REPLAY"
      : processedCount < request.maximumItems
        ? "PARTIAL"
        : "CLAIMED";

  return Object.freeze({
    status,
    queue: currentQueue,
    items: Object.freeze(items),
    claimedCount,
    replayedCount,
    stopReason,
  });
}

export function recoverStaleNusaDevelopmentClaims(queue: NusaDevelopmentQueue, now: number): NusaDevelopmentQueue {
  if (!isCanonicalTimestamp(now)) throw new Error("STALE_RECOVERY_NOW_INVALID");
  let changed = false;
  const items = queue.items.map((item) => {
    if (item.state !== "CLAIMED" || !item.claim || item.claim.leaseExpiresAt > now) return item;
    changed = true;
    return freezeItem({
      ...item,
      state: "READY",
      canonicalOwner: null,
      claim: null,
      nextAction: "claim",
    });
  });
  return changed ? freezeQueue(queue.revision + 1, items) : queue;
}

export function recoverStaleNusaDevelopmentClaimWithEvidence(
  queue: NusaDevelopmentQueue,
  now: number,
  evidenceByWorkId: Readonly<Record<string, NusaStaleClaimEvidence>>,
): { readonly queue: NusaDevelopmentQueue; readonly outcomes: Readonly<Record<string, NusaStaleClaimRecoveryOutcome>> } {
  if (!isCanonicalTimestamp(now)) throw new Error("STALE_RECOVERY_NOW_INVALID");
  let changed = false;
  const outcomes: Record<string, NusaStaleClaimRecoveryOutcome> = {};
  const items = queue.items.map((item) => {
    if (item.state !== "CLAIMED" || !item.claim) return item;
    if (item.claim.leaseExpiresAt > now) {
      outcomes[item.id] = "CLAIM_VALID";
      return item;
    }
    const evidence = evidenceByWorkId[item.id];
    if (!evidence || evidence.claimRequestId !== item.claim.requestId || !evidence.sourceSha.trim()) {
      outcomes[item.id] = "CLAIM_FAIL_CLOSED";
      return item;
    }
    if (evidence.activeCi || evidence.activePr || evidence.checkpointAvailable || evidence.executionStatus === "RUNNING") {
      outcomes[item.id] = evidence.checkpointAvailable || evidence.executionStatus === "RUNNING"
        ? "CLAIM_STALE_RESUME"
        : "CLAIM_BLOCKED_HUMAN";
      return item;
    }
    changed = true;
    outcomes[item.id] = "CLAIM_STALE_REQUEUE";
    return freezeItem({ ...item, state: "READY", canonicalOwner: null, claim: null, nextAction: "claim" });
  });
  return { queue: changed ? freezeQueue(queue.revision + 1, items) : queue, outcomes: Object.freeze(outcomes) };
}
