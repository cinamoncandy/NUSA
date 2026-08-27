export type NusaDevelopmentWorkState =
  | "READY"
  | "CLAIMED"
  | "IMPLEMENTING"
  | "VALIDATING"
  | "CI"
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

export interface ClaimNextWorkRequest {
  readonly owner: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly now: number;
  readonly leaseMs: number;
}

export type ClaimNextWorkResult =
  | { readonly status: "CLAIMED" | "IDEMPOTENT_REPLAY"; readonly queue: NusaDevelopmentQueue; readonly item: NusaDevelopmentWorkItem }
  | { readonly status: "NO_READY_WORK" | "REVISION_CONFLICT"; readonly queue: NusaDevelopmentQueue; readonly item: null };

const PRIORITY_RANK: Readonly<Record<NusaDevelopmentPriority, number>> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

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

export function createNusaDevelopmentQueue(items: readonly NusaDevelopmentWorkItem[], revision = 0): NusaDevelopmentQueue {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("QUEUE_REVISION_INVALID");
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new Error("WORK_ID_REQUIRED");
    if (ids.has(item.id)) throw new Error(`WORK_ID_DUPLICATE:${item.id}`);
    ids.add(item.id);
    if (!Number.isFinite(item.createdAt)) throw new Error(`WORK_CREATED_AT_INVALID:${item.id}`);
  }
  for (const item of items) {
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) throw new Error(`WORK_DEPENDENCY_UNKNOWN:${item.id}:${dependency}`);
      if (dependency === item.id) throw new Error(`WORK_DEPENDENCY_SELF:${item.id}`);
    }
  }
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

export function claimNextNusaDevelopmentWork(queue: NusaDevelopmentQueue, request: ClaimNextWorkRequest): ClaimNextWorkResult {
  if (!request.owner.trim()) throw new Error("CLAIM_OWNER_REQUIRED");
  if (!request.requestId.trim()) throw new Error("CLAIM_REQUEST_ID_REQUIRED");
  if (!Number.isFinite(request.now)) throw new Error("CLAIM_NOW_INVALID");
  if (!Number.isFinite(request.leaseMs) || request.leaseMs <= 0) throw new Error("CLAIM_LEASE_INVALID");

  const replay = queue.items.find((item) => item.claim?.requestId === request.requestId && item.claim.owner === request.owner);
  if (replay) return { status: "IDEMPOTENT_REPLAY", queue, item: replay };

  if (request.expectedRevision !== queue.revision) return { status: "REVISION_CONFLICT", queue, item: null };

  const selected = queue.items
    .filter((item) => item.state === "READY" && dependenciesMerged(item, queue))
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
      leaseExpiresAt: request.now + request.leaseMs,
    },
  });
  const next = freezeQueue(queue.revision + 1, queue.items.map((item) => item.id === selected.id ? claimed : item));
  return { status: "CLAIMED", queue: next, item: claimed };
}

export function recoverStaleNusaDevelopmentClaims(queue: NusaDevelopmentQueue, now: number): NusaDevelopmentQueue {
  if (!Number.isFinite(now)) throw new Error("STALE_RECOVERY_NOW_INVALID");
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
