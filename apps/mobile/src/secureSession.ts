export interface SecureSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly createdAtMs: number;
  readonly lastActivityAtMs: number;
  readonly expiresAtMs: number;
  readonly revokedAtMs: number | null;
}

export interface SessionPolicy {
  readonly maximumLifetimeMs: number;
  readonly idleTimeoutMs: number;
}

const assertId = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} must not be empty`);
  return normalized;
};

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const assertPolicy = (policy: SessionPolicy): void => {
  if (!Number.isSafeInteger(policy.maximumLifetimeMs) || policy.maximumLifetimeMs <= 0) throw new Error("maximumLifetimeMs must be positive");
  if (!Number.isSafeInteger(policy.idleTimeoutMs) || policy.idleTimeoutMs <= 0 || policy.idleTimeoutMs > policy.maximumLifetimeMs) throw new Error("idleTimeoutMs is invalid");
};

export function createSecureSession(input: Readonly<{ sessionId: string; deviceId: string; nowMs: number }>, policy: SessionPolicy): SecureSession {
  assertPolicy(policy);
  assertTime(input.nowMs, "nowMs");
  return Object.freeze({
    sessionId: assertId(input.sessionId, "sessionId"),
    deviceId: assertId(input.deviceId, "deviceId"),
    createdAtMs: input.nowMs,
    lastActivityAtMs: input.nowMs,
    expiresAtMs: input.nowMs + policy.maximumLifetimeMs,
    revokedAtMs: null
  });
}

export function isSecureSessionUsable(session: SecureSession, nowMs: number, policy: SessionPolicy): boolean {
  assertPolicy(policy);
  assertTime(nowMs, "nowMs");
  if (session.revokedAtMs !== null || nowMs >= session.expiresAtMs) return false;
  return nowMs - session.lastActivityAtMs < policy.idleTimeoutMs;
}

export function touchSecureSession(session: SecureSession, nowMs: number, policy: SessionPolicy): SecureSession {
  if (!isSecureSessionUsable(session, nowMs, policy)) throw new Error("session is expired or revoked");
  if (nowMs < session.lastActivityAtMs) throw new Error("session activity time is non-monotonic");
  return Object.freeze({ ...session, lastActivityAtMs: nowMs });
}

export function revokeSecureSession(session: SecureSession, revokedAtMs: number): SecureSession {
  assertTime(revokedAtMs, "revokedAtMs");
  if (revokedAtMs < session.createdAtMs) throw new Error("revocation time is invalid");
  return Object.freeze({ ...session, revokedAtMs: session.revokedAtMs ?? revokedAtMs });
}
