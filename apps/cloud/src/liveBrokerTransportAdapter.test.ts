import assert from "node:assert/strict";
import test from "node:test";
import type { LiveTransportRequest } from "./liveTransportContract";
import {
  FailClosedLiveBrokerTransportAdapter,
  executeThroughLiveBroker,
  validateLiveTransportRequest,
} from "./liveBrokerTransportAdapter";

const request: LiveTransportRequest = Object.freeze({
  ownerPrincipalId: "owner-1",
  market: "BTC-USD",
  side: "BUY",
  requestedNotionalUsd: 100,
  authorizationFingerprintSha256: "a".repeat(64),
});

test("accepts a bounded transport request", () => {
  assert.equal(validateLiveTransportRequest(request), true);
});

test("rejects malformed transport requests", () => {
  assert.equal(validateLiveTransportRequest({ ...request, requestedNotionalUsd: 0 }), false);
  assert.equal(validateLiveTransportRequest({ ...request, authorizationFingerprintSha256: "bad" }), false);
  assert.equal(validateLiveTransportRequest({ ...request, market: "" }), false);
});

test("default broker adapter remains fail-closed and does not mutate", async () => {
  const adapter = new FailClosedLiveBrokerTransportAdapter();
  assert.deepEqual(await executeThroughLiveBroker(adapter, request), {
    status: "NOT_CONFIGURED",
    reason: "BROKER_ADAPTER_NOT_CONFIGURED",
  });
});

test("invalid requests never reach the adapter", async () => {
  let called = false;
  const adapter = {
    async execute(): Promise<never> {
      called = true;
      throw new Error("must not execute");
    },
  };
  assert.deepEqual(
    await executeThroughLiveBroker(adapter, { ...request, requestedNotionalUsd: -1 }),
    { status: "REJECTED", reason: "LIVE_AUTHORITY_DISABLED" },
  );
  assert.equal(called, false);
});
