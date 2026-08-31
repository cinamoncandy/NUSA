import type { LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";

export type LiveBrokerDispatchState = "DISPATCHING" | "ACKNOWLEDGED" | "REJECTED" | "UNCERTAIN";
export type LiveBrokerDispatchRecord = Readonly<{
  schemaVersion: 1;
  fingerprint: string;
  ownerPrincipalId: string;
  sessionId: string;
  sessionRevision: number;
  state: LiveBrokerDispatchState;
  attempt: 1;
  updatedAtMs: number;
  accepted?: boolean;
  reason?: string;
}>;
export type LiveBrokerDispatchDecision =
  | Readonly<{ status: "ACQUIRED"; record: LiveBrokerDispatchRecord }>
  | Readonly<{ status: "EXISTING"; record: LiveBrokerDispatchRecord }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

const PREFIX = "live-broker-dispatch:v1:";
const validText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validFingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validRecord(value: unknown): value is LiveBrokerDispatchRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<LiveBrokerDispatchRecord>;
  return r.schemaVersion === 1 && validFingerprint(r.fingerprint) && validText(r.ownerPrincipalId) && validText(r.sessionId)
    && Number.isSafeInteger(r.sessionRevision) && Number(r.sessionRevision) >= 1 && r.attempt === 1
    && (r.state === "DISPATCHING" || r.state === "ACKNOWLEDGED" || r.state === "REJECTED" || r.state === "UNCERTAIN")
    && Number.isSafeInteger(r.updatedAtMs) && Number(r.updatedAtMs) >= 0;
}

export class LiveBrokerDispatchDurableState {
  constructor(private readonly storage: LiveRuntimeSessionStorage) {}

  async acquire(fingerprint: string, ownerPrincipalId: string, sessionId: string, sessionRevision: number, nowMs: number): Promise<LiveBrokerDispatchDecision> {
    if (!validFingerprint(fingerprint) || !validText(ownerPrincipalId) || !validText(sessionId) || !Number.isSafeInteger(sessionRevision) || sessionRevision < 1 || !Number.isSafeInteger(nowMs) || nowMs < 0)
      return { status: "REJECTED", reason: "DISPATCH_IDENTITY_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const key = `${PREFIX}${fingerprint}`;
        const existing = await txn.get<unknown>(key);
        if (existing !== undefined) {
          if (!validRecord(existing)) return { status: "REJECTED", reason: "DISPATCH_STATE_CORRUPT" } as const;
          if (existing.ownerPrincipalId !== ownerPrincipalId || existing.sessionId !== sessionId || existing.sessionRevision !== sessionRevision)
            return { status: "REJECTED", reason: "DISPATCH_IDENTITY_CHANGED" } as const;
          return { status: "EXISTING", record: existing } as const;
        }
        const record = Object.freeze({ schemaVersion: 1 as const, fingerprint, ownerPrincipalId, sessionId, sessionRevision, state: "DISPATCHING" as const, attempt: 1 as const, updatedAtMs: nowMs });
        await txn.put(key, record);
        return { status: "ACQUIRED", record } as const;
      });
    } catch { return { status: "REJECTED", reason: "DISPATCH_STATE_UNCERTAIN" }; }
  }

  async complete(fingerprint: string, accepted: boolean, reason: string, nowMs: number): Promise<LiveBrokerDispatchDecision> {
    if (!validFingerprint(fingerprint) || !validText(reason) || !Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "DISPATCH_RESULT_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const key = `${PREFIX}${fingerprint}`;
        const current = await txn.get<unknown>(key);
        if (!validRecord(current)) return { status: "REJECTED", reason: current === undefined ? "DISPATCH_STATE_MISSING" : "DISPATCH_STATE_CORRUPT" } as const;
        if (current.state !== "DISPATCHING") return { status: "EXISTING", record: current } as const;
        const record = Object.freeze({ ...current, state: accepted ? "ACKNOWLEDGED" as const : "REJECTED" as const, accepted, reason, updatedAtMs: nowMs });
        await txn.put(key, record);
        return { status: "EXISTING", record } as const;
      });
    } catch { return { status: "REJECTED", reason: "DISPATCH_STATE_UNCERTAIN" }; }
  }

  async markUncertain(fingerprint: string, reason: string, nowMs: number): Promise<LiveBrokerDispatchDecision> {
    if (!validFingerprint(fingerprint) || !validText(reason) || !Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "DISPATCH_RESULT_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const key = `${PREFIX}${fingerprint}`;
        const current = await txn.get<unknown>(key);
        if (!validRecord(current)) return { status: "REJECTED", reason: current === undefined ? "DISPATCH_STATE_MISSING" : "DISPATCH_STATE_CORRUPT" } as const;
        if (current.state !== "DISPATCHING") return { status: "EXISTING", record: current } as const;
        const record = Object.freeze({ ...current, state: "UNCERTAIN" as const, reason, updatedAtMs: nowMs });
        await txn.put(key, record);
        return { status: "EXISTING", record } as const;
      });
    } catch { return { status: "REJECTED", reason: "DISPATCH_STATE_UNCERTAIN" }; }
  }
}
