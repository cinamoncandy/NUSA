import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaperExecutionRiskContract,
  buildPaperExecutionRiskContractFromCandidate,
  validatePaperExecutionRiskContract,
} from "./paperExecutionRiskContract";

describe("paper execution risk contract", () => {
  it("sizes a PAPER position from risk capital and volatility-adjusted stop distance", () => {
    const contract = buildPaperExecutionRiskContract({
      entryPrice: 100,
      accountEquity: 10_000,
      allocationCapital: 2_000,
      winProbability: 0.6,
      averageWinReturn: 0.04,
      averageLossReturn: 0.02,
      riskPerTradeFraction: 0.01,
      stopLossFraction: 0.02,
      atrFraction: 0.015,
      atrMultiplier: 2,
      minimumRewardRisk: 1.5,
      ruinDrawdownFraction: 0.5,
      ruinHorizonTrades: 200,
      maximumRuinProbability: 0.05,
    });
    assert.equal(contract.expectedValueReturn, 0.016);
    assert.equal(contract.rewardRiskRatio, 2);
    assert.equal(contract.maximumLossCapital, 100);
    assert.equal(contract.effectiveStopFraction, 0.03);
    assert.equal(contract.stopDistance, 3);
    assert.equal(contract.allowedQuantity, 20);
    assert.equal(contract.decision, "ALLOW");
    assert.equal(contract.liveAuthority, "NONE");
    assert.equal(contract.aiAuthority, "ZERO_AUTHORITY");
    validatePaperExecutionRiskContract(contract);
  });

  it("abstains on non-positive expectancy instead of widening execution", () => {
    const contract = buildPaperExecutionRiskContract({
      entryPrice: 100,
      accountEquity: 10_000,
      allocationCapital: 2_000,
      winProbability: 0.4,
      averageWinReturn: 0.02,
      averageLossReturn: 0.02,
      riskPerTradeFraction: 0.01,
      stopLossFraction: 0.02,
      atrFraction: 0.01,
      atrMultiplier: 1,
      minimumRewardRisk: 1,
      ruinDrawdownFraction: 0.5,
      ruinHorizonTrades: 100,
      maximumRuinProbability: 1,
    });
    assert.equal(contract.decision, "ABSTAIN");
    assert.deepEqual(contract.reasons, ["NON_POSITIVE_EXPECTANCY"]);
  });

  it("fails closed when a candidate partially declares risk-math parameters", () => {
    const strategy = {
      candidateId: "candidate-1",
      familyId: "family-1",
      lineageId: "lineage-1",
      specificationHash: "a".repeat(64),
      codeSha: "b".repeat(40),
      costModelVersion: "cost-v1",
      parameters: { riskWinProbability: 0.6 },
    };
    assert.throws(
      () => buildPaperExecutionRiskContractFromCandidate(strategy, { entryPrice: 100, accountEquity: 10_000, allocationCapital: 1_000 }),
      /PAPER_EXECUTION_RISK_CANDIDATE_PARAMETERS_INCOMPLETE/,
    );
  });

  it("keeps legacy candidates compatible when no risk-math contract is declared", () => {
    const strategy = {
      candidateId: "candidate-1",
      familyId: "family-1",
      lineageId: "lineage-1",
      specificationHash: "a".repeat(64),
      codeSha: "b".repeat(40),
      costModelVersion: "cost-v1",
      parameters: { lookback: 20 },
    };
    assert.equal(buildPaperExecutionRiskContractFromCandidate(strategy, { entryPrice: 100, accountEquity: 10_000, allocationCapital: 1_000 }), null);
  });
});
