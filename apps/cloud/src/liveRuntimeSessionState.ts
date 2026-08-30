export type LiveRuntimeSessionStatus = "ACTIVE" | "INACTIVE" | "EXPIRED" | "REVOKED";

export interface LiveRuntimeSessionRecord {
  readonly schemaVersion: 1;
  readonly ownerPrincipalId: string;
  readonly investmentCapitalWeight: number;
  readonly status: LiveRuntimeSessionStatus;
  readonly killSwitchActive: boolean;
  readonly activatedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface LiveRuntimeSessionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export type LiveRuntimeSessionEvaluation =
  | { readonly usable: true; readonly record: LiveRuntimeSessionRecord }
  | { readonly usable: false; readonly reason: "MISSING" | "INVALID" | "INACTIVE" | "EXPIRED" | "REVOKED" | "KILL_SWITCH_ACTIVE" | "CAPITAL_DISABLED" | "STORAGE_UNCERTAIN"; readonly record?: LiveRuntimeSessionRecord };

const KEY_PREFIX = "live-runtime-session:v1:";
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function keyFor(ownerPrincipalId: string): string {
  return `${KEY_PREFIX}${ownerPrincipalId}`;
}

export function createLiveRuntimeSession(input: {
  ownerPrincipalId: string;
  investmentCapitalWeight: number;
  now: number;
  ttlMs: number;
}): LiveRuntimeSessionRecord {
  const ownerPrincipalId = input.ownerPrincipalId.trim();
  if (!ownerPrincipalId || !validWeight(input.investmentCapitalWeight) || !validTime(input.now)
      || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > MAX_SESSION_TTL_MS) {
    throw new Error("INVALID_LIVE_RUNTIME_SESSION");
  }
  return Object.freeze({
    schemaVersion: 1,
    ownerPrincipalId,
    investmentCapitalWeight: input.investmentCapitalWeight,
    status: "ACTIVE",
    killSwitchActive: false,
    activatedAt: input.now,
    expiresAt: input.now + input.ttlMs,
    revokedAt: null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
  });
}

export async function saveLiveRuntimeSession(storage: LiveRuntimeSessionStorage, record: LiveRuntimeSessionRecord): Promise<void> {
  await storage.put(keyFor(record.ownerPrincipalId), record);
}

export async function evaluateLiveRuntimeSession(storage: LiveRuntimeSessionStorage, ownerPrincipalId: string, now: number): Promise<LiveRuntimeSessionEvaluation> {
  const owner = ownerPrincipalId.trim();
  if (!owner || !validTime(now)) return { usable: false, reason: "INVALID" };
  try {
    const record = await storage.get<LiveRuntimeSessionRecord>(keyFor(owner));
    if (!record) return { usable: false, reason: "MISSING" };
    if (record.schemaVersion !== 1 || record.ownerPrincipalId !== owner || !validWeight(record.investmentCapitalWeight)
        || !validTime(record.activatedAt) || !validTime(record.expiresAt) || record.expiresAt <= record.activatedAt
        || record.liveAuthority !== "NONE" || record.productionMutationAllowed !== false) {
      return { usable: false, reason: "INVALID" };
    }
    if (record.status === "REVOKED") return { usable: false, reason: "REVOKED", record };
    if (record.status !== "ACTIVE") return { usable: false, reason: "INACTIVE", record };
    if (record.killSwitchActive) return { usable: false, reason: "KILL_SWITCH_ACTIVE", record };
    if (record.investmentCapitalWeight === 0) return { usable: false, reason: "CAPITAL_DISABLED", record };
    if (now >= record.expiresAt) return { usable: false, reason: "EXPIRED", record };
    return { usable: true, record };
  } catch {
    return { usable: false, reason: "STORAGE_UNCERTAIN" };
  }
}

export function revokeLiveRuntimeSession(record: LiveRuntimeSessionRecord, now: number): LiveRuntimeSessionRecord {
  if (!validTime(now) || now < record.activatedAt) throw new Error("INVALID_REVOCATION_TIME");
  return Object.freeze({ ...record, status: "REVOKED", killSwitchActive: true, revokedAt: now });
}

export function setLiveRuntimeKillSwitch(record: LiveRuntimeSessionRecord, active: boolean): LiveRuntimeSessionRecord {
  return Object.freeze({ ...record, killSwitchActive: active });
}

export function setLiveRuntimeCapitalWeight(record: LiveRuntimeSessionRecord, investmentCapitalWeight: number): LiveRuntimeSessionRecord {
  if (!validWeight(investmentCapitalWeight)) throw new Error("INVALID_INVESTMENT_CAPITAL_WEIGHT");
  return Object.freeze({ ...record, investmentCapitalWeight });
}
