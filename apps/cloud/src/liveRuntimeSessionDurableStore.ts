import type { LiveRuntimeSession } from "./liveRuntimeSessionBoundary";

export interface LiveRuntimeSessionStorageTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface LiveRuntimeSessionStorage {
  transaction<T>(callback: (txn: LiveRuntimeSessionStorageTransaction) => Promise<T>): Promise<T>;
}

export type LiveRuntimeSessionRecord = Readonly<{ schemaVersion: 1; revision: number; session: LiveRuntimeSession }>;
export type LiveRuntimeSessionStoreResult = Readonly<{ status: "STORED"; record: LiveRuntimeSessionRecord }> | Readonly<{ status: "REJECTED"; reason: string }>;
export type LiveFinalExecutionReservationResult = Readonly<{ status: "RESERVED"; record: LiveRuntimeSessionRecord }> | Readonly<{ status: "REJECTED"; reason: string }>;
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
export type LiveFinalExecutionDispatchDecision =
  | Readonly<{ status: "ACQUIRED"; record: LiveBrokerDispatchRecord }>
  | Readonly<{ status: "EXISTING"; record: LiveBrokerDispatchRecord }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

type LiveFinalExecutionReservationRecord = Readonly<{
  schemaVersion: 1;
  fingerprint: string;
  ownerPrincipalId: string;
  sessionId: string;
  revision: number;
  reservedAtMs: number;
}>;

const KEY_PREFIX = "live-runtime-session:v1:";
const FINAL_RESERVATION_PREFIX = "live-final-execution-reservation:v1:";
const DISPATCH_PREFIX = "live-broker-dispatch:v1:";

function validText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validFingerprint(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function validSession(session: unknown): session is LiveRuntimeSession {
  if (!session || typeof session !== "object") return false;
  const s = session as Partial<LiveRuntimeSession>;
  return validText(s.sessionId) && validText(s.ownerPrincipalId)
    && Number.isFinite(s.investmentCapitalWeight) && Number(s.investmentCapitalWeight) > 0 && Number(s.investmentCapitalWeight) <= 1
    && (s.state === "ACTIVE" || s.state === "STOPPED" || s.state === "REVOKED")
    && typeof s.killSwitchEngaged === "boolean"
    && Number.isFinite(s.activatedAtMs) && Number.isFinite(s.expiresAtMs)
    && Number(s.expiresAtMs) > Number(s.activatedAtMs)
    && (s.revokedAtMs === undefined || Number.isFinite(s.revokedAtMs));
}
function validRecord(value: unknown): value is LiveRuntimeSessionRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<LiveRuntimeSessionRecord>;
  return r.schemaVersion === 1 && Number.isSafeInteger(r.revision) && Number(r.revision) >= 1 && validSession(r.session);
}
function validReservation(value: unknown): value is LiveFinalExecutionReservationRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<LiveFinalExecutionReservationRecord>;
  return r.schemaVersion === 1 && validFingerprint(r.fingerprint) && validText(r.ownerPrincipalId) && validText(r.sessionId)
    && Number.isSafeInteger(r.revision) && Number(r.revision) >= 1 && Number.isSafeInteger(r.reservedAtMs) && Number(r.reservedAtMs) >= 0;
}
function validDispatch(value: unknown): value is LiveBrokerDispatchRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<LiveBrokerDispatchRecord>;
  return r.schemaVersion === 1 && validFingerprint(r.fingerprint) && validText(r.ownerPrincipalId) && validText(r.sessionId)
    && Number.isSafeInteger(r.sessionRevision) && Number(r.sessionRevision) >= 1 && r.attempt === 1
    && (r.state === "DISPATCHING" || r.state === "ACKNOWLEDGED" || r.state === "REJECTED" || r.state === "UNCERTAIN")
    && Number.isSafeInteger(r.updatedAtMs) && Number(r.updatedAtMs) >= 0;
}

export class LiveRuntimeSessionDurableStore {
  constructor(private readonly storage: LiveRuntimeSessionStorage) {}

  async read(ownerPrincipalId: string): Promise<LiveRuntimeSessionRecord | undefined> {
    if (!validText(ownerPrincipalId)) return undefined;
    try {
      const value = await this.storage.transaction((txn) => txn.get<unknown>(`${KEY_PREFIX}${ownerPrincipalId}`));
      return validRecord(value) ? value : undefined;
    } catch { return undefined; }
  }

