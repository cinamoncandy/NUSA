export type MobileLifecycleState = "FOREGROUND" | "BACKGROUND";
export type MobileNetworkState = "ONLINE" | "DEGRADED" | "OFFLINE" | "RECOVERING" | "SYNCING";
export type MobileRecoveryState = "READY" | "RECOVERING" | "BLOCKED";

export interface MobileRuntimeSnapshot {
  readonly lifecycle: MobileLifecycleState;
  readonly network: MobileNetworkState;
  readonly recovery: MobileRecoveryState;
  readonly tradingBlocked: boolean;
  readonly lastPersistedVersion: number;
  readonly pendingActionCount: number;
  readonly reason?: string;
}

export type MobileRuntimeEvent =
  | { readonly type: "APP_BACKGROUND" }
  | { readonly type: "APP_FOREGROUND" }
  | { readonly type: "NETWORK_DEGRADED" }
  | { readonly type: "NETWORK_OFFLINE" }
  | { readonly type: "NETWORK_ONLINE" }
  | { readonly type: "RECOVERY_STARTED" }
  | { readonly type: "RECOVERY_MATCHED"; readonly version: number }
  | { readonly type: "RECOVERY_FAILED"; readonly reason: string }
  | { readonly type: "SYNC_STARTED" }
  | { readonly type: "SYNC_COMPLETED"; readonly version: number; readonly pendingActionCount: number }
  | { readonly type: "SYNC_CONFLICT"; readonly reason: string };

const assertVersion = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
};

const assertPendingActions = (value: number): void => assertVersion(value, "pendingActionCount");

export const initialMobileRuntimeSnapshot = (): MobileRuntimeSnapshot => Object.freeze({
  lifecycle: "FOREGROUND",
  network: "ONLINE",
  recovery: "READY",
  tradingBlocked: false,
  lastPersistedVersion: 0,
  pendingActionCount: 0
});

export function transitionMobileRuntime(current: MobileRuntimeSnapshot, event: MobileRuntimeEvent): MobileRuntimeSnapshot {
  assertVersion(current.lastPersistedVersion, "lastPersistedVersion");
  assertPendingActions(current.pendingActionCount);

  switch (event.type) {
    case "APP_BACKGROUND":
      return Object.freeze({ ...current, lifecycle: "BACKGROUND" });
    case "APP_FOREGROUND":
      return Object.freeze({ ...current, lifecycle: "FOREGROUND", recovery: current.recovery === "READY" ? "READY" : "RECOVERING" });
    case "NETWORK_DEGRADED":
      return Object.freeze({ ...current, network: "DEGRADED", tradingBlocked: true, reason: "network degraded" });
    case "NETWORK_OFFLINE":
      return Object.freeze({ ...current, network: "OFFLINE", tradingBlocked: true, reason: "network offline" });
    case "NETWORK_ONLINE":
      return Object.freeze({ ...current, network: "RECOVERING", recovery: "RECOVERING", tradingBlocked: true, reason: "connection restored; recovery required" });
    case "RECOVERY_STARTED":
      return Object.freeze({ ...current, network: current.network === "OFFLINE" ? "OFFLINE" : "RECOVERING", recovery: "RECOVERING", tradingBlocked: true, reason: "recovery in progress" });
    case "RECOVERY_MATCHED":
      assertVersion(event.version, "version");
      if (event.version < current.lastPersistedVersion) throw new Error("recovery version cannot move backwards");
      return Object.freeze({ ...current, network: "ONLINE", recovery: "READY", tradingBlocked: false, lastPersistedVersion: event.version, reason: undefined });
    case "RECOVERY_FAILED":
      if (event.reason.trim() === "") throw new Error("recovery failure reason is required");
      return Object.freeze({ ...current, recovery: "BLOCKED", tradingBlocked: true, reason: event.reason });
    case "SYNC_STARTED":
      if (current.recovery !== "READY") throw new Error("synchronization requires ready recovery state");
      return Object.freeze({ ...current, network: "SYNCING", tradingBlocked: true, reason: "synchronization in progress" });
    case "SYNC_COMPLETED":
      assertVersion(event.version, "version");
      assertPendingActions(event.pendingActionCount);
      if (event.version < current.lastPersistedVersion) throw new Error("synchronization version cannot move backwards");
      return Object.freeze({ ...current, network: "ONLINE", recovery: "READY", tradingBlocked: false, lastPersistedVersion: event.version, pendingActionCount: event.pendingActionCount, reason: undefined });
    case "SYNC_CONFLICT":
      if (event.reason.trim() === "") throw new Error("synchronization conflict reason is required");
      return Object.freeze({ ...current, recovery: "BLOCKED", tradingBlocked: true, reason: event.reason });
  }
}

export interface MobileRuntimePersistence {
  readonly load: () => MobileRuntimeSnapshot | undefined;
  readonly save: (snapshot: MobileRuntimeSnapshot) => void;
}

export class MobileRuntimeCoordinator {
  private snapshot: MobileRuntimeSnapshot;

  public constructor(private readonly persistence: MobileRuntimePersistence) {
    const restored = persistence.load();
    this.snapshot = restored === undefined ? initialMobileRuntimeSnapshot() : Object.freeze({ ...restored });
  }

  public current(): MobileRuntimeSnapshot { return this.snapshot; }

  public dispatch(event: MobileRuntimeEvent): MobileRuntimeSnapshot {
    const next = transitionMobileRuntime(this.snapshot, event);
    this.persistence.save(next);
    this.snapshot = next;
    return next;
  }

  public canSubmitPaperOrder(): boolean {
    return !this.snapshot.tradingBlocked && this.snapshot.lifecycle === "FOREGROUND" && this.snapshot.network === "ONLINE" && this.snapshot.recovery === "READY";
  }
}
