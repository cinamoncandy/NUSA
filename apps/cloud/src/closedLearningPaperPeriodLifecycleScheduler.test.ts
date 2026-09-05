import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PersistedPaperPendingPeriod } from "../../../packages/storage/src/persistedPaperPeriodStore";
import type { PaperChallengerActivationReceipt } from "./paperChallengerBindingLedger";
import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import {
  ClosedLearningPaperPeriodLifecycleScheduler,
  type ClosedLearningPaperPeriodLifecyclePort,
} from "./closedLearningPaperPeriodLifecycleScheduler";
import type { QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";
import type { PaperResearchLineage } from "./paperResearchLineage";
import { PaperRealizedPeriodProducerError } from "./paperRealizedPeriodProducer";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const SOURCE = "1".repeat(40);
const CANDIDATE = "challenger-a";
const VERSION = "candidate-v1";
const MARKET = "KRW-BTC";
const DATASET = "dataset-a";
const WINDOW_MS = 60_000;
const START_AT = 10_000;
const END_AT = START_AT + WINDOW_MS;

function lineage(): PaperResearchLineage {
  return Object.freeze({
    schemaVersion: 1,
    candidateId: CANDIDATE,
    candidateVersion: VERSION,
    originalRunFingerprintSha256: HASH_A,
    replayRunFingerprintSha256: HASH_B,
    researchDecisionReference: "research:decision-a",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function advisory() {
  return Object.freeze({
    schemaVersion: 1 as const,
    generatedAt: new Date(1_000).toISOString(),
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([{ id: CANDIDATE, familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze([]), sourceDatasetIds: Object.freeze([DATASET]) }]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze([]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze([DATASET]) }),
  });
}

function activation(): PaperChallengerActivationReceipt {
  return Object.freeze({
    schemaVersion: 1,
    status: "ACTIVE",
    market: MARKET,
    binding: Object.freeze({
      schemaVersion: 1,
      status: "BOUND_UNVERIFIED",
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      candidateId: CANDIDATE,
      datasetId: DATASET,
      datasetContentSha256: HASH_C,
      advisoryGeneratedAt: 1_000,
      periodStartAt: START_AT,
      advisoryFingerprintSha256: HASH_D,
      bindingFingerprintSha256: HASH_A,
    }),
    activatedAt: START_AT,
    researchLineage: lineage(),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function artifact(): QualifiedPaperChallengerArtifact {
  return Object.freeze({
    schemaVersion: 1,
    candidateId: CANDIDATE,
    candidateVersion: VERSION,
    market: MARKET,
    advisory: advisory(),
    candidateProvenance: Object.freeze([{ candidateId: CANDIDATE, datasetId: DATASET, datasetContentSha256: HASH_C }]),
    researchDecisionReference: "research:decision-a",
    researchLineage: lineage(),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function realized(index = 0, startAt = START_AT, endAt = END_AT): PersistedPaperPeriodEnvelope {
  return Object.freeze({
    record: Object.freeze({
      recordId: `paper-period-${index}`,
      periodIndex: index,
      market: MARKET,
      advisory: advisory(),
      periodStartAt: startAt,
      periodEndAt: endAt,
      realizedReturns: Object.freeze({ [CANDIDATE]: 0.01 }),
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: Object.freeze({ evidenceId: `paper-cost-${index}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "OBSERVED", evidenceFingerprintSha256: HASH_D, observedAt: endAt, feeRate: 0.0005, spreadRate: 0.0002, slippageRate: 0.0003 }),
      status: "COMPLETED",
    }),
    candidateProvenance: Object.freeze([{ candidateId: CANDIDATE, datasetId: DATASET, datasetContentSha256: HASH_C }]),
  });
}

function pending(id = "paper-pending-0", index = 0, startAt = START_AT): PersistedPaperPendingPeriod {
  return Object.freeze({ periodId: id, periodIndex: index, periodStartAt: startAt, payloadJson: "{}", checksum: HASH_D });
}

function account(updatedAt = END_AT): PaperAccountState {
  return Object.freeze({
    version: 1,
    initialCapital: 1_000_000,
    cash: 1_000_000,
    equity: 1_000_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt,
  });
}

function cycleResult(input: ClosedLearningEvidenceIdentity, outcome: "INSUFFICIENT" | "REJECTED" = "INSUFFICIENT"): ClosedLearningCycleResult {
  return Object.freeze({
    status: "EXECUTED",
    record: Object.freeze({
      cycleId: `closed-learning:${HASH_A}`,
      evidenceId: input.evidenceId,
      evidenceFingerprintSha256: input.evidenceFingerprintSha256,
      decision: Object.freeze({ decisionId: "decision-1", outcome, decisionReference: "research:decision-1", reasons: Object.freeze([]) }),
      recordedAt: END_AT,
    }),
  });
}

function schedulerFixture(input: {
  open?: PersistedPaperPendingPeriod[];
  realized?: PersistedPaperPeriodEnvelope[];
  closeError?: Error;
  coordinator?: (identity: ClosedLearningEvidenceIdentity) => ClosedLearningCycleResult;
  accountAt?: number;
}) {
  let open = [...(input.open ?? [])];
  let periods = [...(input.realized ?? [])];
  const calls: string[] = [];
  const identities: ClosedLearningEvidenceIdentity[] = [];
  const errors: Error[] = [];
  const port: ClosedLearningPaperPeriodLifecyclePort = {
    listOpenPeriods: () => Object.freeze([...open]),
    listRealizedPeriods: () => Object.freeze([...periods]),
    closePeriodFromCanonicalAccount: ({ periodId, periodEndAt }) => {
      calls.push(`close:${periodId}`);
      if (input.closeError != null) throw input.closeError;
      const next = realized(periods.length, START_AT, periodEndAt);
      periods = [...periods, next];
      open = [];
      return next;
    },
    openPeriodFromCanonicalAccount: (next) => {
      calls.push(`open:${next.periodId}`);
      open = [pending(next.periodId, next.periodIndex, next.periodStartAt)];
      return Object.freeze({ ...next, schemaVersion: 1, observationIds: Object.freeze([]), observations: Object.freeze([]) });
    },
  };
  const active = activation();
  const scheduler = new ClosedLearningPaperPeriodLifecycleScheduler({
    periods: port,
    bindings: { current: () => active },
    artifacts: { read: () => artifact() },
    coordinator: {
      run: (identity) => {
        calls.push("research");
        identities.push(identity);
        return input.coordinator?.(identity) ?? cycleResult(identity);
      },
    },
    readCanonicalPaperAccount: () => account(input.accountAt ?? END_AT),
    sourceCommitSha: SOURCE,
    costModelVersion: "paper-canonical-outcome-cost-v1",
    riskConfigHash: HASH_D,
    periodWindowMs: WINDOW_MS,
    intervalMs: 1_000,
    onError: (error) => errors.push(error),
  });
  return { scheduler, calls, identities, errors, open: () => open, realized: () => periods };
}

describe("ClosedLearningPaperPeriodLifecycleScheduler", () => {
  it("waits until the canonical account boundary reaches the configured window", () => {
    const fixture = schedulerFixture({ open: [pending()], accountAt: END_AT - 1 });
    const result = fixture.scheduler.runOnce();
    assert.equal(result?.status, "WAITING_FOR_WINDOW");
    assert.deepEqual(fixture.calls, []);
  });

  it("keeps the period open when canonical fill attribution or benchmark evidence is not ready", () => {
    const fixture = schedulerFixture({
      open: [pending()],
      closeError: new PaperRealizedPeriodProducerError("CANDIDATE_ATTRIBUTION_UNAVAILABLE", "not enough canonical evidence", "paper-pending-0"),
    });
    const result = fixture.scheduler.runOnce();
    assert.equal(result?.status, "WAITING_FOR_EVIDENCE");
    assert.deepEqual(fixture.calls, ["close:paper-pending-0"]);
    assert.equal(fixture.open().length, 1);
  });

  it("closes, replays the exact lineage cohort and rolls the same challenger forward when Research remains insufficient", () => {
    const earlier = realized(0, 1_000, 5_000);
    const fixture = schedulerFixture({ open: [pending("paper-pending-1", 1)], realized: [earlier] });
    const result = fixture.scheduler.runOnce();
    assert.equal(result?.status, "CYCLED");
    assert.equal(result?.closedPeriodId, "paper-period-1");
    assert.match(result?.rolloverPeriodId ?? "", /^paper-rollover:/);
    assert.deepEqual(fixture.calls.map((item) => item.split(":")[0]), ["close", "research", "open"]);
    assert.deepEqual(fixture.identities[0]?.evidenceReferences, ["paper-period:paper-period-0", "paper-period:paper-period-1"]);
    assert.equal(fixture.open().length, 1);
  });

  it("reopens the active challenger before surfacing a Research failure so a crash/retry cannot stall evidence collection", () => {
    const fixture = schedulerFixture({
      open: [pending()],
      coordinator: () => { throw new Error("worker unavailable"); },
    });
    const result = fixture.scheduler.runOnce();
    assert.equal(result, undefined);
    assert.deepEqual(fixture.calls.map((item) => item.split(":")[0]), ["close", "research", "open"]);
    assert.equal(fixture.open().length, 1);
    assert.match(fixture.errors[0]?.message ?? "", /worker unavailable/);
  });

  it("does not open a duplicate rollover when a qualified coordinator deployment already opened the replacement period", () => {
    const fixture = schedulerFixture({
      open: [pending()],
      coordinator: (identity) => {
        fixture.open().splice(0, fixture.open().length, pending("qualified-replacement", 1, END_AT));
        return cycleResult(identity);
      },
    });
    const result = fixture.scheduler.runOnce();
    assert.equal(result?.status, "CYCLED");
    assert.equal(result?.rolloverPeriodId, undefined);
    assert.deepEqual(fixture.calls.map((item) => item.split(":")[0]), ["close", "research"]);
    assert.equal(fixture.open()[0]?.periodId, "qualified-replacement");
  });

  it("replays the latest realized identity after restart and restores an empty active period window", () => {
    const fixture = schedulerFixture({ open: [], realized: [realized()] });
    const result = fixture.scheduler.runOnce();
    assert.equal(result?.status, "CYCLED");
    assert.deepEqual(fixture.calls.map((item) => item.split(":")[0]), ["research", "open"]);
    assert.equal(fixture.identities[0]?.evidenceReferences[0], "paper-period:paper-period-0");
    assert.equal(fixture.open().length, 1);
  });
});
