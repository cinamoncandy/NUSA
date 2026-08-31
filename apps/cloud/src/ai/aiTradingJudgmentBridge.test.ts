import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionAction, type DecisionResult } from "../../../../packages/contracts/src/decision";
import type { EvidenceBundle } from "./evidenceBundleBuilder";
import { buildAiTradingJudgment, type AiTradingJudgmentBridgeInput } from "./aiTradingJudgmentBridge";

function evidenceBundle(...evidenceIds: string[]): EvidenceBundle {
  return {
    evidence: evidenceIds.map((evidenceId) => ({ evidenceId })),
  } as unknown as EvidenceBundle;
}

function decision(action = DecisionAction.LONG): DecisionResult {
  return { action } as DecisionResult;
}

function input(overrides: Partial<AiTradingJudgmentBridgeInput> = {}): AiTradingJudgmentBridgeInput {
  return {
    judgmentId: "judgment-1",
    strategyId: "strategy-1",
    market: "KRW-BTC",
    generatedAt: "2026-08-31T06:15:00.000Z",
    thesis: "Verified trend evidence supports a bounded PAPER directional thesis.",
    evidence: [{ id: "support-1", statement: "Trend evidence is verified.", status: "KNOWN", evidenceRefs: ["ev-1"] }],
    counterEvidence: [{ id: "counter-1", statement: "Volatility can invalidate the thesis.", status: "RISK", evidenceRefs: ["ev-2"] }],
    confidence: 0.68,
    uncertainty: 0.31,
    marketRegime: "TREND_UP",
    scenarios: [
      { id: "base", label: "Base", probability: 0.7, expectedReturn: 0.04, narrative: "Trend persists." },
      { id: "bear", label: "Bear", probability: 0.3, expectedReturn: -0.03, narrative: "Trend fails." },
    ],
    expectedReturn: 0.019,
    downside: -0.03,
    riskBudget: 0.02,
    timeHorizonMs: 86_400_000,
    invalidationCondition: "Regime is no longer TREND_UP.",
    decision: decision(),
    evidenceBundle: evidenceBundle("ev-1", "ev-2"),
    ...overrides,
  };
}

describe("buildAiTradingJudgment", () => {
  it("copies the authoritative DecisionResult action and preserves bound evidence", () => {
    const result = buildAiTradingJudgment(input({ decision: decision(DecisionAction.SHORT) }));
    assert.equal(result.action, DecisionAction.SHORT);
    assert.deepEqual(result.evidence[0]?.evidenceRefs, ["ev-1"]);
    assert.deepEqual(result.counterEvidence[0]?.evidenceRefs, ["ev-2"]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.evidence), true);
    assert.equal(Object.isFrozen(result.scenarios), true);
  });

  it("fails closed when displayed support evidence is not in the verified bundle", () => {
    assert.throws(
      () => buildAiTradingJudgment(input({
        evidence: [{ id: "support-1", statement: "Unsupported claim.", status: "KNOWN", evidenceRefs: ["missing"] }],
      })),
      /AI_TRADING_JUDGMENT_EVIDENCE_0_EVIDENCE_UNBOUND:missing/,
    );
  });

  it("fails closed when displayed counter-evidence is not in the verified bundle", () => {
    assert.throws(
      () => buildAiTradingJudgment(input({
        counterEvidence: [{ id: "counter-1", statement: "Unbound counter claim.", status: "RISK", evidenceRefs: ["missing-counter"] }],
      })),
      /AI_TRADING_JUDGMENT_COUNTER_EVIDENCE_0_EVIDENCE_UNBOUND:missing-counter/,
    );
  });

  it("requires every displayed evidence item to carry provenance", () => {
    assert.throws(
      () => buildAiTradingJudgment(input({
        evidence: [{ id: "support-1", statement: "Claim without provenance.", status: "KNOWN", evidenceRefs: [] }],
      })),
      /AI_TRADING_JUDGMENT_EVIDENCE_0_EVIDENCE_REQUIRED/,
    );
  });

  it("delegates cross-field and probability validation to the canonical contract", () => {
    assert.throws(
      () => buildAiTradingJudgment(input({
        scenarios: [{ id: "bad", label: "Bad", probability: 0.4, expectedReturn: 0.01, narrative: "Incomplete probability mass." }],
      })),
      /SCENARIO_PROBABILITIES_NOT_NORMALIZED/,
    );
    assert.throws(
      () => buildAiTradingJudgment(input({ expectedReturn: -0.05, downside: 0.01 })),
      /DOWNSIDE_EXCEEDS_EXPECTED_RETURN/,
    );
  });

  it("rejects an empty authoritative evidence bundle", () => {
    assert.throws(
      () => buildAiTradingJudgment(input({ evidenceBundle: evidenceBundle() })),
      /AI_TRADING_JUDGMENT_EVIDENCE_BUNDLE_EMPTY/,
    );
  });
});
