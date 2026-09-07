export type LiveRuntimeSessionState = "ACTIVE" | "STOPPED" | "REVOKED";

export type LiveRuntimeSession = {
  sessionId: string;
  ownerPrincipalId: string;
  investmentCapitalWeight: number;
  state: LiveRuntimeSessionState;
  killSwitchEngaged: boolean;
  activatedAtMs: number;
  expiresAtMs: number;
  revokedAtMs?: number;
};

export type LiveRuntimeSessionDecision =
  | { allowed: true; investmentCapitalWeight: number }
  | { allowed: false; reason: string };

export function evaluateLiveRuntimeSession(
  session: LiveRuntimeSession,
  ownerPrincipalId: string,
  nowMs: number,
): LiveRuntimeSessionDecision {
  if (!Number.isFinite(nowMs) || nowMs < 0) return { allowed: false, reason: "TIME_INVALID" };
  if (session.sessionId.trim().length === 0) return { allowed: false, reason: "SESSION_ID_REQUIRED" };
  if (session.ownerPrincipalId.trim().length === 0) return { allowed: false, reason: "SESSION_OWNER_REQUIRED" };
  if (ownerPrincipalId.trim().length === 0 || ownerPrincipalId !== session.ownerPrincipalId) {
    return { allowed: false, reason: "OWNER_MISMATCH" };
  }
  if (!Number.isFinite(session.investmentCapitalWeight) || session.investmentCapitalWeight <= 0 || session.investmentCapitalWeight > 1) {
    return { allowed: false, reason: "CAPITAL_WEIGHT_INVALID" };
  }
  if (!Number.isFinite(session.activatedAtMs) || !Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= session.activatedAtMs) {
    return { allowed: false, reason: "SESSION_WINDOW_INVALID" };
  }
  if (session.killSwitchEngaged) return { allowed: false, reason: "KILL_SWITCH_ENGAGED" };
  if (session.state !== "ACTIVE") return { allowed: false, reason: `SESSION_${session.state}` };
  if (session.revokedAtMs !== undefined) return { allowed: false, reason: "SESSION_REVOKED" };
  if (nowMs < session.activatedAtMs) return { allowed: false, reason: "SESSION_NOT_ACTIVE_YET" };
  if (nowMs >= session.expiresAtMs) return { allowed: false, reason: "SESSION_EXPIRED" };

  return { allowed: true, investmentCapitalWeight: session.investmentCapitalWeight };
}

export function stopLiveRuntimeSession(session: LiveRuntimeSession): LiveRuntimeSession {
  return { ...session, state: "STOPPED" };
}

export function engageLiveKillSwitch(session: LiveRuntimeSession): LiveRuntimeSession {
  return { ...session, killSwitchEngaged: true, state: "STOPPED" };
}

export function revokeLiveRuntimeSession(session: LiveRuntimeSession, nowMs: number): LiveRuntimeSession {
  return { ...session, state: "REVOKED", killSwitchEngaged: true, revokedAtMs: nowMs };
}
