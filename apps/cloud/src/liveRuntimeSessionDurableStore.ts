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

const KEY_PREFIX = "live-runtime-session:v1:";
const FINAL_RESERVATION_PREFIX = "live-final-execution-reservation:v1:";

function validText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
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
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) return { status: "REJECTED", reason: "FINGERPRINT_INVALID" };
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "TIME_INVALID" };
    try {
      return await this.storage.transaction(async (txn) => {
        const current = await txn.get<unknown>(`${KEY_PREFIX}${ownerPrincipalId}`);
        if (!validRecord(current)) return { status: "REJECTED", reason: current === undefined ? "AUTHORITATIVE_SESSION_UNAVAILABLE" : "STORAGE_CORRUPT" } as const;
        if (current.revision !== expectedRevision) return { status: "REJECTED", reason: "SESSION_REVISION_CHANGED" } as const;
        const session = current.session;
        if (session.ownerPrincipalId !== ownerPrincipalId || session.sessionId !== sessionId) return { status: "REJECTED", reason: "SESSION_IDENTITY_CHANGED" } as const;
        if (session.state !== "ACTIVE") return { status: "REJECTED", reason: `SESSION_${session.state}` } as const;
        if (session.killSwitchEngaged) return { status: "REJECTED", reason: "KILL_SWITCH_ENGAGED" } as const;
        if (session.revokedAtMs !== undefined) return { status: "REJECTED", reason: "SESSION_REVOKED" } as const;
        if (nowMs < session.activatedAtMs || nowMs >= session.expiresAtMs) return { status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" } as const;
        const reservationKey = `${FINAL_RESERVATION_PREFIX}${fingerprint}`;
        if (await txn.get<unknown>(reservationKey) !== undefined) return { status: "REJECTED", reason: "DUPLICATE_EXECUTION_SUPPRESSED" } as const;
        await txn.put(reservationKey, Object.freeze({ ownerPrincipalId, sessionId, revision: expectedRevision, reservedAtMs: nowMs }));
        return { status: "RESERVED", record: current } as const;
      });
    } catch { return { status: "REJECTED", reason: "STORAGE_UNCERTAIN" }; }
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
