import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFamilyPortfolioRiskEvidence, type FamilyPortfolioMemberEvidence } from "./familyPortfolioRiskEvidence";

const policy = Object.freeze({
  maximumStrategyWeight: 0.45,
  maximumFamilyWeight: 0.65,
  maximumAbsoluteFamilyCorrelation: 0.8,
  maximumFamilyDrawdownOverlap: 0.8,
  maximumRegimeConcentration: 0.8,
  maximumFamilyRiskBudgetUsage: 0.7,
});

const member = (strategyId: string, familyId: string, overrides: Partial<FamilyPortfolioMemberEvidence> = {}): FamilyPortfolioMemberEvidence => ({
  strategyId, familyId, role: "CHAMPION", weight: 0.25, riskContribution: 0.2, turnover: 0.1,
  feeRate: 0.001, slippageRate: 0.001, grossExpectedEdge: 0.02, regime: familyId === "trend" ? "RISK_ON" : "RISK_OFF",
  returns: familyId === "trend" ? [0.01, -0.02, 0.03, 0.01] : [0.02, 0.01, -0.01, 0.03],
  drawdowns: familyId === "trend" ? [false, true, false, false] : [false, false, true, false],
  ...overrides,
});

describe("family portfolio risk evidence", () => {
  it("computes family exposure, concentration, dependence, drawdown overlap and risk budget", () => {
    const result = buildFamilyPortfolioRiskEvidence([member("s1", "trend"), member("s2", "mean")], policy);
    assert.equal(result.familyExposure.trend, 0.25);
    assert.equal(result.familyExposure.mean, 0.25);
    assert.equal(result.strategyConcentration, 0.5);
    assert.equal(result.familyConcentration, 0.5);
    assert.ok(result.maximumAbsoluteFamilyCorrelation != null);
    assert.equal(result.maximumFamilyDrawdownOverlap, 0);
    assert.equal(result.familyRiskBudgetUsage.trend, 0.2);
    assert.ok(result.netExpectedEdgeAfterCosts > 0);
  });

  it("fails closed on strategy and family concentration", () => {
    const result = buildFamilyPortfolioRiskEvidence([
      member("s1", "trend", { weight: 0.5 }),
      member("s2", "trend", { weight: 0.2 }),
      member("s3", "mean", { weight: 0.2 }),
    ], policy);
    assert.equal(result.status, "INSUFFICIENT");
    assert.ok(result.reasons.includes("STRATEGY_CONCENTRATION_EXCEEDED:s1"));
    assert.ok(result.reasons.includes("FAMILY_CONCENTRATION_EXCEEDED:trend"));
  });

  it("fails closed on regime concentration and family risk budget", () => {
    const result = buildFamilyPortfolioRiskEvidence([
      member("s1", "trend", { weight: 0.4, riskContribution: 0.4, regime: "RISK_ON" }),
      member("s2", "mean", { weight: 0.1, riskContribution: 0.4, regime: "RISK_ON" }),
    ], { ...policy, maximumRegimeConcentration: 0.9, maximumFamilyRiskBudgetUsage: 0.3 });
    assert.equal(result.status, "INSUFFICIENT");
    assert.ok(result.reasons.includes("REGIME_CONCENTRATION_EXCEEDED"));
    assert.ok(result.reasons.some((reason) => reason.startsWith("FAMILY_RISK_BUDGET_EXCEEDED:")));
  });

  it("charges turnover, fee and slippage before accepting edge", () => {
    const result = buildFamilyPortfolioRiskEvidence([
      member("s1", "trend", { turnover: 1, feeRate: 0.02, slippageRate: 0.02, grossExpectedEdge: 0.01 }),
      member("s2", "mean", { turnover: 1, feeRate: 0.02, slippageRate: 0.02, grossExpectedEdge: 0.01 }),
    ], policy);
    assert.equal(result.status, "INSUFFICIENT");
    assert.ok(result.reasons.includes("NON_POSITIVE_EDGE_AFTER_COSTS"));
  });

  it("missing cross-family evidence fails closed", () => {
    const result = buildFamilyPortfolioRiskEvidence([member("s1", "trend")], policy);
    assert.equal(result.status, "INSUFFICIENT");
    assert.ok(result.reasons.includes("CROSS_FAMILY_EVIDENCE_INSUFFICIENT"));
  });

  it("is deterministic under input permutation", () => {
    const a = member("s1", "trend");
    const b = member("s2", "mean");
    assert.deepEqual(buildFamilyPortfolioRiskEvidence([a, b], policy), buildFamilyPortfolioRiskEvidence([b, a], policy));
  });

  it("keeps Champion/Challenger impact advisory-only and ZERO_AUTHORITY", () => {
    const result = buildFamilyPortfolioRiskEvidence([
      member("s1", "trend"),
      member("s2", "mean", { role: "CHALLENGER", riskContribution: 0.15 }),
    ], policy);
    assert.equal(result.championChallengerImpact.mean, 0.15);
    assert.equal(result.mode, "PAPER_ONLY");
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["withdraw", "transfer", "liveactivation", "brokercredential"]) assert.equal(serialized.includes(forbidden), false);
  });

  it("rejects malformed or ambiguous evidence", () => {
    assert.throws(() => buildFamilyPortfolioRiskEvidence([member("s1", "")], policy), /identity is required/);
    assert.throws(() => buildFamilyPortfolioRiskEvidence([member("s1", "trend"), member("s1", "mean")], policy), /duplicate strategyId/);
    assert.throws(() => buildFamilyPortfolioRiskEvidence([member("s1", "trend", { returns: [0.1], drawdowns: [] })], policy), /length mismatch/);
  });
});
