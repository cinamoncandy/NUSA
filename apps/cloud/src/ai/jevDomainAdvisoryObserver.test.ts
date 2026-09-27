import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JevDomainAdvisoryShadowObserver } from "./jevDomainAdvisoryObserver";

const base = {
  taskType: "RISK_EVENT_CLASSIFICATION" as const,
  inputFingerprint: "a".repeat(64),
  sourceIdentity: "risk:paper:42",
  sourceVersion: "head:" + "b".repeat(40),
  evidence: Object.freeze({
    familyCount: 4,
    drawdownOverlapHigh: true,
    regime: "sideways",
  }),
  providerId: "jev",
  modelIdentity: "jev-shadow",
  providerModelVersion: "jev-shadow-v1",
  timeoutApplied: true,
  correlationId: "corr:42",
  traceId: "trace:42",
  timestamp: "2026-09-27T00:00:00.000Z",
};

describe("Jev domain advisory shadow observer", () => {
  it("emits a validated SHADOW observation for a high-confidence domain decision", async () => {
    let captured: Readonly<Record<string, unknown>> | undefined;
    const observer = new JevDomainAdvisoryShadowObserver(async (input) => {
      captured = input;
      return {
        classification: "STRESS",
        severity: 3,
        requiredModel: "SOL",
        reasonCode: "STRESS_CLUSTER",
        confidence: 0.93,
      };
    }, { minConfidence: 0.8 });

    const observation = await observer.observe(base);
    assert.equal(observation.taskType, "RISK_EVENT_CLASSIFICATION");
    assert.equal(observation.decision.classification, "STRESS");
    assert.equal(observation.requiredModel, "SOL");
    assert.equal(observation.rolloutStage, "SHADOW");
    assert.equal(observation.usableForRouting, false);
    assert.equal(observation.fallbackApplied, false);
    assert.equal(observation.aiAuthority, "ZERO_AUTHORITY");
    assert.ok(captured);
    assert.deepEqual(captured?.allowedClassifications, ["NORMAL", "CONCENTRATION", "CORRELATION", "DRAWDOWN", "STRESS", "UNKNOWN"]);
    assert.deepEqual(captured?.evidence, base.evidence);
  });

  it("disabled observer returns deterministic HUMAN/UNKNOWN fallback without classifier call", async () => {
    let calls = 0;
    const observer = new JevDomainAdvisoryShadowObserver(async () => {
      calls += 1;
      return {};
    }, { enabled: false });
    const observation = await observer.observe(base);
    assert.equal(calls, 0);
    assert.equal(observation.decision.classification, "UNKNOWN");
    assert.equal(observation.requiredModel, "HUMAN");
    assert.equal(observation.reasonCode, "DISABLED_FALLBACK");
    assert.equal(observation.fallbackApplied, true);
  });

  it("low confidence and malformed output fall back without becoming routable", async () => {
    for (const classify of [
      async () => ({
        classification: "STRESS",
        severity: 3,
        requiredModel: "SOL",
        reasonCode: "STRESS_CLUSTER",
        confidence: 0.2,
      }),
      async () => ({ classification: "NOT_ALLOWED", confidence: 0.99 }),
    ]) {
      const observer = new JevDomainAdvisoryShadowObserver(classify, { minConfidence: 0.8 });
      const observation = await observer.observe(base);
      assert.equal(observation.fallbackApplied, true);
      assert.equal(observation.requiredModel, "HUMAN");
      assert.equal(observation.usableForRouting, false);
    }
  });

  it("timeout/provider/shadow failure paths remain deterministic fallback", async () => {
    for (const [name, expected] of [
      ["TimeoutError", "TIMEOUT_FALLBACK"],
      ["JevProviderUnavailableError", "PROVIDER_UNAVAILABLE_FALLBACK"],
      ["OtherError", "SHADOW_FAILURE_FALLBACK"],
    ] as const) {
      const observer = new JevDomainAdvisoryShadowObserver(async () => {
        const error = new Error("provider");
        error.name = name;
        throw error;
      });
      const observation = await observer.observe(base);
      assert.equal(observation.reasonCode, expected);
      assert.equal(observation.fallbackApplied, true);
      assert.equal(observation.decision.classification, "UNKNOWN");
    }
  });

  it("TEST_SCOPE uses FULL as the conservative fallback when UNKNOWN is not in policy", async () => {
    const observer = new JevDomainAdvisoryShadowObserver(async () => {
      throw Object.assign(new Error("down"), { name: "JevProviderUnavailableError" });
    });
    const observation = await observer.observe({
      ...base,
      taskType: "TEST_SCOPE_RECOMMENDATION",
    });
    assert.equal(observation.decision.classification, "FULL");
    assert.equal(observation.requiredModel, "HUMAN");
    assert.equal(observation.fallbackApplied, true);
  });

  it("rejects sensitive evidence before classifier invocation", async () => {
    let calls = 0;
    const observer = new JevDomainAdvisoryShadowObserver(async () => {
      calls += 1;
      return {};
    });
    await assert.rejects(
      observer.observe({
        ...base,
        evidence: { ...base.evidence, apiToken: "redacted" },
      }),
      /JEV_DOMAIN_EVIDENCE_SENSITIVE_FIELD/,
    );
    assert.equal(calls, 0);
  });

  it("rejects secret-shaped common metadata before classifier invocation", async () => {
    let calls = 0;
    const observer = new JevDomainAdvisoryShadowObserver(async () => {
      calls += 1;
      return {};
    });
    await assert.rejects(
      observer.observe({
        ...base,
        sourceIdentity: ["gh", "p_", "12345678901234567890"].join(""),
      }),
      /JEV_SOURCE_IDENTITY_INVALID/,
    );
    assert.equal(calls, 0);
  });

  it("rejects non-advisory task types rather than replacing specialized validators", async () => {
    const observer = new JevDomainAdvisoryShadowObserver(async () => ({}));
    await assert.rejects(
      observer.observe({
        ...base,
        taskType: "WORKFLOW_FAILURE_CLASSIFICATION",
      }),
      /JEV_DOMAIN_ADVISORY_POLICY_REQUIRED/,
    );
  });
});
