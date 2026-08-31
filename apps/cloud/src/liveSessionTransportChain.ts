import { LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";
import {
  evaluateLiveSessionBoundPreExecution,
  type LiveSessionBoundPreExecutionRequest,
} from "./liveSessionBoundPreExecution";
import {
  prepareLiveTransportRequest,
  type LiveTransportConsumeScope,
  type LiveTransportDecision,
} from "./liveTransportContract";

export interface LiveSessionTransportChainResult {
  readonly preExecutionStatus: "READY" | "REJECTED";
  readonly transport: LiveTransportDecision;
}

/**
 * End-to-end fail-closed boundary from the owner-bound LIVE runtime session
 * through pre-execution, consume-once, and transport preparation.
 *
 * This function performs no broker/network mutation and grants no LIVE authority.
 */
export async function prepareSessionBoundLiveTransport(
  request: LiveSessionBoundPreExecutionRequest,
  consumeOnce: LiveExecutionConsumeOnce,
  consumeScope?: LiveTransportConsumeScope,
): Promise<LiveSessionTransportChainResult> {
  const envelope = evaluateLiveSessionBoundPreExecution(request);
  const transport = await prepareLiveTransportRequest(envelope, consumeOnce, request.now, consumeScope);

  return Object.freeze({
    preExecutionStatus: envelope.status,
    transport,
  });
}
