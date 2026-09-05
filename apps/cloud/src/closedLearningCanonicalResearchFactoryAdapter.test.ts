import test from "node:test";
import assert from "node:assert/strict";
import { ClosedLearningCanonicalResearchFactoryAdapter, type ClosedLearningCanonicalResearchFactoryAdapterOptions } from "./closedLearningCanonicalResearchFactoryAdapter";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperResearchLineage } from "./paperResearchLineage";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
const VERSION = "c".repeat(64);
const DATA = "d".repeat(64);
const OTHER = "e".repeat(64);
const decisionReference = `research-replay:${REPLAY}:${VERSION.slice(0, 24)}`;

const lineage = (candidateId = "q", original = ORIGINAL): PaperResearchLineage => Object.freeze({ schemaVersion: 1, candidateId, candidateVersion: VERSION, originalRunFingerprintSha256: original, replayRunFingerprintSha256: ORIGINAL, researchDecisionReference: "seed:decision", authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

function period(id: string, index: number, start: number, candidateId = "q", status: "COMPLETED" | "REJECTED" | "HALTED" = "COMPLETED"): PersistedPaperPeriodEnvelope {
  return {
    record: { recordId: id, periodIndex: index, market: "KRW-BTC", periodStartAt: start, periodEndAt: start + 10, advisory: {} as never, realizedReturns: { [candidateId]: 0 }, benchmarkReturn: 0, turnoverCostRate: 0, costEvidence: {} as never, status },
    candidateProvenance: [{ candidateId, datasetId: "dataset-1", datasetContentSha256: DATA }],
  } as PersistedPaperPeriodEnvelope;
}

function replayResult(blockedReason?: string) {
  const qualified = blockedReason === "ALL_REJECTED"
    ? [{ candidateId: "q", outcome: "REJECTED" as const, reasons: ["FAIL"], summary: "rejected" }]
    : [{ candidateId: "q", outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: [], summary: "qualified" }];
  return Object.freeze({
    schemaVersion: 1 as const,
    operation: "REPLAY_PAPER_EVIDENCE" as const,
    originalRunFingerprintSha256: ORIGINAL,
    replayRunFingerprintSha256: REPLAY,
    qualification: Object.freeze({ schemaVersion: 1 as const, candidates: Object.freeze(qualified), coverage: Object.freeze({ candidateCount: 1, qualifiedCount: blockedReason === "ALL_REJECTED" ? 0 : 1, insufficientCount: 0, rejectedCount: blockedReason === "ALL_REJECTED" ? 1 : 0 }), liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const }),
    canonicalPreparation: Object.freeze({
      matchedCandidateIds: Object.freeze(["q"]),
      awaitingPerformanceCandidateIds: Object.freeze([]),
      orderedRecordIds: Object.freeze(["p1", "p2"]),
      ...(blockedReason == null ? { deploymentCandidate: Object.freeze({ candidateId: "q", candidateVersion: VERSION, market: "KRW-BTC", advisory: Object.freeze({ schemaVersion: 1 as const, generatedAt: "2026-09-05T00:00:00.000Z", policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }), entries: Object.freeze([{ id: "q", familyId: "f", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze([]), sourceDatasetIds: Object.freeze(["dataset-1"]) }]), excludedCandidateIds: Object.freeze([]), reasons: Object.freeze([]), provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-1"]) }) }), candidateProvenance: Object.freeze([{ candidateId: "q", datasetId: "dataset-1", datasetContentSha256: DATA }]), decisionReference, originalRunFingerprintSha256: ORIGINAL, replayRunFingerprintSha256: REPLAY, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const }) } : { deploymentBlockedReason: blockedReason === "ALL_REJECTED" ? "NO_QUALIFIED_CANDIDATE" : blockedReason }),
    }),
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

const identity = Object.freeze({ cycleId: `closed-learning:${"f".repeat(64)}`, evidenceId: "evidence-1", evidenceFingerprintSha256: "1".repeat(64), championId: "champion", championVersion: "v1", sourceCommitSha: "2".repeat(40), costModelVersion: "cost-v1", riskConfigHash: "3".repeat(64), evidenceReferences: Object.freeze(["paper:p1"]) });

function makeOptions(result = replayResult(), periods = [period("p1", 0, 100), period("p2", 1, 200)]) {
  const events: string[] = [];
  let workerPeriods: readonly PersistedPaperPeriodEnvelope[] = [];
  const artifacts: unknown[] = [];
  const options: ClosedLearningCanonicalResearchFactoryAdapterOptions = {
    worker: { replayCanonicalPaperEvidence: (input) => { events.push("worker"); workerPeriods = input.persistedPaperPeriods; return result; } } as unknown as ClosedLearningCanonicalResearchFactoryAdapterOptions["worker"],
    history: { persist: () => { events.push("history"); return { appended: 1, state: {} as never }; } } as unknown as ClosedLearningCanonicalResearchFactoryAdapterOptions["history"],
    artifacts: { save: (artifact) => { events.push("artifact"); artifacts.push(artifact); return artifact; } },
    bindings: { current: (_market, at) => ({ schemaVersion: 1, status: "ACTIVE", market: "KRW-BTC", binding: { candidateId: "q" }, researchLineage: at === 50 ? lineage("old", OTHER) : lineage(), activatedAt: at, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }) as never },
    periods: { listRealizedPeriods: () => periods },
    readCanonicalPaperAccount: () => ({ version: 1 } as PaperAccountState),
    executionQualityPolicy: { acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 250, poorLatencyMs: 1000 },
    now: () => 999,
  };
  return { options, events, artifacts, getWorkerPeriods: () => workerPeriods };
}

test("persists the complete replay denominator before materializing one qualified immutable artifact", () => {
  const setup = makeOptions();
  const decision = new ClosedLearningCanonicalResearchFactoryAdapter(setup.options).evaluate(identity);
  assert.equal(decision.outcome, "QUALIFIED_FOR_LEAGUE");
  assert.equal(decision.candidateId, "q");
  assert.equal(decision.candidateVersion, VERSION);
  assert.deepEqual(setup.events, ["worker", "history", "artifact"]);
  assert.equal(setup.artifacts.length, 1);
  const artifact = setup.artifacts[0] as { researchLineage: PaperResearchLineage };
  assert.equal(artifact.researchLineage.originalRunFingerprintSha256, ORIGINAL);
  assert.equal(artifact.researchLineage.replayRunFingerprintSha256, REPLAY);
});

test("does not arbitrarily deploy when replay is blocked and keeps the denominator", () => {
  const setup = makeOptions(replayResult("MULTIPLE_QUALIFIED_CANDIDATES"));
  const decision = new ClosedLearningCanonicalResearchFactoryAdapter(setup.options).evaluate(identity);
  assert.equal(decision.outcome, "INSUFFICIENT");
  assert.ok(decision.reasons.includes("MULTIPLE_QUALIFIED_CANDIDATES"));
  assert.deepEqual(setup.events, ["worker", "history"]);
  assert.equal(setup.artifacts.length, 0);
});

test("all rejected canonical Research outcomes remain rejected without deployment", () => {
  const setup = makeOptions(replayResult("ALL_REJECTED"));
  const decision = new ClosedLearningCanonicalResearchFactoryAdapter(setup.options).evaluate(identity);
  assert.equal(decision.outcome, "REJECTED");
  assert.ok(decision.reasons.some((reason) => reason.includes("q:FAIL")));
  assert.equal(setup.artifacts.length, 0);
});

test("lineage grouping includes every status for the exact immutable lineage and excludes older lineages", () => {
  const periods = [period("old", 0, 50, "old", "REJECTED"), period("p1", 1, 100, "q", "HALTED"), period("p2", 2, 200, "q", "COMPLETED")];
  const setup = makeOptions(replayResult(), periods);
  new ClosedLearningCanonicalResearchFactoryAdapter(setup.options).evaluate(identity);
  assert.deepEqual(setup.getWorkerPeriods().map((item) => item.record.recordId), ["p1", "p2"]);
  assert.deepEqual(setup.getWorkerPeriods().map((item) => item.record.status), ["HALTED", "COMPLETED"]);
});

test("no realized PAPER evidence is insufficient and does not invoke Research or mutate artifacts", () => {
  const setup = makeOptions(replayResult(), []);
  const decision = new ClosedLearningCanonicalResearchFactoryAdapter(setup.options).evaluate(identity);
  assert.equal(decision.outcome, "INSUFFICIENT");
  assert.deepEqual(setup.events, []);
  assert.equal(setup.artifacts.length, 0);
});
