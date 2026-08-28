import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperAccountPosition, PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";
import type { PaperExecutionCostAttribution } from "./paperCanonicalOutcomeReconciliation";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import {
  PaperRealizedPeriodProducer,
  PaperRealizedPeriodProducerError,
  SqlitePaperRealizedPeriodRepository,
  type PaperRealizedPeriodOpenInput,
  type PaperRealizedPeriodProducerOptions,
} from "./paperRealizedPeriodProducer";

const BASE = 1_800_000_000_000;
const END = BASE + 900;
const HASH = "a".repeat(64);

function advisory(generatedAt: number) {
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date(generatedAt).toISOString(),
    policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 },
    entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }],
    excludedCandidateIds: [],
    reasons: ["NO_EXECUTION_AUTHORITY"],
    provenance: { sourceDatasetIds: ["dataset-a"] },
  };
}

function openInput(): PaperRealizedPeriodOpenInput {
  return {
    periodId: "canonical-period",
    periodIndex: 0,
    advisory: advisory(BASE - 100),
    candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }],
    periodStartAt: BASE,
  };
}

function candidateFill(): PaperFillRecord & { readonly executionCostAttribution: PaperExecutionCostAttribution } {
  return {
    id: "fill-canonical",
    orderId: "order-canonical",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 1,
    price: 100,
    fee: 0.05,
    filledAt: BASE + 100,
    candidateProvenance: {
      schemaVersion: 1,
      source: "CIO_DECISION_BINDING",
      decisionAt: BASE + 10,
      binding: {
        schemaVersion: 1,
        status: "BOUND_UNVERIFIED",
        authority: "PAPER_RESEARCH_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        candidateId: "candidate-a",
        datasetId: "dataset-a",
        datasetContentSha256: HASH,
        advisoryGeneratedAt: BASE - 100,
        periodStartAt: BASE,
        advisoryFingerprintSha256: HASH,
        bindingFingerprintSha256: HASH,
      },
    },
    executionCostAttribution: {
      schemaVersion: 1,
      source: "PAPER_EXECUTION_BOUNDARY",
      evidenceKind: "OBSERVED",
      evidenceId: "cost-canonical",
      evidenceFingerprintSha256: HASH,
      candidateId: "candidate-a",
      quotePrice: 100,
      fillPrice: 100,
      feeAmount: 0.05,
      spreadAmount: 0,
      slippageAmount: 0,
    },
  };
}

function account(updatedAt: number, equity: number, fills: readonly PaperFillRecord[] = []): PaperAccountState {
  const position: PaperAccountPosition = {
    market: "KRW-BTC",
    quantity: 1,
    averageEntryPrice: 100.05,
    realizedPnL: 0,
    unrealizedPnL: 9.95,
    markPrice: 110,
  };
  return Object.freeze({
    version: 1,
    initialCapital: 1_000,
    cash: fills.length === 0 ? equity : 899.95,
    equity,
    realizedPnL: 0,
    unrealizedPnL: fills.length === 0 ? 0 : 9.95,
    positions: Object.freeze(fills.length === 0 ? [] : [position]),
    orders: Object.freeze([]),
    fills: Object.freeze([...fills]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt,
  });
}

function state(options?: PaperRealizedPeriodProducerOptions) {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqlitePaperRealizedPeriodRepository(db);
  return { db, repository, producer: new PaperRealizedPeriodProducer(repository, options) };
}

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof PaperRealizedPeriodProducerError) return error.code;
    throw error;
  }
  throw new Error("expected PaperRealizedPeriodProducerError");
}

