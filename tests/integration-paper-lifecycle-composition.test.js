import assert from "node:assert/strict";
import test from "node:test";

const { createProductionResearchComposition } = await import("../dist/apps/cloud/src/cloudResearchProductionComposition.js");

test("production Research composition is explicit and fail-closed until the durable closed loop is available", () => {
  const research = createProductionResearchComposition();

  assert.ok(research.researchRuntime);
  assert.ok(research.researchRecoveryCoordinator);
  assert.ok(research.researchAutomation);

  const recovery = research.researchRecoveryCoordinator.recover();
  assert.equal(recovery.status, "FAIL_CLOSED");
  assert.deepEqual(recovery.reasons, ["RESEARCH_PRODUCTION_COMPOSITION_UNAVAILABLE"]);

  const automationRecovery = research.researchAutomation.recover?.();
  assert.equal(automationRecovery?.status, "FAIL_CLOSED");
  assert.deepEqual(automationRecovery?.reasons, ["RESEARCH_PRODUCTION_COMPOSITION_UNAVAILABLE"]);
  assert.equal(research.researchAutomation.statusProjection?.(), null);

  assert.throws(
    () => research.researchRuntime.onMarketData({ market: "KRW-BTC", price: 100_000_000, observedAt: 1, now: 1 }),
    /RESEARCH_PRODUCTION_COMPOSITION_UNAVAILABLE/,
  );
});

test("fail-closed Research composition exposes no execution or LIVE authority surface", () => {
  const research = createProductionResearchComposition();
  const serialized = JSON.stringify(research);
  assert.doesNotMatch(serialized, /productionMutationAllowed\s*"?\s*:\s*true/i);
  assert.doesNotMatch(serialized, /liveAuthority\s*"?\s*:\s*"?(?:FULL|LIVE|ENABLED)/i);
  assert.equal("execute" in research, false);
  assert.equal("submitOrder" in research, false);
  assert.equal("broker" in research, false);
});
