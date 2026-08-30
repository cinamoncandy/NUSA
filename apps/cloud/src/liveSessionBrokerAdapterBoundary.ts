import type { LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";
import {
  FailClosedLiveBrokerTransport,
  type LiveBrokerTransport,
  type LiveBrokerTransportRequest,
  type LiveBrokerTransportResult,
  validateLiveBrokerTransportRequest,
} from "./liveBrokerTransportBoundaryV3";
import type { LiveSessionBoundPreExecutionRequest } from "./liveSessionBoundPreExecution";
import { prepareSessionBoundLiveTransport } from "./liveSessionTransportChain";

export type LiveSessionBrokerAdapterDecision =
  | Readonly<{ status: "REJECTED"; reason: string }>
  | Readonly<{ status: "SUBMITTED"; result: LiveBrokerTransportResult }>;

/**
 * Last fail-closed orchestration boundary before the broker transport interface.
 * The default transport remains disabled, so calling this function cannot enable
 * production mutation unless a separately governed transport is explicitly supplied.
 */
export async function submitSessionBoundLiveOrder(
  request: LiveSessionBoundPreExecutionRequest,
  consumeOnce: LiveExecutionConsumeOnce,
  transport: LiveBrokerTransport = new FailClosedLiveBrokerTransport(),
): Promise<LiveSessionBrokerAdapterDecision> {
  const chain = await prepareSessionBoundLiveTransport(request, consumeOnce);
  if (chain.transport.status !== "READY") {
    return Object.freeze({ status: "REJECTED", reason: chain.transport.reason });
  }

  const brokerRequest: LiveBrokerTransportRequest = Object.freeze({
    ownerId: chain.transport.request.ownerPrincipalId,
    market: chain.transport.request.market,
    side: chain.transport.request.side === "BUY" ? "buy" : "sell",
    notional: chain.transport.request.requestedNotionalUsd,
    fingerprint: chain.transport.request.authorizationFingerprintSha256,
  });
  const invalidReason = validateLiveBrokerTransportRequest(brokerRequest);
  if (invalidReason !== null) {
    return Object.freeze({ status: "REJECTED", reason: invalidReason });
  }

  return Object.freeze({ status: "SUBMITTED", result: await transport.submit(brokerRequest) });
}
