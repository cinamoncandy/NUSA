import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJevDomainObservation, getJevTaskTypePolicy } from "./jevDomainObservation";

describe("Jev market microstructure domain registration", () => {
  it("is SHADOW-only and owned by Market Data without routing authority", () => {
    const policy = getJevTaskTypePolicy("MARKET_MICROSTRUCTURE_ADVISORY_SHADOW");
    assert.equal(policy.domain, "MARKET_DATA");
    assert.equal(policy.maxStage, "SHADOW");
    assert.equal(policy.decisionSchema, "MARKET_MICROSTRUCTURE_V1");
    assert.deepEqual(policy.allowedActions, ["OBSERVE", "ESCALATE"]);

    const observation = createJevDomainObservation({
      taskType: "MARKET_MICROSTRUCTURE_ADVISORY_SHADOW",
      inputFingerprint: "a".repeat(64),
      sourceIdentity: "paper-orderbook:KRW-BTC:1000",
      sourceVersion: "UPBIT_PUBLIC_ORDERBOOK_V1",
      decision: {
        state: "WIDE_SPREAD",
        action: "REDUCE_RISK",
        confidence: 0.8,
        reasonCode: "SPREAD_ELEVATED",
      },
      requiredModel: "LUNA",
      reasonCode: "SPREAD_ELEVATED",
      confidence: 0.8,
      providerId: "jev-shadow",
      modelIdentity: "jev",
      providerModelVersion: "shadow-v1",
      timeoutApplied: false,
      fallbackApplied: false,
      correlationId: "market:KRW-BTC:1000",
      traceId: "trace:KRW-BTC:1000",
      timestamp: "2026-09-29T12:00:00.000Z",
    });

    assert.equal(observation.rolloutStage, "SHADOW");
    assert.equal(observation.usableForRouting, false);
    assert.equal(observation.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(observation.productionMutationAllowed, false);
    assert.equal(observation.liveAuthority, "NONE");
  });
});