describe("canonical PAPER realized-period producer", () => {
  it("derives returns and costs from the canonical account outcome and replays idempotently", () => {
    let current = account(BASE, 1_000);
    const options: PaperRealizedPeriodProducerOptions = {
      readCanonicalPaperAccount: () => current,
      readCanonicalBenchmarkEvidence: (_start, periodEndAt) => ({ evidenceId: "benchmark-canonical", observedAt: periodEndAt, benchmarkReturn: 0.01 }),
    };
    const first = state(options);
    try {
      const plan = first.producer.openPeriodFromCanonicalAccount(openInput());
      assert.deepEqual(plan.accountBoundary, { initialCapital: 1_000, equity: 1_000, capturedAt: BASE });
      first.producer.observeExecution({ observationId: "canonical-observation", observedAt: BASE + 50, status: "FILLED" });
      current = account(END, 1_009.95, [candidateFill()]);
      const realized = first.producer.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: END });
      assert.ok(Math.abs(realized.record.realizedReturns["candidate-a"]! - 0.00995) < 1e-12);
      assert.equal(realized.record.turnoverCostRate, 0.0005);
      assert.equal(realized.record.benchmarkEvidenceId, "benchmark-canonical");
      assert.match(realized.record.canonicalOutcomeReceiptFingerprint ?? "", /^[a-f0-9]{64}$/);

      const restarted = new PaperRealizedPeriodProducer(new SqlitePaperRealizedPeriodRepository(first.db), options);
      assert.deepEqual(restarted.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: END }), realized);
    } finally {
      first.db.close();
    }
  });

  it("does not finalize when canonical fill cost evidence is incomplete", () => {
    let current = account(BASE, 1_000);
    const first = state({ readCanonicalPaperAccount: () => current });
    try {
      const plan = first.producer.openPeriodFromCanonicalAccount(openInput());
      first.producer.observeExecution({ observationId: "incomplete-observation", observedAt: BASE + 50, status: "FILLED" });
      const attributed = candidateFill();
      const { executionCostAttribution: _omitted, ...withoutAttribution } = attributed;
      current = account(END, 1_009.95, [{ ...withoutAttribution, runtimeExecutionCostEvidence: { schemaVersion: 1, source: "PAPER_EXECUTION_BOUNDARY", evidenceKind: "OBSERVED", completeness: "INCOMPLETE", evidenceId: "runtime-cost", evidenceFingerprintSha256: HASH, candidateId: "candidate-a", quotePrice: 100, fillPrice: 100, feeAmount: 0.05, spreadAmount: null, slippageAmount: null } }]);
      assert.equal(errorCode(() => first.producer.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: END })), "INCOMPLETE_EXECUTION_COST_EVIDENCE");
      assert.equal(first.producer.listRealizedPeriods().length, 0);
      assert.equal(first.producer.listOpenPeriods().length, 1);
    } finally {
      first.db.close();
    }
  });

  it("does not finalize when canonical benchmark evidence is unavailable", () => {
    let current = account(BASE, 1_000);
    const first = state({ readCanonicalPaperAccount: () => current });
    try {
      const plan = first.producer.openPeriodFromCanonicalAccount(openInput());
      first.producer.observeExecution({ observationId: "benchmark-missing-observation", observedAt: BASE + 50, status: "FILLED" });
      current = account(END, 1_009.95, [candidateFill()]);
      assert.equal(errorCode(() => first.producer.closePeriodFromCanonicalAccount({ periodId: plan.periodId, periodEndAt: END })), "MISSING_BENCHMARK_EVIDENCE");
      assert.equal(first.producer.listRealizedPeriods().length, 0);
      assert.equal(first.producer.listOpenPeriods().length, 1);
    } finally {
      first.db.close();
    }
  });

  it("fails closed when the canonical account boundary is unavailable or stale", () => {
    const unavailable = state();
    try {
      assert.equal(errorCode(() => unavailable.producer.openPeriodFromCanonicalAccount(openInput())), "CANONICAL_ACCOUNT_UNAVAILABLE");
    } finally {
      unavailable.db.close();
    }

    const stale = state({ readCanonicalPaperAccount: () => account(BASE - 1, 1_000) });
    try {
      assert.equal(errorCode(() => stale.producer.openPeriodFromCanonicalAccount(openInput())), "STALE_ACCOUNT_SNAPSHOT");
    } finally {
      stale.db.close();
    }
  });
});
