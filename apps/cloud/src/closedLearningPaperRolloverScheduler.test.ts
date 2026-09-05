import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import { ClosedLearningPaperRolloverScheduler } from "./closedLearningPaperRolloverScheduler";

const HASH = "a".repeat(64);
const account: PaperAccountState = Object.freeze({
  version: 1,
  initialCapital: 1_000,
  cash: 1_010,
  equity: 1_010,
  realizedPnL: 10,
  unrealizedPnL: 0,
  positions: Object.freeze([]),
  orders: Object.freeze([]),
  fills: Object.freeze([]),
  processedIdempotencyKeys: Object.freeze([]),
  updatedAt: 86_400_000,
});
const advisory = Object.freeze({ generatedAt: new Date(0).toISOString() }) as unknown as LeagueCapitalAllocationAdvisory;
const realized: PersistedPaperPeriodEnvelope = Object.freeze({
  record: Object.freeze({
    recordId: "period-0",
    periodIndex: 0,
    market: "KRW-BTC",
    advisory,
    periodStartAt: 0,
    periodEndAt: 86_400_000,
    realizedReturns: Object.freeze({ candidate: 0.01 }),
    benchmarkReturn: 0,
    turnoverCostRate: 0,
    costEvidence: Object.freeze({ evidenceId: "e", source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "OBSERVED", evidenceFingerprintSha256: HASH, observedAt: 86_400_000, feeRate: 0, spreadRate: 0, slippageRate: 0 }),
    status: "COMPLETED",
  }),
  candidateProvenance: Object.freeze([{ candidateId: "candidate", datasetId: "dataset", datasetContentSha256: HASH }]),
});

function pendingPayload(): string {
  return JSON.stringify({ schemaVersion: 1, periodId: "period-0", periodIndex: 0, market: "KRW-BTC", periodStartAt: 0, advisory, candidateProvenance: realized.candidateProvenance });
}

test("closes an elapsed canonical period, runs closed learning, and continues evidence when no replacement opens", () => {
  let pending = [{ periodId: "period-0", periodIndex: 0, periodStartAt: 0, payloadJson: pendingPayload() }];
  let cycleRuns = 0;
  const opens: string[] = [];
  const scheduler = new ClosedLearningPaperRolloverScheduler({
    listPendingPeriods: () => pending,
    listRealizedPeriods: () => [realized],
    closePeriodFromCanonicalAccount: (input) => {
      assert.deepEqual(input, { periodId: "period-0", periodEndAt: account.updatedAt });
      pending = [];
      return realized;
    },
    openPeriodFromCanonicalAccount: (input) => {
      opens.push(input.periodId);
      pending = [{ periodId: input.periodId, periodIndex: input.periodIndex, periodStartAt: input.periodStartAt, payloadJson: JSON.stringify({ ...input, schemaVersion: 1 }) }];
      return Object.freeze({ ...input, schemaVersion: 1, observationIds: Object.freeze([]), observations: Object.freeze([]), accountBoundary: Object.freeze({ initialCapital: 1_000, equity: 1_010, capturedAt: input.periodStartAt }) });
    },
    readCanonicalPaperAccount: () => account,
    bindings: { current: () => Object.freeze({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: Object.freeze({ candidateId: "candidate", candidateVersion: "v1", datasetId: "dataset", datasetContentSha256: HASH, bindingFingerprintSha256: HASH, periodStartAt: 0 }), activatedAt: 0, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }) as never },
    cycle: { runOnce: () => { cycleRuns += 1; return undefined; } },
  });
  assert.equal(scheduler.runOnce()?.record.recordId, "period-0");
  assert.equal(cycleRuns, 1);
  assert.deepEqual(opens, [`paper-rollover:${HASH}:1`]);
});

test("restart recovery runs the replay-safe cycle before reopening continuation evidence", () => {
  let pending: Array<{ periodId: string; periodIndex: number; periodStartAt: number; payloadJson: string }> = [];
  const order: string[] = [];
  const scheduler = new ClosedLearningPaperRolloverScheduler({
    listPendingPeriods: () => pending,
    listRealizedPeriods: () => [realized],
    closePeriodFromCanonicalAccount: () => { throw new Error("unexpected close"); },
    openPeriodFromCanonicalAccount: (input) => {
      order.push("open");
      pending = [{ periodId: input.periodId, periodIndex: input.periodIndex, periodStartAt: input.periodStartAt, payloadJson: JSON.stringify({ ...input, schemaVersion: 1 }) }];
      return Object.freeze({ ...input, schemaVersion: 1, observationIds: Object.freeze([]), observations: Object.freeze([]) });
    },
    readCanonicalPaperAccount: () => account,
    bindings: { current: () => Object.freeze({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: Object.freeze({ candidateId: "candidate", candidateVersion: "v1", datasetId: "dataset", datasetContentSha256: HASH, bindingFingerprintSha256: HASH, periodStartAt: 0 }), activatedAt: 0, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }) as never },
    cycle: { runOnce: () => { order.push("cycle"); return undefined; } },
  });
  scheduler.runOnce();
  assert.deepEqual(order, ["cycle", "open"]);
});

test("does not close before the evidence window elapses", () => {
  let closed = false;
  const early = Object.freeze({ ...account, updatedAt: 60_000 });
  const scheduler = new ClosedLearningPaperRolloverScheduler({
    listPendingPeriods: () => [{ periodId: "period-0", periodIndex: 0, periodStartAt: 0, payloadJson: pendingPayload() }],
    listRealizedPeriods: () => [],
    closePeriodFromCanonicalAccount: () => { closed = true; return realized; },
    openPeriodFromCanonicalAccount: () => { throw new Error("unexpected open"); },
    readCanonicalPaperAccount: () => early,
    bindings: { current: () => undefined },
    cycle: { runOnce: () => undefined },
  });
  assert.equal(scheduler.runOnce(), undefined);
  assert.equal(closed, false);
});
