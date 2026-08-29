import assert from "node:assert/strict";
import test from "node:test";
import {
  decideStrategyLifecycle,
  type StrategyLifecycleEvidence,
  type StrategyLifecycleState,
} from "./evolveStrategyLifecyclePolicy";

const evidence = (
  dimension: StrategyLifecycleEvidence["dimension"],
  verdict: StrategyLifecycleEvidence["verdict"],
  overrides: Partial<StrategyLifecycleEvidence> = {},
): StrategyLifecycleEvidence => ({ dimension, verdict, fresh: true, independent: true, ...overrides });

const decide = (
  currentState: StrategyLifecycleState,
  items: readonly StrategyLifecycleEvidence[],
  strategyFailureStreak = 0,
) => decideStrategyLifecycle({ currentState, evidence: items, strategyFailureStreak });

test("demotes promoted strategies when evidence is missing, stale, insufficient or non-independent", () => {
  assert.equal(decide("PROMOTED", []).nextState, "DEMOTED");
  assert.equal(decide("PROMOTED", [evidence("EDGE", "VERIFIED_HEALTHY", { fresh: false })]).nextState, "DEMOTED");
  assert.equal(decide("PROMOTED", [evidence("EDGE", "INSUFFICIENT")]).nextState, "DEMOTED");
  assert.equal(decide("PROMOTED", [evidence("EDGE", "VERIFIED_HEALTHY", { independent: false })]).nextState, "DEMOTED");
});

test("quarantines conflicting evidence for the same dimension", () => {
  const result = decide("PROMOTED", [
    evidence("CALIBRATION", "VERIFIED_HEALTHY"),
    evidence("CALIBRATION", "DETERIORATED"),
  ]);
  assert.equal(result.nextState, "QUARANTINED");
  assert.equal(result.reason, "evidence-conflicting");
});

test("quarantines provenance and infrastructure failures without attributing them to strategy retirement", () => {
  const provenance = decide("PROMOTED", [evidence("PROVENANCE", "FAILED")], 99);
  assert.equal(provenance.nextState, "QUARANTINED");
  assert.equal(provenance.reason, "provenance-failure");

  const infrastructure = decide("QUARANTINED", [evidence("INFRASTRUCTURE", "FAILED")], 99);
  assert.equal(infrastructure.nextState, "QUARANTINED");
  assert.equal(infrastructure.reason, "infrastructure-failure");
});

test("retires only after repeated independently verified strategy failures from a contained state", () => {
  const first = decide("PROMOTED", [evidence("EDGE", "FAILED")], 1);
  assert.equal(first.nextState, "QUARANTINED");
  assert.equal(first.reason, "strategy-failure");

  const repeated = decide("QUARANTINED", [evidence("EDGE", "FAILED")], 3);
  assert.equal(repeated.nextState, "RETIRED");
  assert.equal(repeated.reason, "repeated-strategy-failure");
});

test("deterioration demotes promoted strategies but never promotes candidate or watch states", () => {
  assert.equal(decide("PROMOTED", [evidence("COST", "DETERIORATED")]).nextState, "DEMOTED");
  assert.equal(decide("CANDIDATE", [evidence("EDGE", "VERIFIED_HEALTHY")]).nextState, "CANDIDATE");
  assert.equal(decide("WATCH", [evidence("EDGE", "VERIFIED_HEALTHY")]).nextState, "WATCH");
});

test("retirement is absorbing and decisions are deterministic/idempotent", () => {
  const input = [evidence("EDGE", "VERIFIED_HEALTHY")];
  assert.deepEqual(decide("RETIRED", input), decide("RETIRED", input));
  assert.equal(decide("RETIRED", input).nextState, "RETIRED");
});

test("never grants live, production mutation or AI authority", () => {
  const result = decide("PROMOTED", [evidence("REGIME", "FAILED")], 1);
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  assert.equal(Object.isFrozen(result), true);
});
