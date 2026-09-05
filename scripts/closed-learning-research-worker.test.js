"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { executeRequest, snapshotPathFromEnv, validateRequest } = require("./closed-learning-research-worker.js");

const HASH = "a".repeat(64);
const REPLAY = "b".repeat(64);
const SPEC = "c".repeat(64);
const DATA = "d".repeat(64);
const SNAPSHOT = Object.freeze({ originalRunFingerprintSha256: HASH, candidates: Object.freeze([{ id: "c1" }]) });
const qualification = Object.freeze({ schemaVersion: 1, candidates: Object.freeze([{ candidateId: "c1", outcome: "INSUFFICIENT", reasons: Object.freeze(["MORE_PAPER_EVIDENCE_REQUIRED"]), summary: "insufficient" }]), coverage: Object.freeze({ candidateCount: 1, qualifiedCount: 0, insufficientCount: 1, rejectedCount: 0 }), liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

function run(qualificationValue = qualification) {
  return Object.freeze({
    provenance: Object.freeze({
      runFingerprintSha256: REPLAY,
      dataset: Object.freeze({ datasetId: "dataset-1", contentSha256: DATA, market: "KRW-BTC" }),
      candidateBindings: Object.freeze([{ candidateId: "c1", specificationHash: SPEC, datasetId: "dataset-1", datasetContentSha256: DATA }]),
    }),
    allocation: Object.freeze({ schemaVersion: 1, generatedAt: "2026-09-05T00:00:00.000Z", policy: Object.freeze({}), entries: Object.freeze([{ id: "c1", sourceDatasetIds: Object.freeze(["dataset-1"]) }]), excludedCandidateIds: Object.freeze([]), reasons: Object.freeze([]), provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-1"]) }) }),
    qualificationValue,
  });
}

function deps(overrides = {}) {
  class Store {
    constructor(filename) { this.filename = filename; }
    read(fingerprint) { return fingerprint === HASH ? SNAPSHOT : undefined; }
  }
  return {
    FileResearchRunReplaySnapshotStore: Store,
    replayResearchRunWithPaperEvidence: () => Object.freeze({ run: run(), qualification }),
    adaptPersistedPaperForwardEvidence: () => Object.freeze({ candidates: Object.freeze([]), orderedRecordIds: Object.freeze([]) }),
    buildCanonicalPaperCandidatePerformance: () => undefined,
    ...overrides,
  };
}

const request = Object.freeze({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: HASH, paperEvidenceByCandidate: Object.freeze({ c1: Object.freeze({ admission: Object.freeze({}), paperPerformance: Object.freeze({}) }) }) });
const canonicalRequest = Object.freeze({ schemaVersion: 1, operation: "REPLAY_CANONICAL_PAPER_EVIDENCE", originalRunFingerprintSha256: HASH, persistedPaperPeriods: Object.freeze([{ record: Object.freeze({ recordId: "p1" }) }]), paperAccount: Object.freeze({ version: 1 }), executionQualityPolicy: Object.freeze({ minimumTradeCount: 1 }) });
const env = Object.freeze({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: path.resolve("/tmp/nusa-research-snapshots.json") });

test("executes PAPER replay against the exact immutable Research snapshot with zero authority", () => {
  const result = executeRequest(request, env, deps());
  assert.equal(result.originalRunFingerprintSha256, HASH);
  assert.equal(result.qualification.candidates[0].outcome, "INSUFFICIENT");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("preserves REJECTED and QUALIFIED outcomes without survivor filtering", () => {
  const mixed = Object.freeze({ ...qualification, candidates: Object.freeze([
    { candidateId: "rejected", outcome: "REJECTED", reasons: Object.freeze(["FAIL"]), summary: "rejected" },
    { candidateId: "insufficient", outcome: "INSUFFICIENT", reasons: Object.freeze(["MORE"]), summary: "insufficient" },
    { candidateId: "qualified", outcome: "QUALIFIED_FOR_LEAGUE", reasons: Object.freeze([]), summary: "qualified" },
  ]), coverage: Object.freeze({ candidateCount: 3, qualifiedCount: 1, insufficientCount: 1, rejectedCount: 1 }) });
  const result = executeRequest(request, env, deps({ replayResearchRunWithPaperEvidence: () => ({ run: run(mixed), qualification: mixed }) }));
  assert.deepEqual(result.qualification.candidates.map((item) => item.outcome), ["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);
});

test("canonical operation reuses persisted adapter and canonical performance builder before replay", () => {
  const admission = Object.freeze({ status: "VERIFIED" });
  const periods = Object.freeze([{ periodId: "p1" }]);
  const performance = Object.freeze({ candidateId: "c1" });
  const qualified = Object.freeze({ ...qualification, candidates: Object.freeze([{ candidateId: "c1", outcome: "QUALIFIED_FOR_LEAGUE", reasons: Object.freeze([]), summary: "qualified" }]), coverage: Object.freeze({ candidateCount: 1, qualifiedCount: 1, insufficientCount: 0, rejectedCount: 0 }) });
  let replayEvidence;
  const result = executeRequest(canonicalRequest, env, deps({
    adaptPersistedPaperForwardEvidence: () => Object.freeze({ candidates: Object.freeze([{ candidateId: "c1", periods, admission }]), orderedRecordIds: Object.freeze(["p1"]) }),
    buildCanonicalPaperCandidatePerformance: (input) => { assert.equal(input.candidateId, "c1"); assert.equal(input.periods, periods); return performance; },
    replayResearchRunWithPaperEvidence: (_snapshot, evidence) => { replayEvidence = evidence; return Object.freeze({ run: run(qualified), qualification: qualified }); },
  }));
  assert.equal(replayEvidence.c1.admission, admission);
  assert.equal(replayEvidence.c1.paperPerformance, performance);
  assert.deepEqual(result.canonicalPreparation.matchedCandidateIds, ["c1"]);
  assert.deepEqual(result.canonicalPreparation.awaitingPerformanceCandidateIds, []);
  assert.equal(result.canonicalPreparation.deploymentCandidate.candidateVersion, SPEC);
  assert.equal(result.canonicalPreparation.deploymentCandidate.market, "KRW-BTC");
  assert.equal(result.canonicalPreparation.deploymentCandidate.originalRunFingerprintSha256, HASH);
  assert.equal(result.canonicalPreparation.deploymentCandidate.replayRunFingerprintSha256, REPLAY);
});

test("canonical operation preserves missing empirical performance as a deployment block", () => {
  const qualified = Object.freeze({ ...qualification, candidates: Object.freeze([{ candidateId: "c1", outcome: "QUALIFIED_FOR_LEAGUE", reasons: Object.freeze([]), summary: "qualified" }]), coverage: Object.freeze({ candidateCount: 1, qualifiedCount: 1, insufficientCount: 0, rejectedCount: 0 }) });
  const result = executeRequest(canonicalRequest, env, deps({
    adaptPersistedPaperForwardEvidence: () => Object.freeze({ candidates: Object.freeze([{ candidateId: "c1", periods: Object.freeze([{ periodId: "p1" }]), admission: Object.freeze({ status: "VERIFIED" }) }]), orderedRecordIds: Object.freeze(["p1"]) }),
    buildCanonicalPaperCandidatePerformance: () => undefined,
    replayResearchRunWithPaperEvidence: () => Object.freeze({ run: run(qualified), qualification: qualified }),
  }));
  assert.deepEqual(result.canonicalPreparation.awaitingPerformanceCandidateIds, ["c1"]);
  assert.equal(result.canonicalPreparation.deploymentCandidate, undefined);
  assert.equal(result.canonicalPreparation.deploymentBlockedReason, "CANONICAL_PAPER_PERFORMANCE_INSUFFICIENT");
});

test("canonical operation fails closed on snapshot mismatch and ambiguous qualification", () => {
  assert.throws(() => executeRequest(canonicalRequest, env, deps({ adaptPersistedPaperForwardEvidence: () => ({ candidates: [{ candidateId: "other", periods: [], admission: {} }], orderedRecordIds: [] }) })), /does not belong/);
  const ambiguous = Object.freeze({ ...qualification, candidates: Object.freeze([
    { candidateId: "c1", outcome: "QUALIFIED_FOR_LEAGUE", reasons: Object.freeze([]), summary: "qualified" },
    { candidateId: "c2", outcome: "QUALIFIED_FOR_LEAGUE", reasons: Object.freeze([]), summary: "qualified" },
  ]), coverage: Object.freeze({ candidateCount: 2, qualifiedCount: 2, insufficientCount: 0, rejectedCount: 0 }) });
  const result = executeRequest(canonicalRequest, env, deps({
    adaptPersistedPaperForwardEvidence: () => ({ candidates: [{ candidateId: "c1", periods: [], admission: {} }], orderedRecordIds: ["p1"] }),
    buildCanonicalPaperCandidatePerformance: () => ({}),
    replayResearchRunWithPaperEvidence: () => ({ run: run(ambiguous), qualification: ambiguous }),
  }));
  assert.equal(result.canonicalPreparation.deploymentBlockedReason, "MULTIPLE_QUALIFIED_CANDIDATES");
});

test("fails closed on missing snapshot, unsafe authority, forbidden credential-like fields, and non-durable path", () => {
  assert.throws(() => executeRequest(request, env, deps({ FileResearchRunReplaySnapshotStore: class { read() { return undefined; } } })), /snapshot is unavailable/);
  assert.throws(() => executeRequest(request, env, deps({ replayResearchRunWithPaperEvidence: () => ({ run: run(), qualification: { ...qualification, liveAuthority: "LIVE" } }) })), /authority invariant/);
  assert.throws(() => validateRequest({ ...request, apiKey: "nope" }), /forbidden field/);
  assert.throws(() => validateRequest({ ...canonicalRequest, persistedPaperPeriods: [] }), /periods are empty/);
  assert.throws(() => snapshotPathFromEnv({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: ":memory:" }), /absolute durable path/);
});
