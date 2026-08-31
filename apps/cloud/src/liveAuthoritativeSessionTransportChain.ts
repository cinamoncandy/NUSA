import type { LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";
import type { LiveRuntimeSessionDurableStore } from "./liveRuntimeSessionDurableStore";
import type { LiveSessionBoundPreExecutionRequest } from "./liveSessionBoundPreExecution";
import { prepareSessionBoundLiveTransport, type LiveSessionTransportChainResult } from "./liveSessionTransportChain";

export type LiveAuthoritativeSessionRequest = Omit<LiveSessionBoundPreExecutionRequest, "session">;

export type LiveAuthoritativeSessionTransportResult =
  | Readonly<{ status: "READY"; revision: number; chain: LiveSessionTransportChainResult }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

/** Loads the persisted owner session immediately before LIVE pre-execution.
 * Caller-supplied session state is intentionally impossible at this boundary.
 */
export async function prepareAuthoritativeSessionBoundLiveTransport(
  request: LiveAuthoritativeSessionRequest,
  sessionStore: LiveRuntimeSessionDurableStore,
  consumeOnce: LiveExecutionConsumeOnce,
): Promise<LiveAuthoritativeSessionTransportResult> {
  if (typeof request.ownerPrincipalId !== "string" || request.ownerPrincipalId.trim().length === 0) {
    return { status: "REJECTED", reason: "OWNER_REQUIRED" };
  }

  const record = await sessionStore.read(request.ownerPrincipalId);
  if (!record) return { status: "REJECTED", reason: "AUTHORITATIVE_SESSION_UNAVAILABLE" };
  if (record.session.ownerPrincipalId !== request.ownerPrincipalId) {
    return { status: "REJECTED", reason: "AUTHORITATIVE_SESSION_OWNER_MISMATCH" };
  }

  const chain = await prepareSessionBoundLiveTransport(
    { ...request, session: record.session },
    consumeOnce,
    {
      ownerPrincipalId: record.session.ownerPrincipalId,
      sessionId: record.session.sessionId,
      sessionRevision: record.revision,
    },
  );
  if (chain.preExecutionStatus !== "READY" || chain.transport.status !== "READY") {
    return { status: "REJECTED", reason: `SESSION_CHAIN_${chain.transport.status}` };
  }

  return Object.freeze({ status: "READY", revision: record.revision, chain });
}
