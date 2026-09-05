import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { ClosedLearningRolloverScheduler, type ClosedLearningRolloverPort } from "./closedLearningRolloverScheduler";

const START = Date.parse("2026-09-04T14:59:00.000Z");
const SAME_KST_DAY = Date.parse("2026-09-04T14:59:30.000Z");
const NEXT_KST_DAY = Date.parse("2026-09-04T15:01:00.000Z");
const HASH = "a".repeat(64);

function advisory() {
  return Object.freeze({
    schemaVersion: 1 as const,
    generatedAt: new Date(START - 60_000).toISOString(),
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze([]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze([]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
  });
}

function plan(status: "FILLED" | "WAIT" = "FILLED", id = "period-0"): PersistedPaperRealizedPeriodPlan {
  return Object.freeze({
    schemaVersion: 1,
    periodId: id,
    periodIndex: 0,
    advisory: advisory(),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
    market: "KRW-BTC",
    periodStartAt: START,
    observationIds: Object.freeze([`obs-${status}`]),
    observations: Object.freeze([{ observationId: `obs-${status}`, observedAt: START + 1, status }]),
    lastObservedAt: START + 1,
    accountBoundary: Object.freeze({ initialCapital: 1_000_000, equity: 1_000_000, capturedAt: START }),
  });
}

function account(updatedAt: number): PaperAccountState {
  return Object.freeze({ version: 1, initialCapital: 1_000_000, cash: 1_000_000, equity: 1_000_000, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt });
}

function envelope(recordId = "record-0", periodIndex = 0): PersistedPaperPeriodEnvelope {
  return Object.freeze({
    record: Object.freeze({ recordId, periodIndex, market: "KRW-BTC", advisory: advisory(), periodStartAt: START, periodEndAt: NEXT_KST_DAY, realizedReturns: Object.freeze({ "candidate-a": 0.01 }), benchmarkReturn: 0.005, turnoverCostRate: 0.001, costEvidence: Object.freeze({ evidenceId: `cost-${periodIndex}`, source: "PAPER_EXECUTION_RECEIPT" as const, evidenceKind: "OBSERVED" as const, evidenceFingerprintSha256: HASH, observedAt: NEXT_KST_DAY, feeRate: 0.0005, spreadRate: 0.0002, slippageRate: 0.0003 }), status: "COMPLETED" as const }),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
  });
}

function identity(): ClosedLearningEvidenceIdentity {
  return Object.freeze({ evidenceId: "evidence-0", evidenceFingerprintSha256: HASH, championId: "candidate-a", championVersion: "v1", sourceCommitSha: "b".repeat(40), costModelVersion: "paper-cost-v1", riskConfigHash: "c".repeat(64), evidenceReferences: Object.freeze(["paper-period:record-0"]) });
}

function cycle(outcome: "INSUFFICIENT" | "REJECTED" | "QUALIFIED_FOR_LEAGUE"): ClosedLearningCycleResult {
  const qualified = outcome === "QUALIFIED_FOR_LEAGUE";
  return Object.freeze({ status: "EXECUTED", record: Object.freeze({ cycleId: "closed-learning:cycle", evidenceId: "evidence-0", evidenceFingerprintSha256: HASH, decision: Object.freeze({ decisionId: "decision-0", outcome, ...(qualified ? { candidateId: "candidate-b", candidateVersion: "v2" } : {}), decisionReference: "research:decision-0", reasons: Object.freeze([]) }), ...(qualified ? { paperDeployment: Object.freeze({ deploymentId: "deployment-0", candidateId: "candidate-b", candidateVersion: "v2", authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const }) } : {}), recordedAt: NEXT_KST_DAY }) });
}

function harness(options: { now: number; observation?: "FILLED" | "WAIT"; outcome?: "INSUFFICIENT" | "REJECTED" | "QUALIFIED_FOR_LEAGUE"; closeError?: Error; openPeriods?: readonly PersistedPaperRealizedPeriodPlan[]; priorRealized?: readonly PersistedPaperPeriodEnvelope[]; }) {
  const events: string[] = [];
  const closed = envelope();
  const openPeriods = options.openPeriods ?? [plan(options.observation ?? "FILLED")];
  const realized = Object.freeze([...(options.priorRealized ?? []), closed]);
  const port: ClosedLearningRolloverPort = {
    listOpenPeriods: () => openPeriods,
    listRealizedPeriods: () => realized,
    readCanonicalPaperAccount: () => account(options.now),
    closePeriodFromCanonicalAccount: ({ periodId, periodEndAt }) => { events.push(`close:${periodId}:${periodEndAt}`); if (options.closeError) throw options.closeError; return closed; },
    openPeriodFromCanonicalAccount: (input) => { events.push(`open:${input.periodId}:${input.periodStartAt}:${input.periodIndex}`); return { ...plan("FILLED", input.periodId), ...input } as PersistedPaperRealizedPeriodPlan; },
    buildEvidenceIdentity: (window) => { events.push(`identity:${window.realizedPeriods.map((item) => item.record.recordId).join(",")}`); return identity(); },
    runClosedLearningCycle: () => { events.push("cycle"); return cycle(options.outcome ?? "INSUFFICIENT"); },
  };
  return { scheduler: new ClosedLearningRolloverScheduler(port), events };
}

describe("ClosedLearningRolloverScheduler", () => {
  it("does not close before the canonical PAPER account crosses the KST trading-day boundary", () => { const { scheduler, events } = harness({ now: SAME_KST_DAY }); assert.equal(scheduler.runOnce().status, "WAITING_FOR_KST_DAY_ROLLOVER"); assert.deepEqual(events, []); });
  it("keeps a crossed period open until a real FILLED observation exists", () => { const { scheduler, events } = harness({ now: NEXT_KST_DAY, observation: "WAIT" }); assert.equal(scheduler.runOnce().status, "WAITING_FOR_REALIZED_FILL"); assert.deepEqual(events, []); });
  it("passes the durable multi-period denominator to identity construction and continues the same candidate after insufficient evidence", () => { const prior = envelope("record-prior", 0); const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "INSUFFICIENT", priorRealized: [prior] }); const result = scheduler.runOnce(); assert.equal(result.status, "CLOSED_AND_EVALUATED"); assert.deepEqual(events.slice(0, 3), [`close:period-0:${NEXT_KST_DAY}`, "identity:record-prior,record-0", "cycle"]); assert.equal(events[3], `open:closed-learning-rollover:1:${NEXT_KST_DAY}:1`); });
  it("does not open a duplicate period when a qualified cycle deploys its replacement challenger", () => { const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "QUALIFIED_FOR_LEAGUE" }); assert.equal(scheduler.runOnce().status, "CLOSED_AND_EVALUATED"); assert.deepEqual(events, [`close:period-0:${NEXT_KST_DAY}`, "identity:record-0", "cycle"]); });
  it("fails closed on multiple open canonical periods", () => { const { scheduler, events } = harness({ now: NEXT_KST_DAY, openPeriods: [plan("FILLED", "period-0"), { ...plan("FILLED", "period-1"), periodIndex: 1 }] }); const result = scheduler.runOnce(); assert.equal(result.status, "BLOCKED"); assert.equal(result.reason, "MULTIPLE_OPEN_PAPER_PERIODS"); assert.deepEqual(events, []); });
  it("does not manufacture Research input or reopen a period when canonical close evidence is incomplete", () => { const { scheduler, events } = harness({ now: NEXT_KST_DAY, closeError: new Error("MISSING_BENCHMARK_EVIDENCE") }); const result = scheduler.runOnce(); assert.equal(result.status, "BLOCKED"); assert.match(result.reason ?? "", /MISSING_BENCHMARK_EVIDENCE/); assert.deepEqual(events, [`close:period-0:${NEXT_KST_DAY}`]); });
});
