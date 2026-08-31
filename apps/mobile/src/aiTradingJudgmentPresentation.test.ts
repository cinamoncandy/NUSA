import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionAction } from "../../../packages/contracts/src/decision";
import type { AiTradingJudgment } from "../../../packages/contracts/src/aiTradingJudgment";
import { presentAiTradingJudgment } from "./aiTradingJudgmentPresentation";

function judgment(overrides: Partial<AiTradingJudgment> = {}): AiTradingJudgment {
  return {
    schemaVersion: 1,
    judgmentId: "judgment-1",
    strategyId: "strategy-1",
    market: "KRW-BTC",
    generatedAt: "2026-08-31T06:20:00.000Z",
    thesis: "검증된 추세 근거가 우세합니다.",
    evidence: [{ id: "e1", statement: "추세 근거", status: "KNOWN", evidenceRefs: ["ev-1"] }],
    counterEvidence: [{ id: "c1", statement: "변동성 위험", status: "RISK", evidenceRefs: ["ev-2"] }],
    confidence: 0.684,
    uncertainty: 0.312,
    marketRegime: "TREND_UP",
    scenarios: [
      { id: "base", label: "Base", probability: 0.7, expectedReturn: 0.04, narrative: "추세 지속" },
      { id: "bear", label: "Bear", probability: 0.3, expectedReturn: -0.03, narrative: "추세 훼손" },
    ],
    expectedReturn: 0.019,
    downside: -0.03,
    riskBudget: 0.02,
    timeHorizonMs: 86_400_000,
    invalidationCondition: "TREND_UP 체제가 종료되면 무효",
    action: DecisionAction.LONG,
    ...overrides,
  };
}

describe("presentAiTradingJudgment", () => {
  it("renders the unified decision dimensions without implying execution authority", () => {
    const result = presentAiTradingJudgment(judgment());
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.market, "KRW-BTC");
    assert.equal(result.actionLabel, "LONG 관찰 판단");
    assert.equal(result.actionAuthorityLabel, "AI 판단 · 실행 권한 없음");
    assert.equal(result.regimeLabel, "TREND_UP");
    assert.equal(result.confidenceLabel, "68.4%");
    assert.equal(result.uncertaintyLabel, "31.2%");
    assert.equal(result.expectedReturnLabel, "1.9%");
    assert.equal(result.downsideLabel, "-3.0%");
    assert.equal(result.riskBudgetLabel, "2.0%");
    assert.equal(result.horizonLabel, "1일");
    assert.equal(result.invalidationCondition, "TREND_UP 체제가 종료되면 무효");
    assert.equal(result.scenarioCount, 2);
    assert.equal(result.evidenceCount, 1);
    assert.equal(result.counterEvidenceCount, 1);
  });

  it("never fabricates judgment values when no authoritative judgment exists", () => {
    const result = presentAiTradingJudgment(null);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.market, "-");
    assert.equal(result.confidenceLabel, "-");
    assert.equal(result.expectedReturnLabel, "-");
    assert.equal(result.actionLabel, "판단 없음");
    assert.equal(result.actionAuthorityLabel, "AI 판단 · 실행 권한 없음");
  });

  it("keeps every directional DecisionAction explicitly observational", () => {
    for (const [action, expected] of [
      [DecisionAction.LONG, "LONG 관찰 판단"],
      [DecisionAction.SHORT, "SHORT 관찰 판단"],
      [DecisionAction.EXIT, "EXIT 관찰 판단"],
      [DecisionAction.HOLD, "HOLD 관찰 판단"],
      [DecisionAction.ABSTAIN, "판단 보류"],
    ] as const) {
      const result = presentAiTradingJudgment(judgment({ action }));
      assert.equal(result.actionLabel, expected);
      assert.equal(result.actionAuthorityLabel, "AI 판단 · 실행 권한 없음");
    }
  });

  it("formats non-day horizons without hiding precision at the decision level", () => {
    assert.equal(presentAiTradingJudgment(judgment({ timeHorizonMs: 21_600_000 })).horizonLabel, "6시간");
    assert.equal(presentAiTradingJudgment(judgment({ timeHorizonMs: 5_400_000 })).horizonLabel, "90분");
  });
});
