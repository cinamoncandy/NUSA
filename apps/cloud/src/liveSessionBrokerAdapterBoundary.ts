import type { LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";
import {
  FailClosedLiveBrokerTransport,
  type LiveBrokerTransport,
  type LiveBrokerTransportRequest,
  type LiveBrokerTransportResult,
  validateLiveBrokerTransportRequest,
} from "./liveBrokerTransportBoundaryV3";
import { LiveBrokerDispatchDurableState } from "./liveBrokerDispatchDurableState";
import type { LiveSessionBoundPreExecutionRequest } from "./liveSessionBoundPreExecution";
import type { LiveAuthoritativeSessionRequest } from "./liveAuthoritativeSessionTransportChain";
import { prepareAuthoritativeSessionBoundLiveTransport } from "./liveAuthoritativeSessionTransportChain";
import { authorizeCurrentLiveSessionRevision } from "./liveSessionRevisionAuthorization";
import type { LiveRuntimeSessionDurableStore, LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";

export type LiveSessionBrokerAdapterDecision =
  | Readonly<{ status: "REJECTED"; reason: string }>
  | Readonly<{ status: "SUBMITTED"; result: LiveBrokerTransportResult }>;

export async function submitSessionBoundLiveOrder(
  _request: LiveSessionBoundPreExecutionRequest,
  _consumeOnce: LiveExecutionConsumeOnce,
  _transport: LiveBrokerTransport = new FailClosedLiveBrokerTransport(),
): Promise<LiveSessionBrokerAdapterDecision> {
  return Object.freeze({ status: "REJECTED", reason: "AUTHORITATIVE_SESSION_REQUIRED" });
}

export async function submitAuthoritativeSessionBoundLiveOrder(
  request: LiveAuthoritativeSessionRequest,
  sessionStore: LiveRuntimeSessionDurableStore,
  consumeOnce: LiveExecutionConsumeOnce,
  transport: LiveBrokerTransport = new FailClosedLiveBrokerTransport(),
  dispatchStorage?: LiveRuntimeSessionStorage,
): Promise<LiveSessionBrokerAdapterDecision> {
  const prepared = await prepareAuthoritativeSessionBoundLiveTransport(request, sessionStore, consumeOnce);
  if (prepared.status !== "READY") return Object.freeze({ status: "REJECTED", reason: prepared.reason });
  const authorized = await authorizeCurrentLiveSessionRevision(prepared, request.ownerPrincipalId, sessionStore, request.now);
  if (authorized.status !== "AUTHORIZED") return Object.freeze({ status: "REJECTED", reason: authorized.reason });
  const chain = prepared.chain;
  if (chain.transport.status !== "READY") return Object.freeze({ status: "REJECTED", reason: chain.transport.reason });

  const brokerRequest: LiveBrokerTransportRequest = Object.freeze({
    ownerId: chain.transport.request.ownerPrincipalId,
    market: chain.transport.request.market,
    side: chain.transport.request.side === "BUY" ? "buy" : "sell",
    notional: chain.transport.request.requestedNotionalUsd,
    fingerprint: chain.transport.request.authorizationFingerprintSha256,
  });
  const invalidReason = validateLiveBrokerTransportRequest(brokerRequest);
  if (invalidReason !== null) return Object.freeze({ status: "REJECTED", reason: invalidReason });

  const finalReservation = await sessionStore.reserveFinalExecution(
    authorized.authorization.ownerPrincipalId,
    authorized.authorization.sessionId,
    authorized.authorization.revision,
    brokerRequest.fingerprint,
    request.now,
  );
  if (finalReservation.status !== "RESERVED") return Object.freeze({ status: "REJECTED", reason: finalReservation.reason });

  // Production broker mutation remains disabled. A broker-capable caller must provide
  // durable dispatch storage so crash/retry state is committed before any external call.
  if (!dispatchStorage) return Object.freeze({ status: "REJECTED", reason: "DURABLE_DISPATCH_REQUIRED" });
  const dispatch = new LiveBrokerDispatchDurableState(dispatchStorage);
  const acquired = await dispatch.acquire(
    brokerRequest.fingerprint,
    authorized.authorization.ownerPrincipalId,
    authorized.authorization.sessionId,
    authorized.authorization.revision,
    request.now,
  );
  if (acquired.status === "REJECTED") return Object.freeze({ status: "REJECTED", reason: acquired.reason });
  if (acquired.status === "EXISTING") return Object.freeze({ status: "REJECTED", reason: `DISPATCH_${acquired.record.state}` });

  try {
    const result = await transport.submit(brokerRequest);
    const completed = await dispatch.complete(brokerRequest.fingerprint, result.accepted, result.reason, request.now);
    if (completed.status === "REJECTED") return Object.freeze({ status: "REJECTED", reason: completed.reason });
    return Object.freeze({ status: "SUBMITTED", result });
  } catch {
    await dispatch.markUncertain(brokerRequest.fingerprint, "BROKER_RESULT_UNCERTAIN", request.now);
    return Object.freeze({ status: "REJECTED", reason: "BROKER_RESULT_UNCERTAIN" });
  }
}
