import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleAiTradingJudgment, AiTradingJudgmentAssemblyInvalidError, type AssembleAiTradingJudgmentInput } from "./aiTradingJudgmentAssembly";
import { DecisionAction, DecisionState, type DecisionResult } from "./decision";
import { validateAiTradingJudgment } from "./aiTradingJudgment";

function decisionResult(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    state: DecisionState.APPROVED_PAPER_ACTION,
    action: DecisionAction.LONG,
    respondingMembers: 3,
    countedMembers: 3,
    agreementCount: 2,
    agreementRatio: 2 / 3,
    reasons: [],
    ballots: [
      { memberId: "agent-a", memberVersion: "v1", family: "momentum", action: DecisionAction.LONG, support: 0.8, evidenceRefs: ["ev-1"], evaluatedAt: "2026-08-31T00:00:00.000Z" },
      { memberId: "agent-b", memberVersion: "v1", family: "meanrev", action: DecisionAction.LONG, support: 0.6, evidenceRefs: ["ev-2"], evaluatedAt: "2026-08-31T00:00:00.000Z" },
      { memberId: "agent-c", memberVersion: "v1", family: "carry", action: DecisionAction.SHORT, support: 0.5, evidenceRefs: ["ev-3"], evaluatedAt: "2026-08-31T00:00:00.000Z" },
    ],
    gates: [],
    policyId: "policy-1",
    policyVersion: "v1",
    ...overrides,
  };
}

function baseInput(overrides: Partial<AssembleAiTradingJudgmentInput> = {}): AssembleAiTradingJudgmentInput {
  return {
    judgmentId: "judgment-1",
    strategyId: "strategy-1",
    market: "BTC-USD",
    generatedAt: "2026-08-31T00:00:00.000Z",
    thesis: "Momentum agents outvote the carry dissent; order flow favors continuation.",
    decision: decisionResult(),
    ballotNarratives: {
      "agent-a": "Order flow has turned net-buy over the last hour.",
      "agent-b": "Volatility contraction favors a breakout continuation.",
      "agent-c": "Funding rate is elevated, a headwind for further upside.",
    },
    marketRegime: "TREND_UP",
    scenarios: [
      { id: "bull", label: "Bull", probability: 0.5, expectedReturn: 0.04, narrative: "Continuation." },
      { id: "bear", label: "Bear", probability: 0.5, expectedReturn: -0.03, narrative: "Reversion." },
    ],
    expectedReturn: 0.01,
    downside: -0.03,
    riskBudget: 0.1,
    timeHorizonMs: 60 * 60 * 1000,
    invalidationCondition: "Order flow reverses net-sell for two consecutive 15-minute bars.",
    ...overrides,
  };
}

