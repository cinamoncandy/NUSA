import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ClosedLearningResearchWorkerClient, type ClosedLearningResearchWorkerProcess } from "./closedLearningResearchWorkerClient";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
const VERSION = "c".repeat(64);
const DATA = "d".repeat(64);

function payload() {
  return {
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: ORIGINAL,
    replayRunFingerprintSha256: REPLAY,
    qualification: {
      schemaVersion: 1,
      candidates: [
        { candidateId: "r", outcome: "REJECTED", reasons: ["FAIL"], summary: "rejected" },
        { candidateId: "i", outcome: "INSUFFICIENT", reasons: ["MORE"], summary: "insufficient" },
        { candidateId: "q", outcome: "QUALIFIED_FOR_LEAGUE", reasons: [], summary: "qualified" },
      ],
      coverage: { candidateCount: 3, qualifiedCount: 1, insufficientCount: 1, rejectedCount: 1 },
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function canonicalPayload() {
  return {
    ...payload(),
    qualification: {
      ...payload().qualification,
      candidates: [{ candidateId: "q", outcome: "QUALIFIED_FOR_LEAGUE", reasons: [], summary: "qualified" }],
      coverage: { candidateCount: 1, qualifiedCount: 1, insufficientCount: 0, rejectedCount: 0 },
    },
    canonicalPreparation: {
      matchedCandidateIds: ["q"],
      awaitingPerformanceCandidateIds: [],
      orderedRecordIds: ["period-1"],
      deploymentCandidate: {
        candidateId: "q",
        candidateVersion: VERSION,
        market: "KRW-BTC",
        advisory: {
          schemaVersion: 1,
          generatedAt: "2026-09-05T00:00:00.000Z",
          policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 },
          entries: [{ id: "q", familyId: "f", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: [], sourceDatasetIds: ["dataset-1"] }],
          excludedCandidateIds: [],
          reasons: [],
          provenance: { sourceDatasetIds: ["dataset-1"] },
        },
        candidateProvenance: [{ candidateId: "q", datasetId: "dataset-1", datasetContentSha256: DATA }],
        decisionReference: `research-replay:${REPLAY}:${VERSION.slice(0, 24)}`,
        originalRunFingerprintSha256: ORIGINAL,
        replayRunFingerprintSha256: REPLAY,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      },
    },
  };
}

function client(process: ClosedLearningResearchWorkerProcess) {
  return new ClosedLearningResearchWorkerClient({
    snapshotPath: path.resolve("/tmp/nusa-research-replay.json"),
    workerPath: path.resolve("/tmp/closed-learning-research-worker.js"),
    executable: path.resolve("/tmp/node"),
    process,
  });
}

test("sends only the durable Research snapshot path to the worker environment and preserves every outcome", () => {
  let observedEnv: Readonly<Record<string, string>> | undefined;
  let observedRequest = "";
  const result = client((input) => {
    observedEnv = input.env;
    observedRequest = input.stdin;
    return { status: 0, stdout: JSON.stringify(payload()), stderr: "" };
  }).replay(ORIGINAL, { r: { admission: {} }, i: { admission: {} }, q: { admission: {} } });
  assert.deepEqual(Object.keys(observedEnv ?? {}), ["NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH"]);
  assert.equal((JSON.parse(observedRequest) as { operation: string }).operation, "REPLAY_PAPER_EVIDENCE");
  assert.deepEqual(result.qualification.candidates.map((candidate) => candidate.outcome), ["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);
});

test("canonical replay sends persisted PAPER/account evidence through the same isolated worker and validates deployable provenance", () => {
  let request: Record<string, unknown> | undefined;
  const result = client((input) => {
    request = JSON.parse(input.stdin) as Record<string, unknown>;
    assert.deepEqual(Object.keys(input.env), ["NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH"]);
    return { status: 0, stdout: JSON.stringify(canonicalPayload()), stderr: "" };
  }).replayCanonicalPaperEvidence({
    originalRunFingerprintSha256: ORIGINAL,
    persistedPaperPeriods: [{ record: { recordId: "period-1" } } as unknown as PersistedPaperPeriodEnvelope],
    paperAccount: { version: 1 } as PaperAccountState,
    executionQualityPolicy: { acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 250, poorLatencyMs: 1000 },
  });
  assert.equal(request?.operation, "REPLAY_CANONICAL_PAPER_EVIDENCE");
  assert.equal(result.canonicalPreparation?.deploymentCandidate?.candidateVersion, VERSION);
  assert.equal(result.canonicalPreparation?.deploymentCandidate?.candidateProvenance[0]?.datasetContentSha256, DATA);
});

test("fails closed on process failure, provenance drift, authority drift, coverage filtering, and malformed deployment projection", () => {
  assert.throws(() => client(() => ({ status: 1, stdout: "", stderr: "broken" })).replay(ORIGINAL, { q: {} }), /failed closed/);
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify({ ...payload(), originalRunFingerprintSha256: "c".repeat(64) }), stderr: "" })).replay(ORIGINAL, { q: {} }), /provenance/);
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify({ ...payload(), liveAuthority: "LIVE" }), stderr: "" })).replay(ORIGINAL, { q: {} }), /authority/);
  const filtered = payload();
  filtered.qualification.coverage.candidateCount = 2;
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify(filtered), stderr: "" })).replay(ORIGINAL, { q: {} }), /coverage reconciliation/);
  const malformed = canonicalPayload();
  malformed.canonicalPreparation.deploymentCandidate.candidateVersion = "not-a-hash";
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify(malformed), stderr: "" })).replayCanonicalPaperEvidence({ originalRunFingerprintSha256: ORIGINAL, persistedPaperPeriods: [{} as PersistedPaperPeriodEnvelope], paperAccount: { version: 1 } as PaperAccountState, executionQualityPolicy: { acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 250, poorLatencyMs: 1000 } }), /provenance/);
});

test("rejects non-durable snapshot paths and empty evidence before process execution", () => {
  assert.throws(() => new ClosedLearningResearchWorkerClient({ snapshotPath: ":memory:" }), /absolute durable/);
  let called = false;
  assert.throws(() => client(() => { called = true; return { status: 0, stdout: JSON.stringify(payload()), stderr: "" }; }).replay(ORIGINAL, {}), /evidence is empty/);
  assert.throws(() => client(() => { called = true; return { status: 0, stdout: JSON.stringify(canonicalPayload()), stderr: "" }; }).replayCanonicalPaperEvidence({ originalRunFingerprintSha256: ORIGINAL, persistedPaperPeriods: [], paperAccount: { version: 1 } as PaperAccountState, executionQualityPolicy: { acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 250, poorLatencyMs: 1000 } }), /periods are empty/);
  assert.equal(called, false);
});
