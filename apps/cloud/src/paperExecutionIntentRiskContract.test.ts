import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperExecutionIntent, validatePaperExecutionIntent } from "./paperExecutionIntent";
import type { CioDecision } from "./cioDecisionEngine";
import type { PortfolioPlan } from "./portfolioOrchestrator";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const hash = "a".repeat(64);

describe("paper execution intent risk contract integration", () => {
  it("can only reduce a PortfolioPlan BUY quantity when a candidate declares canonical risk math", () => {
    const decidedAt = 100;
    const decision: CioDecision = {
      symbol: "KRW-BTC",
      action: "BUY",
      confidence: 0.8,
      risk: "LOW",
      allocation: 0.5,
      leverage: 1,
      score: 0.6,
      reasons: ["candidate"],
      decidedAt,
      paperCandidateBinding: {
        schemaVersion: 1,
        status: "BOUND_UNVERIFIED",
        authority: "PAPER_RESEARCH_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        candidateId: "candidate-1",
        datasetId: "dataset-1",
        datasetContentSha256: hash,
        advisoryGeneratedAt: 1,
        periodStartAt: 50,
        advisoryFingerprintSha256: hash,
        bindingFingerprintSha256: hash,
        candidateStrategy: {
          candidateId: "candidate-1",
          familyId: "family-1",
          lineageId: "lineage-1",
          specificationHash: hash,
          codeSha: "b".repeat(40),
          costModelVersion: "cost-v1",
          parameters: {
            riskWinProbability: 0.6,
            riskAverageWinReturn: 0.04,
            riskAverageLossReturn: 0.02,
            riskPerTradeFraction: 0.01,
            riskStopLossFraction: 0.02,
            riskAtrFraction: 0.015,
            riskAtrMultiplier: 2,
            riskMinimumRewardRisk: 1.5,
            riskRuinDrawdownFraction: 0.5,
            riskRuinHorizonTrades: 200,
            riskMaximumRuinProbability: 0.05,
          },
        },
      },
    };
    const portfolio: PortfolioPlan = {
      allocations: [{
        symbol: "KRW-BTC",
        instrument: "SPOT",
        action: "BUY",
        capital: 5_000,
        share: 0.5,
        leverage: 1,
        confidence: 0.8,
        risk: "LOW",
      }],
      deployedCapital: 5_000,
      cashCapital: 5_000,
      reservedCapital: 0,
      grossShare: 0.5,
      futuresShare: 0,
      decidedAt,
    };
    const state: PaperAccountState = {
      version: 1,
      initialCapital: 10_000,
      cash: 10_000,
      equity: 10_000,
      realizedPnL: 0,
      unrealizedPnL: 0,
      positions: [],
      orders: [],
      fills: [],
      processedIdempotencyKeys: [],
      workingOrders: [],
      updatedAt: decidedAt,
    };

    const intent = buildPaperExecutionIntent({
      now: decidedAt,
      market: "KRW-BTC",
      referencePrice: 100,
      portfolio,
      decision,
      state,
      investmentPercent: 100,
    });

    assert.equal(intent.allocationCapital, 5_050);
    assert.equal(intent.riskContract?.decision, "ALLOW");
    assert.equal(intent.riskContract?.allocationLimitedQuantity, 50.5);
    assert.equal(intent.riskContract?.riskSizedQuantity, 33.33333333);
    assert.equal(intent.quantity, 33.33333333);
    assert.ok(intent.quantity <= (intent.riskContract?.allowedQuantity ?? 0));
    validatePaperExecutionIntent(intent);
  });
});
