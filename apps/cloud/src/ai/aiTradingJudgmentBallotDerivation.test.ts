import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveAiTradingJudgmentFieldsFromDecision } from "./aiTradingJudgmentBallotDerivation";
import { buildAiTradingJudgment } from "./aiTradingJudgmentBridge";
import { DecisionAction, DecisionState, type DecisionResult } from "../../../../packages/contracts/src/decision";
import { validateAiTradingJudgment } from "../../../../packages/contracts/src/aiTradingJudgment";
import type { EvidenceBundle } from "./evidenceBundleBuilder";

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

describe("deriveAiTradingJudgmentFieldsFromDecision", () => {
  it("splits ballots into evidence (agreeing) and counterEvidence (disagreeing, non-abstain)", () => {
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision: decisionResult(),
      ballotNarratives: {
        "agent-a": "Order flow net-buy.",
        "agent-b": "Volatility contraction favors continuation.",
        "agent-c": "Funding rate elevated, a headwind.",
      },
    });
    assert.deepEqual(fields.evidence.map((item) => item.id).sort(), ["agent-a", "agent-b"]);
    assert.deepEqual(fields.counterEvidence.map((item) => item.id), ["agent-c"]);
  });

  it("uses the decision's own agreementRatio as confidence", () => {
    const fields = deriveAiTradingJudgmentFieldsFromDecision({ decision: decisionResult(), ballotNarratives: {} });
    assert.equal(fields.confidence, 2 / 3);
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
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision,
      ballotNarratives: { "agent-a": "Order flow net-buy.", "agent-d": "Insufficient macro signal." },
    });
    assert.deepEqual(fields.evidence.map((item) => item.id), ["agent-a"]);
    assert.deepEqual(fields.counterEvidence, []);
  });

  it("drops a ballot when no narrative is supplied for it", () => {
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision: decisionResult(),
      ballotNarratives: { "agent-a": "Order flow net-buy." },
    });
    assert.deepEqual(fields.evidence.map((item) => item.id), ["agent-a"]);
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
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision,
      ballotNarratives: { "agent-a": "Order flow net-buy." },
      ballotEpistemicStatus: { "agent-a": "KNOWN" },
    });
    assert.equal(fields.evidence[0]?.status, "RISK");
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
      agreementRatio: 1,
    });
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision,
      ballotNarratives: { "agent-a": "x", "agent-b": "y" },
    });
    assert.equal(fields.uncertainty, 0.5);
  });
});

describe("derivation composed with the canonical buildAiTradingJudgment", () => {
  it("produces a fully valid AiTradingJudgment when fed into buildAiTradingJudgment", () => {
    const decision = decisionResult();
    const fields = deriveAiTradingJudgmentFieldsFromDecision({
      decision,
      ballotNarratives: {
        "agent-a": "Order flow net-buy.",
        "agent-b": "Volatility contraction favors continuation.",
        "agent-c": "Funding rate elevated, a headwind.",
      },
    });
    const evidenceBundle: EvidenceBundle = {
      context: {} as EvidenceBundle["context"],
      evidence: [
        { evidenceId: "ev-1" } as EvidenceBundle["evidence"][number],
        { evidenceId: "ev-2" } as EvidenceBundle["evidence"][number],
        { evidenceId: "ev-3" } as EvidenceBundle["evidence"][number],
      ],
      materializedEvidence: [],
      evidenceBundleHash: "hash",
      inputHash: "hash",
    };

    const judgment = buildAiTradingJudgment({
      judgmentId: "judgment-1",
      strategyId: "strategy-1",
      market: "BTC-USD",
      generatedAt: "2026-08-31T00:00:00.000Z",
      thesis: "Momentum agents outvote the carry dissent.",
      evidence: fields.evidence,
      counterEvidence: fields.counterEvidence,
      confidence: fields.confidence,
      uncertainty: fields.uncertainty,
      marketRegime: "TREND_UP",
      scenarios: [
        { id: "bull", label: "Bull", probability: 0.5, expectedReturn: 0.04, narrative: "Continuation." },
        { id: "bear", label: "Bear", probability: 0.5, expectedReturn: -0.03, narrative: "Reversion." },
      ],
      expectedReturn: 0.01,
      downside: -0.03,
      riskBudget: 0.1,
      timeHorizonMs: 60 * 60 * 1000,
      invalidationCondition: "Order flow reverses for two consecutive 15-minute bars.",
      decision,
      evidenceBundle,
    });

    assert.equal(validateAiTradingJudgment(judgment).valid, true);
    assert.equal(judgment.action, DecisionAction.LONG);
    assert.equal(judgment.confidence, 2 / 3);
  });
});
