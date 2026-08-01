export type OfflineSyncState = "ONLINE" | "DEGRADED" | "OFFLINE" | "RECOVERING" | "SYNCING";

export type OfflineSyncEvent =
  | "CONNECTION_HEALTHY"
  | "CONNECTION_DEGRADED"
  | "CONNECTION_LOST"
  | "RECOVERY_VALIDATED"
  | "SYNC_STARTED"
  | "SYNC_COMPLETED"
  | "SYNC_FAILED";

export interface OfflineSyncSnapshot {
  readonly state: OfflineSyncState;
  readonly version: number;
  readonly changedAtMs: number;
  readonly lastHealthyAtMs: number | null;
  readonly staleSinceMs: number | null;
}

const transitions: Readonly<Record<OfflineSyncState, Partial<Record<OfflineSyncEvent, OfflineSyncState>>>> = {
  ONLINE: { CONNECTION_DEGRADED: "DEGRADED", CONNECTION_LOST: "OFFLINE" },
  DEGRADED: { CONNECTION_HEALTHY: "ONLINE", CONNECTION_LOST: "OFFLINE" },
  OFFLINE: { RECOVERY_VALIDATED: "RECOVERING" },
  RECOVERING: { SYNC_STARTED: "SYNCING", CONNECTION_LOST: "OFFLINE" },
  SYNCING: { SYNC_COMPLETED: "ONLINE", SYNC_FAILED: "OFFLINE", CONNECTION_LOST: "OFFLINE" }
};

function assertTimestamp(atMs: number, previousMs: number): void {
  if (!Number.isSafeInteger(atMs) || atMs < previousMs) throw new Error("offline synchronization time is invalid");
}

export function createOfflineSyncSnapshot(atMs: number, state: OfflineSyncState = "OFFLINE"): OfflineSyncSnapshot {
  if (!Number.isSafeInteger(atMs) || atMs < 0) throw new Error("offline synchronization time is invalid");
  return Object.freeze({
    state,
    version: 0,
    changedAtMs: atMs,
    lastHealthyAtMs: state === "ONLINE" ? atMs : null,
    staleSinceMs: state === "ONLINE" ? null : atMs
  });
}

export function transitionOfflineSync(snapshot: OfflineSyncSnapshot, event: OfflineSyncEvent, atMs: number): OfflineSyncSnapshot {
  assertTimestamp(atMs, snapshot.changedAtMs);
  const nextState = transitions[snapshot.state][event];
  if (nextState === undefined) throw new Error(`invalid offline synchronization transition: ${snapshot.state} + ${event}`);
  return Object.freeze({
    state: nextState,
    version: snapshot.version + 1,
    changedAtMs: atMs,
    lastHealthyAtMs: nextState === "ONLINE" ? atMs : snapshot.lastHealthyAtMs,
    staleSinceMs: nextState === "ONLINE" ? null : snapshot.staleSinceMs ?? atMs
  });
}
