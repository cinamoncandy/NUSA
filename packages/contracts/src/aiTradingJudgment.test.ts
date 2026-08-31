import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAiTradingJudgment, isValidAiTradingJudgment, type AiTradingJudgment } from "./aiTradingJudgment";
import { DecisionAction } from "./decision";

function validJudgment(): AiTradingJudgment {
  return {
    schemaVersion: 1,
    judgmentId: "judgment-1",
    strategyId: "strategy-1",
    market: "BTC-USD",
    generatedAt: "2026-08-31T00:00:00.000Z",
    thesis: "Momentum is building on a volatility contraction into resistance.",
    evidence: [
      { id: "ev-1", statement: "Order flow has turned net-buy over the last hour.", status: "KNOWN", evidenceRefs: ["orderflow:1h"] },
      { id: "ev-2", statement: "Volatility is likely to expand given the current squeeze.", status: "ESTIMATE", evidenceRefs: ["vol:squeeze"] },
    ],
    counterEvidence: [
      { id: "ce-1", statement: "Funding rate is already elevated, a headwind for further upside.", status: "RISK", evidenceRefs: ["funding:8h"] },
    ],
    confidence: 0.62,
    uncertainty: 0.35,
    marketRegime: "TREND_UP",
    scenarios: [
      { id: "bull", label: "Bull", probability: 0.4, expectedReturn: 0.05, narrative: "Breakout continuation." },
      { id: "base", label: "Base", probability: 0.4, expectedReturn: 0.01, narrative: "Range-bound chop." },
      { id: "bear", label: "Bear", probability: 0.2, expectedReturn: -0.04, narrative: "Failed breakout, mean reversion." },
    ],
    expectedReturn: 0.018,
    downside: -0.04,
    riskBudget: 0.1,
    timeHorizonMs: 4 * 60 * 60 * 1000,
    invalidationCondition: "Price closes back below the prior range high on rising volume.",
    action: DecisionAction.LONG,
  };
}

describe("ai trading judgment contract", () => {
  it("accepts a fully populated, internally consistent judgment", () => {
    const result = validateAiTradingJudgment(validJudgment());
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(isValidAiTradingJudgment(validJudgment()), true);
  });

  it("requires at least one evidence item", () => {
    const result = validateAiTradingJudgment({ ...validJudgment(), evidence: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("EVIDENCE_REQUIRED"));
  });

  it("allows an empty counter-evidence array but not a missing one", () => {
    const withEmpty = validateAiTradingJudgment({ ...validJudgment(), counterEvidence: [] });
    assert.equal(withEmpty.valid, true);
    const withMissing = validateAiTradingJudgment({ ...validJudgment(), counterEvidence: undefined });
    assert.equal(withMissing.valid, false);
    assert.ok(withMissing.errors.includes("COUNTER_EVIDENCE_INVALID"));
  });

  it("rejects an evidence item with an unrecognized epistemic status", () => {
    const judgment = validJudgment();
    const result = validateAiTradingJudgment({
      ...judgment,
      evidence: [{ ...judgment.evidence[0], status: "PROBABLY_TRUE" }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("STATUS_INVALID")));
  });

  it("rejects confidence or uncertainty outside 0..1", () => {
    assert.equal(validateAiTradingJudgment({ ...validJudgment(), confidence: 1.5 }).valid, false);
    assert.equal(validateAiTradingJudgment({ ...validJudgment(), uncertainty: -0.1 }).valid, false);
  });

  it("requires scenario probabilities to sum to ~1", () => {
    const judgment = validJudgment();
    const result = validateAiTradingJudgment({
      ...judgment,
      scenarios: [{ ...judgment.scenarios[0], probability: 0.9 }, judgment.scenarios[1], judgment.scenarios[2]],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("SCENARIO_PROBABILITIES_NOT_NORMALIZED"));
  });

  it("tolerates small floating point drift in scenario probabilities", () => {
    const judgment = validJudgment();
    const result = validateAiTradingJudgment({
      ...judgment,
      scenarios: [
        { ...judgment.scenarios[0], probability: 0.401 },
        { ...judgment.scenarios[1], probability: 0.399 },
        judgment.scenarios[2],
      ],
    });
    assert.equal(result.valid, true);
  });

  it("rejects downside greater than expected return", () => {
    const result = validateAiTradingJudgment({ ...validJudgment(), expectedReturn: 0.01, downside: 0.05 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("DOWNSIDE_EXCEEDS_EXPECTED_RETURN"));
  });

  it("rejects a non-enumerated action", () => {
    const result = validateAiTradingJudgment({ ...validJudgment(), action: "MOON" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("ACTION_INVALID"));
  });

  it("rejects a missing invalidation condition", () => {
    const result = validateAiTradingJudgment({ ...validJudgment(), invalidationCondition: "" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("INVALIDATION_CONDITION_INVALID"));
  });

  it("rejects a non-positive time horizon", () => {
    assert.equal(validateAiTradingJudgment({ ...validJudgment(), timeHorizonMs: 0 }).valid, false);
    assert.equal(validateAiTradingJudgment({ ...validJudgment(), timeHorizonMs: -1 }).valid, false);
  });

  it("rejects risk budget outside 0..1", () => {
    assert.equal(validateAiTradingJudgment({ ...validJudgment(), riskBudget: 1.2 }).valid, false);
  });

  it("rejects an unparseable generatedAt timestamp", () => {
    const result = validateAiTradingJudgment({ ...validJudgment(), generatedAt: "not-a-date" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("GENERATED_AT_INVALID"));
  });

  it("rejects a non-object value", () => {
    assert.equal(validateAiTradingJudgment(null).valid, false);
    assert.equal(validateAiTradingJudgment("judgment").valid, false);
  });
});