  async reserveFinalExecution(ownerPrincipalId: string, sessionId: string, expectedRevision: number, fingerprint: string, nowMs: number): Promise<LiveFinalExecutionReservationResult> {
    if (!validText(ownerPrincipalId) || !validText(sessionId)) return { status: "REJECTED", reason: "SESSION_IDENTITY_INVALID" };
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { status: "REJECTED", reason: "REVISION_INVALID" };
    if (!validFingerprint(fingerprint)) return { status: "REJECTED", reason: "FINGERPRINT_INVALID" };
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "TIME_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const current = await this.requireAuthoritativeSession(txn, ownerPrincipalId, sessionId, expectedRevision, nowMs);
        if (current.status === "REJECTED") return current;
        const reservationKey = `${FINAL_RESERVATION_PREFIX}${fingerprint}`;
        if (await txn.get<unknown>(reservationKey) !== undefined) return { status: "REJECTED", reason: "DUPLICATE_EXECUTION_SUPPRESSED" } as const;
        await txn.put(reservationKey, Object.freeze({ schemaVersion: 1 as const, fingerprint, ownerPrincipalId, sessionId, revision: expectedRevision, reservedAtMs: nowMs }));
        return { status: "RESERVED", record: current.record } as const;
      });
    } catch { return { status: "REJECTED", reason: "STORAGE_UNCERTAIN" }; }
  }

  async acquireFinalExecutionDispatch(ownerPrincipalId: string, sessionId: string, expectedRevision: number, fingerprint: string, nowMs: number): Promise<LiveFinalExecutionDispatchDecision> {
    if (!validText(ownerPrincipalId) || !validText(sessionId) || !validFingerprint(fingerprint)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !Number.isSafeInteger(nowMs) || nowMs < 0)
      return { status: "REJECTED", reason: "DISPATCH_IDENTITY_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const current = await this.requireAuthoritativeSession(txn, ownerPrincipalId, sessionId, expectedRevision, nowMs);
        if (current.status === "REJECTED") return current;

        const reservationKey = `${FINAL_RESERVATION_PREFIX}${fingerprint}`;
        const dispatchKey = `${DISPATCH_PREFIX}${fingerprint}`;
        const reservation = await txn.get<unknown>(reservationKey);
        const dispatch = await txn.get<unknown>(dispatchKey);

        if (reservation !== undefined) {
          if (!validReservation(reservation)) return { status: "REJECTED", reason: "FINAL_RESERVATION_CORRUPT" } as const;
          if (reservation.fingerprint !== fingerprint || reservation.ownerPrincipalId !== ownerPrincipalId || reservation.sessionId !== sessionId || reservation.revision !== expectedRevision)
            return { status: "REJECTED", reason: "FINAL_RESERVATION_IDENTITY_CHANGED" } as const;
          if (dispatch === undefined) return { status: "REJECTED", reason: "FINAL_DISPATCH_STATE_MISSING" } as const;
          if (!validDispatch(dispatch)) return { status: "REJECTED", reason: "DISPATCH_STATE_CORRUPT" } as const;
          if (dispatch.ownerPrincipalId !== ownerPrincipalId || dispatch.sessionId !== sessionId || dispatch.sessionRevision !== expectedRevision)
            return { status: "REJECTED", reason: "DISPATCH_IDENTITY_CHANGED" } as const;
          return { status: "EXISTING", record: dispatch } as const;
        }

        if (dispatch !== undefined) return { status: "REJECTED", reason: "ORPHAN_DISPATCH_STATE" } as const;

        const reservationRecord = Object.freeze({ schemaVersion: 1 as const, fingerprint, ownerPrincipalId, sessionId, revision: expectedRevision, reservedAtMs: nowMs });
        const dispatchRecord = Object.freeze({ schemaVersion: 1 as const, fingerprint, ownerPrincipalId, sessionId, sessionRevision: expectedRevision, state: "DISPATCHING" as const, attempt: 1 as const, updatedAtMs: nowMs });
        await txn.put(reservationKey, reservationRecord);
        await txn.put(dispatchKey, dispatchRecord);
        return { status: "ACQUIRED", record: dispatchRecord } as const;
      });
    } catch { return { status: "REJECTED", reason: "DISPATCH_STATE_UNCERTAIN" }; }
  }

  async completeFinalExecutionDispatch(fingerprint: string, accepted: boolean, reason: string, nowMs: number): Promise<LiveFinalExecutionDispatchDecision> {
    return this.transitionDispatch(fingerprint, reason, nowMs, accepted ? "ACKNOWLEDGED" : "REJECTED", accepted);
  }

  async markFinalExecutionDispatchUncertain(fingerprint: string, reason: string, nowMs: number): Promise<LiveFinalExecutionDispatchDecision> {
    return this.transitionDispatch(fingerprint, reason, nowMs, "UNCERTAIN");
  }

  private async transitionDispatch(fingerprint: string, reason: string, nowMs: number, state: "ACKNOWLEDGED" | "REJECTED" | "UNCERTAIN", accepted?: boolean): Promise<LiveFinalExecutionDispatchDecision> {
    if (!validFingerprint(fingerprint) || !validText(reason) || !Number.isSafeInteger(nowMs) || nowMs < 0)
      return { status: "REJECTED", reason: "DISPATCH_RESULT_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const key = `${DISPATCH_PREFIX}${fingerprint}`;
        const current = await txn.get<unknown>(key);
        if (!validDispatch(current)) return { status: "REJECTED", reason: current === undefined ? "DISPATCH_STATE_MISSING" : "DISPATCH_STATE_CORRUPT" } as const;
        if (current.state !== "DISPATCHING") return { status: "EXISTING", record: current } as const;
        const record = Object.freeze({ ...current, state, ...(accepted === undefined ? {} : { accepted }), reason, updatedAtMs: nowMs });
        await txn.put(key, record);
        return { status: "EXISTING", record } as const;
      });
    } catch { return { status: "REJECTED", reason: "DISPATCH_STATE_UNCERTAIN" }; }
  }

  private async requireAuthoritativeSession(txn: LiveRuntimeSessionStorageTransaction, ownerPrincipalId: string, sessionId: string, expectedRevision: number, nowMs: number): Promise<Readonly<{ status: "OK"; record: LiveRuntimeSessionRecord }> | Readonly<{ status: "REJECTED"; reason: string }>> {
    const current = await txn.get<unknown>(`${KEY_PREFIX}${ownerPrincipalId}`);
    if (!validRecord(current)) return { status: "REJECTED", reason: current === undefined ? "AUTHORITATIVE_SESSION_UNAVAILABLE" : "STORAGE_CORRUPT" };
    if (current.revision !== expectedRevision) return { status: "REJECTED", reason: "SESSION_REVISION_CHANGED" };
    const session = current.session;
    if (session.ownerPrincipalId !== ownerPrincipalId || session.sessionId !== sessionId) return { status: "REJECTED", reason: "SESSION_IDENTITY_CHANGED" };
    if (session.state !== "ACTIVE") return { status: "REJECTED", reason: `SESSION_${session.state}` };
    if (session.killSwitchEngaged) return { status: "REJECTED", reason: "KILL_SWITCH_ENGAGED" };
    if (session.revokedAtMs !== undefined) return { status: "REJECTED", reason: "SESSION_REVOKED" };
    if (nowMs < session.activatedAtMs || nowMs >= session.expiresAtMs) return { status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" };
    return { status: "OK", record: current };
  }

  async write(session: LiveRuntimeSession, expectedRevision: number | null): Promise<LiveRuntimeSessionStoreResult> {
    if (!validSession(session)) return { status: "REJECTED", reason: "SESSION_INVALID" };
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) return { status: "REJECTED", reason: "REVISION_INVALID" };
    const key = `${KEY_PREFIX}${session.ownerPrincipalId}`;
    try {
      return await this.storage.transaction(async (txn) => {
        const current = await txn.get<unknown>(key);
        if (current !== undefined && !validRecord(current)) return { status: "REJECTED", reason: "STORAGE_CORRUPT" } as const;
        if (expectedRevision === null) { if (current !== undefined) return { status: "REJECTED", reason: "SESSION_ALREADY_EXISTS" } as const; }
        else if (!current || current.revision !== expectedRevision) return { status: "REJECTED", reason: "REVISION_CONFLICT" } as const;
        const record = Object.freeze({ schemaVersion: 1 as const, revision: (current?.revision ?? 0) + 1, session: Object.freeze({ ...session }) });
        await txn.put(key, record);
        return { status: "STORED", record } as const;
      });
    } catch { return { status: "REJECTED", reason: "STORAGE_UNCERTAIN" }; }
  }
}
