export type KillSwitchReason =
  | "MANUAL_STOP"
  | "HARD_RISK_BLOCK"
  | "HARD_RISK_UNKNOWN"
  | "RECONCILIATION_DIFF"
  | "RECONCILIATION_UNKNOWN"
  | "MARKET_DATA_STALE"
  | "MARKET_DATA_DISCONNECTED"
  | "RUNTIME_UNSAFE"
  | "UNKNOWN_EXECUTION_STATE";

export interface KillSwitchSnapshot {
  readonly active: boolean;
  readonly reasons: readonly KillSwitchReason[];
  readonly activatedAt: string | null;
  readonly updatedAt: string;
  readonly generation: number;
}

export interface HumanReleaseApprover {
  readonly id: string;
  readonly kind: "HUMAN";
}

export interface KillSwitchReleaseEvidence {
  readonly operationalState: "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT" | "UNKNOWN";
  readonly hardRisk: "PASS" | "REJECT" | "BLOCK" | "UNKNOWN";
  readonly reconciliation: "MATCH" | "DIFF" | "UNKNOWN";
  readonly marketData: "HEALTHY" | "STALE" | "DISCONNECTED" | "UNKNOWN";
  readonly unresolvedExecutionCount: number;
}

export interface KillSwitchEvent {
  readonly type: "KILL_SWITCH_TRIGGERED" | "KILL_SWITCH_RELEASED";
  readonly observedAt: string;
  readonly generation: number;
  readonly reasons: readonly KillSwitchReason[];
  readonly approvers?: readonly string[];
}

export interface KillSwitchEvidenceSink { append(event: KillSwitchEvent): void; }

function validTime(value: string): boolean { return !Number.isNaN(Date.parse(value)); }

export class LatchedKillSwitch {
  private snapshot: KillSwitchSnapshot;
  public constructor(private readonly evidence?: KillSwitchEvidenceSink, now = new Date().toISOString()) {
    if (!validTime(now)) throw new Error("INVALID_KILL_SWITCH_TIME");
    this.snapshot = Object.freeze({ active: false, reasons: Object.freeze([]), activatedAt: null, updatedAt: now, generation: 0 });
  }

  get state(): KillSwitchSnapshot { return this.snapshot; }

  trigger(reason: KillSwitchReason, now = new Date().toISOString()): KillSwitchSnapshot {
    if (!validTime(now)) throw new Error("INVALID_KILL_SWITCH_TIME");
    const reasons = Object.freeze([...new Set([...this.snapshot.reasons, reason])].sort() as KillSwitchReason[]);
    const generation = this.snapshot.active ? this.snapshot.generation : this.snapshot.generation + 1;
    this.snapshot = Object.freeze({ active: true, reasons, activatedAt: this.snapshot.activatedAt ?? now, updatedAt: now, generation });
    this.evidence?.append(Object.freeze({ type: "KILL_SWITCH_TRIGGERED", observedAt: now, generation, reasons }));
    return this.snapshot;
  }

  release(approvers: readonly HumanReleaseApprover[], safety: KillSwitchReleaseEvidence, now = new Date().toISOString()): KillSwitchSnapshot {
    if (!this.snapshot.active) return this.snapshot;
    if (!validTime(now)) throw new Error("INVALID_KILL_SWITCH_TIME");
    if (approvers.length !== 2 || approvers.some((x) => x.kind !== "HUMAN" || !x.id.trim()) || approvers[0]?.id === approvers[1]?.id) {
      throw new Error("KILL_SWITCH_TWO_HUMAN_APPROVERS_REQUIRED");
    }
    if (!Number.isInteger(safety.unresolvedExecutionCount) || safety.unresolvedExecutionCount < 0) throw new Error("KILL_SWITCH_RELEASE_EVIDENCE_UNKNOWN");
    if (safety.operationalState !== "SAFE" || safety.hardRisk !== "PASS" || safety.reconciliation !== "MATCH" || safety.marketData !== "HEALTHY" || safety.unresolvedExecutionCount !== 0) {
      throw new Error("KILL_SWITCH_RELEASE_UNSAFE");
    }
    const previousReasons = this.snapshot.reasons;
    const generation = this.snapshot.generation;
    const ids = Object.freeze(approvers.map((x) => x.id).sort());
    this.evidence?.append(Object.freeze({ type: "KILL_SWITCH_RELEASED", observedAt: now, generation, reasons: previousReasons, approvers: ids }));
    this.snapshot = Object.freeze({ active: false, reasons: Object.freeze([]), activatedAt: null, updatedAt: now, generation });
    return this.snapshot;
  }

  restore(snapshot: KillSwitchSnapshot): void {
    if (!validTime(snapshot.updatedAt) || (snapshot.activatedAt !== null && !validTime(snapshot.activatedAt))) throw new Error("INVALID_KILL_SWITCH_SNAPSHOT");
    if (!Number.isInteger(snapshot.generation) || snapshot.generation < 0) throw new Error("INVALID_KILL_SWITCH_SNAPSHOT");
    if (snapshot.active && (!snapshot.activatedAt || snapshot.reasons.length === 0)) throw new Error("INVALID_KILL_SWITCH_SNAPSHOT");
    if (!snapshot.active && (snapshot.activatedAt !== null || snapshot.reasons.length !== 0)) throw new Error("INVALID_KILL_SWITCH_SNAPSHOT");
    this.snapshot = Object.freeze({ ...snapshot, reasons: Object.freeze([...snapshot.reasons]) });
  }
}