describe("assembleAiTradingJudgment", () => {
  it("assembles a valid judgment that passes validateAiTradingJudgment", () => {
    const judgment = assembleAiTradingJudgment(baseInput());
    assert.equal(validateAiTradingJudgment(judgment).valid, true);
  });

  it("splits ballots into evidence (agreeing) and counterEvidence (disagreeing, non-abstain)", () => {
    const judgment = assembleAiTradingJudgment(baseInput());
    assert.deepEqual(judgment.evidence.map((item) => item.id).sort(), ["agent-a", "agent-b"]);
    assert.deepEqual(judgment.counterEvidence.map((item) => item.id), ["agent-c"]);
  });

  it("uses the decision's own agreementRatio as confidence, not a fabricated number", () => {
    const judgment = assembleAiTradingJudgment(baseInput());
    assert.equal(judgment.confidence, 2 / 3);
  });

  it("takes the action directly from the DecisionResult", () => {
    const judgment = assembleAiTradingJudgment(baseInput({ decision: decisionResult({ action: DecisionAction.SHORT }) }));
    assert.equal(judgment.action, DecisionAction.SHORT);
  });

  it("excludes ABSTAIN ballots from both evidence and counterEvidence", () => {
    const decision = decisionResult({
      ballots: [
        { memberId: "agent-a", memberVersion: "v1", family: "momentum", action: DecisionAction.LONG, support: 0.8, evidenceRefs: ["ev-1"], evaluatedAt: "2026-08-31T00:00:00.000Z" },
        { memberId: "agent-d", memberVersion: "v1", family: "macro", action: DecisionAction.ABSTAIN, support: 0, evidenceRefs: [], evaluatedAt: "2026-08-31T00:00:00.000Z" },
      ],
      agreementCount: 1,
      respondingMembers: 2,
      countedMembers: 2,
      agreementRatio: 1,
    });
    const judgment = assembleAiTradingJudgment(baseInput({
      decision,
      ballotNarratives: { "agent-a": "Order flow net-buy.", "agent-d": "Insufficient macro signal." },
    }));
    assert.deepEqual(judgment.evidence.map((item) => item.id), ["agent-a"]);
    assert.deepEqual(judgment.counterEvidence, []);
  });

  it("drops a ballot from evidence/counterEvidence when no narrative is supplied for it", () => {
    const judgment = assembleAiTradingJudgment(baseInput({ ballotNarratives: { "agent-a": "Order flow net-buy." } }));
    assert.deepEqual(judgment.evidence.map((item) => item.id), ["agent-a"]);
    assert.deepEqual(judgment.counterEvidence, []);
  });

  it("marks a stale or failed ballot's evidence status as RISK regardless of any supplied status", () => {
    const decision = decisionResult({
      ballots: [
        { memberId: "agent-a", memberVersion: "v1", family: "momentum", action: DecisionAction.LONG, support: 0.8, evidenceRefs: ["ev-1"], evaluatedAt: "2026-08-31T00:00:00.000Z", stale: true },
      ],
      agreementCount: 1,
      respondingMembers: 1,
      countedMembers: 1,
      agreementRatio: 1,
    });
    const judgment = assembleAiTradingJudgment(baseInput({
      decision,
      ballotNarratives: { "agent-a": "Order flow net-buy." },
      ballotEpistemicStatus: { "agent-a": "KNOWN" },
    }));
    assert.equal(judgment.evidence[0]?.status, "RISK");
  });

  it("computes uncertainty as the larger of disagreement share and stale/failed share", () => {
    const decision = decisionResult({
      ballots: [
        { memberId: "agent-a", memberVersion: "v1", family: "momentum", action: DecisionAction.LONG, support: 0.8, evidenceRefs: ["ev-1"], evaluatedAt: "2026-08-31T00:00:00.000Z", stale: true },
        { memberId: "agent-b", memberVersion: "v1", family: "meanrev", action: DecisionAction.LONG, support: 0.6, evidenceRefs: ["ev-2"], evaluatedAt: "2026-08-31T00:00:00.000Z" },
      ],
      agreementCount: 2,
      respondingMembers: 2,
      countedMembers: 2,
      agreementRatio: 1, // full agreement, so disagreementShare = 0
    });
    const judgment = assembleAiTradingJudgment(baseInput({
      decision,
      ballotNarratives: { "agent-a": "x", "agent-b": "y" },
    }));
    // disagreementShare = 0, staleShare = 1/2 = 0.5 -> uncertainty should be 0.5, not 0.
    assert.equal(judgment.uncertainty, 0.5);
  });

  it("throws AiTradingJudgmentAssemblyInvalidError when the assembled evidence list would be empty", () => {
    assert.throws(
      () => assembleAiTradingJudgment(baseInput({ ballotNarratives: {} })),
      (error: unknown) => {
        assert.ok(error instanceof AiTradingJudgmentAssemblyInvalidError);
        assert.ok(error.errors.includes("EVIDENCE_REQUIRED"));
        return true;
      },
    );
  });

  it("throws when caller-supplied fields (e.g. invalidationCondition) are invalid", () => {
    assert.throws(() => assembleAiTradingJudgment(baseInput({ invalidationCondition: "" })));
  });
});
