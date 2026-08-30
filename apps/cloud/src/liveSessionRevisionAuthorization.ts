import type { LiveRuntimeSessionDurableStore } from "./liveRuntimeSessionDurableStore";
import type { LiveAuthoritativeSessionTransportResult } from "./liveAuthoritativeSessionTransportChain";

export type LiveSessionRevisionAuthorization = Readonly<{
  ownerPrincipalId: string;
  sessionId: string;
  revision: number;
}>;

export type LiveSessionRevisionDecision =
  | Readonly<{ status: "AUTHORIZED"; authorization: LiveSessionRevisionAuthorization }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

/**
 * Final fail-closed session check for a prepared LIVE transport.
 * Any STOP, kill-switch, capital-weight change, revocation, or other persisted
 * session mutation increments the revision and invalidates the prepared work.
 */
export async function authorizeCurrentLiveSessionRevision(
  prepared: LiveAuthoritativeSessionTransportResult,
  ownerPrincipalId: string,
  sessionStore: LiveRuntimeSessionDurableStore,
  nowMs: number,
): Promise<LiveSessionRevisionDecision> {
  if (prepared.status !== "READY") return { status: "REJECTED", reason: "TRANSPORT_NOT_READY" };
  if (typeof ownerPrincipalId !== "string" || ownerPrincipalId.trim().length === 0) return { status: "REJECTED", reason: "OWNER_REQUIRED" };
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "TIME_INVALID" };

  const current = await sessionStore.read(ownerPrincipalId);
  if (!current) return { status: "REJECTED", reason: "AUTHORITATIVE_SESSION_UNAVAILABLE" };
  if (current.revision !== prepared.revision) return { status: "REJECTED", reason: "SESSION_REVISION_CHANGED" };
  const session = current.session;
  if (session.ownerPrincipalId !== ownerPrincipalId) return { status: "REJECTED", reason: "OWNER_MISMATCH" };
  if (session.state !== "ACTIVE") return { status: "REJECTED", reason: `SESSION_${session.state}` };
  if (session.killSwitchEngaged) return { status: "REJECTED", reason: "KILL_SWITCH_ENGAGED" };
  if (session.revokedAtMs !== undefined) return { status: "REJECTED", reason: "SESSION_REVOKED" };
  if (nowMs < session.activatedAtMs || nowMs >= session.expiresAtMs) return { status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" };

  return Object.freeze({
    status: "AUTHORIZED",
    authorization: Object.freeze({
      ownerPrincipalId,
      sessionId: session.sessionId,
      revision: current.revision,
    }),
  });
}
