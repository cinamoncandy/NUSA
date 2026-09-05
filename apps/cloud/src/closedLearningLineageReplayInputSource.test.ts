import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import { ClosedLearningLineageReplayInputSource, closedLearningPaperPeriodReference } from "./closedLearningLineageReplayInputSource";

const HASH = "a".repeat(64);
const VERSION = "b".repeat(64);
const ORIGINAL = "c".repeat(64);
const REPLAY = "d".repeat(64);
const BASE = 1_000;

function advisory(start: number): LeagueCapitalAllocationAdvisory {
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(start - 1).toISOString(),
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze(["NO_EXECUTION_AUTHORITY"]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze(["NO_EXECUTION_AUTHORITY"]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
  });
}

function period(index: number, grossReturn: number): PersistedPaperPeriodEnvelope {
  const start = BASE + index * 2_000;
  return Object.freeze({
    record: Object.freeze({
      recordId: `period-${index}`,
      periodIndex: index,
      market: "KRW-BTC",
      advisory: advisory(start),
      periodStartAt: start,
      periodEndAt: start + 1_000,
      realizedReturns: Object.freeze({ "candidate-a": grossReturn }),
      benchmarkReturn: 0.001,
      turnoverCostRate: 0.001,
      costEvidence: Object.freeze({ evidenceId: `cost-${index}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: HASH, observedAt: start + 1, feeRate: 0.0005, spreadRate: 0, slippageRate: 0.0005 }),
      status: "COMPLETED",
    }),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
  });
}

const binding = Object.freeze({
  schemaVersion: 1 as const,
  status: "BOUND_UNVERIFIED" as const,
  authority: "PAPER_RESEARCH_ONLY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  candidateId: "candidate-a",
  datasetId: "dataset-a",
  datasetContentSha256: HASH,
  advisoryGeneratedAt: 500,
  periodStartAt: BASE,
  advisoryFingerprintSha256: HASH,
  bindingFingerprintSha256: HASH,
});

const lineage = Object.freeze({
  schemaVersion: 1 as const,
  candidateId: "candidate-a",
  candidateVersion: VERSION,
  originalRunFingerprintSha256: ORIGINAL,
  replayRunFingerprintSha256: REPLAY,
  researchDecisionReference: `research-replay:${REPLAY}:candidate-a`,
  authority: "PAPER_RESEARCH_ONLY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

function account(): PaperAccountState {
  return Object.freeze({
    version: 1 as const,
    initialCapital: 10_000,
    cash: 10_000,
    equity: 10_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([
      { id: "o1", idempotencyKey: "k1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 0.05, status: "FILLED" as const, createdAt: 1_100, filledAt: 1_200 },
      { id: "o2", idempotencyKey: "k2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 110, fee: 0.055, status: "FILLED" as const, createdAt: 3_100, filledAt: 3_200 },
    ]),
    fills: Object.freeze([
      { id: "f1", orderId: "o1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 0.05, filledAt: 1_200, candidateProvenance: Object.freeze({ schemaVersion: 1 as const, source: "CIO_DECISION_BINDING" as const, decisionAt: 1_050, binding }) },
      { id: "f2", orderId: "o2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 110, fee: 0.055, filledAt: 3_200, candidateProvenance: Object.freeze({ schemaVersion: 1 as const, source: "CIO_DECISION_BINDING" as const, decisionAt: 3_050, binding }) },
    ]),
    processedIdempotencyKeys: Object.freeze(["k1", "k2"]),
    updatedAt: 6_000,
  });
}

const quality = Object.freeze({ acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 500, poorLatencyMs: 2_000 });
const identity = Object.freeze({
  cycleId: "cycle-1",
  evidenceId: "evidence-1",
  evidenceFingerprintSha256: HASH,
  championId: "champion",
  championVersion: "v1",
  sourceCommitSha: "e".repeat(40),
  costModelVersion: "cost-v1",
  riskConfigHash: HASH,
  evidenceReferences: Object.freeze([closedLearningPaperPeriodReference("period-0"), closedLearningPaperPeriodReference("period-1"), closedLearningPaperPeriodReference("period-2")]),
});

function source(overrides: { periods?: readonly PersistedPaperPeriodEnvelope[]; readAccount?: () => PaperAccountState | undefined; lineageAt?: (at: number) => typeof lineage | undefined } = {}) {
  const periods = overrides.periods ?? [period(0, 0.02), period(1, -0.01), period(2, 0.03)];
  return new ClosedLearningLineageReplayInputSource({
    periods: { listRealizedPeriods: () => periods } as never,
    bindings: {
      current: (_market: string, at: number) => {
        const researchLineage = (overrides.lineageAt ?? (() => lineage))(at);
        return researchLineage == null ? undefined : Object.freeze({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: Object.freeze({ ...binding, periodStartAt: at }), activatedAt: at, researchLineage, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
      },
    } as never,
    readCanonicalPaperAccount: overrides.readAccount ?? account,
    executionQualityPolicy: quality,
  });
}

describe("ClosedLearningLineageReplayInputSource", () => {
  it("resolves only the explicitly referenced immutable lineage into canonical Research replay evidence", () => {
    const resolved = source().resolve(identity);
    assert.equal(resolved.originalRunFingerprintSha256, ORIGINAL);
    assert.deepEqual(Object.keys(resolved.paperEvidenceByCandidate), ["candidate-a"]);
    const evidence = resolved.paperEvidenceByCandidate["candidate-a"] as { admission: { periodCount: number }; paperPerformance: { tradeCount: number } };
    assert.equal(evidence.admission.periodCount, 3);
    assert.equal(evidence.paperPerformance.tradeCount, 2);
  });

  it("fails closed when the cycle references a period that is not in authoritative storage", () => {
    assert.throws(() => source().resolve(Object.freeze({ ...identity, evidenceReferences: Object.freeze([closedLearningPaperPeriodReference("missing")]) })), /referenced PAPER period is unavailable/);
  });

  it("fails closed when explicitly referenced periods cross Research lineages", () => {
    const other = Object.freeze({ ...lineage, replayRunFingerprintSha256: "f".repeat(64), researchDecisionReference: `research-replay:${"f".repeat(64)}:candidate-a` });
    assert.throws(() => source({ lineageAt: (at) => at >= 3_000 ? other : lineage }).resolve(identity), /multiple Research lineages/);
  });

  it("does not fabricate replay evidence when canonical candidate performance is insufficient", () => {
    const empty = Object.freeze({ ...account(), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]) });
    assert.throws(() => source({ readAccount: () => empty }).resolve(identity), /performance is insufficient/);
  });

  it("requires explicit paper-period references so retries cannot silently widen the denominator", () => {
    assert.throws(() => source().resolve(Object.freeze({ ...identity, evidenceReferences: Object.freeze(["runtime:heartbeat"]) })), /period references are invalid/);
  });
});
