import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperPerformanceSummary } from "../../../../packages/contracts/src/strategyGovernance";
import type { ResearchBenchmarkSliceScore } from "./researchBenchmarkScorecard";
import { admitPaperForwardEvidence, type PaperForwardPeriodEvidence } from "./paperForwardEvidenceAdmission";
import { gatePaperForwardLeagueEvidence, PaperForwardLeagueEvidenceError } from "./paperForwardLeagueEvidence";
import { evaluateLeague } from "./nusaLeague";

const HASH = "a".repeat(64);
const IDENTITY = Object.freeze({ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH });

const paperPerformance: PaperPerformanceSummary = Object.freeze({
  startedAt: 1_000,
  endedAt: 31_000,
  observationDays: 30,
  tradeCount: 30,
  netReturn: 0.08,
  sharpeRatio: 1.1,
  profitFactor: 1.2,
  maximumDrawdown: 0.05,
  availabilityRatio: 1,
  unresolvedFaultCount: 0,
  killSwitchActivationCount: 0,
  executionQualityScore: 0.9,
});

const period = (index: number, overrides: Partial<PaperForwardPeriodEvidence> = {}): PaperForwardPeriodEvidence => ({
  periodId: `period-${index}`,
  candidateId: IDENTITY.candidateId,
  datasetId: IDENTITY.datasetId,
  datasetContentSha256: IDENTITY.datasetContentSha256,
  advisoryGeneratedAt: index * 10_000,
  periodStartAt: index * 10_000 + 1_000,
  periodEndAt: index * 10_000 + 9_000,
  grossReturn: 0.01,
  turnover: 0.5,
  feeRate: 0.0005,
  spreadRate: 0.0005,
  slippageRate: 0.0005,
  status: "COMPLETED",
  ...overrides,
});

const benchmark: ResearchBenchmarkSliceScore = Object.freeze({
  id: IDENTITY.candidateId,
  datasetId: IDENTITY.datasetId,
  contentSha256: IDENTITY.datasetContentSha256,
  market: "KRW-BTC",
  interval: "1d",
  candleCount: 200,
  windowCount: 3,
  totalOosPoints: 60,
  totalOosClosedTrades: 10,
  totalReturn: 0.1,
  maximumDrawdown: 0.05,
  averageBenchmarkReturn: 0.02,
  averageOutperformance: 0.03,
  profitableWindowRatio: 0.67,
  benchmarkOutperformanceWindowRatio: 0.67,
  turnover: 2,
  totalTradingCost: 0.01,
  tradingCostBurden: 0.001,
  selectionChurnRatio: 0.2,
  returnToDrawdown: 2,
  eligible: true,
  reasons: Object.freeze([]),
  researchScore: 100,
  rank: 1,
});

describe("gatePaperForwardLeagueEvidence", () => {
  it("keeps 29 real longitudinal periods visible but unable to increase League evidence breadth", () => {
    const admission = admitPaperForwardEvidence(Array.from({ length: 29 }, (_, index) => period(index)));
    const decision = gatePaperForwardLeagueEvidence(IDENTITY, { admission, paperPerformance });
    assert.equal(decision.strength, "INSUFFICIENT");
    assert.equal(decision.paperPerformance, undefined);
    assert.ok(decision.reasons.includes("PAPER_FORWARD_EVIDENCE_INSUFFICIENT"));

    const standing = evaluateLeague([{ id: IDENTITY.candidateId, familyId: "family-a", benchmark, ...(decision.paperPerformance == null ? {} : { paperPerformance: decision.paperPerformance }) }]);
    assert.equal(standing.entries[0]!.evidenceBreadth, 0, "29 periods must not buy a PAPER evidence category");
  });

  it("allows 30 completed provenance-matched periods to populate PAPER evidence breadth", () => {
    const admission = admitPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => period(index)));
    const decision = gatePaperForwardLeagueEvidence(IDENTITY, { admission, paperPerformance });
    assert.equal(decision.strength, "VERIFIED");
    assert.equal(decision.paperPerformance?.netReturn, paperPerformance.netReturn);

    const standing = evaluateLeague([{ id: IDENTITY.candidateId, familyId: "family-a", benchmark, paperPerformance: decision.paperPerformance! }]);
    assert.equal(standing.entries[0]!.evidenceBreadth, 1 / 8);
  });

  it("fails closed on candidate, dataset, or content-hash mismatch", () => {
    const admission = admitPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => period(index)));
    for (const [expected, code] of [
      [{ ...IDENTITY, candidateId: "other" }, "CANDIDATE_IDENTITY_MISMATCH"],
      [{ ...IDENTITY, datasetId: "other" }, "DATASET_IDENTITY_MISMATCH"],
      [{ ...IDENTITY, datasetContentSha256: "b".repeat(64) }, "DATASET_CONTENT_MISMATCH"],
    ] as const) {
      assert.throws(
        () => gatePaperForwardLeagueEvidence(expected, { admission, paperPerformance }),
        (error) => error instanceof PaperForwardLeagueEvidenceError && error.code === code,
      );
    }
  });

  it("does not emit execution or LIVE authority fields", () => {
    const admission = admitPaperForwardEvidence(Array.from({ length: 30 }, (_, index) => period(index)));
    const serialized = JSON.stringify(gatePaperForwardLeagueEvidence(IDENTITY, { admission, paperPerformance })).toLowerCase();
    for (const forbidden of ["liveauthority", "productionmutationallowed", "broker", "withdraw", "transfer", "credential", "capitalamount"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
