import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ClosedLearningResearchWorkerClient, type ClosedLearningResearchWorkerProcess } from "./closedLearningResearchWorkerClient";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
const VERSION = "c".repeat(64);
const DATASET_HASH = "d".repeat(64);

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
    deployment: {
      schemaVersion: 1,
      status: "NOT_DEPLOYABLE",
      reasons: ["NO_ALLOCATION_ADVISORY"],
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function deployablePayload() {
  const base = payload();
  const researchDecisionReference = `closed-learning-replay:${REPLAY}:q`;
  return {
    ...base,
    deployment: {
      schemaVersion: 1,
      status: "DEPLOYABLE",
      reasons: ["SINGLE_CANONICAL_LEAGUE_ALLOCATION"],
      artifact: {
        schemaVersion: 1,
        candidateId: "q",
        candidateVersion: VERSION,
        market: "KRW-BTC",
        advisory: { schemaVersion: 1, entries: [{ id: "q", researchWeight: 1 }] },
        candidateProvenance: [{ candidateId: "q", datasetId: "dataset-q", datasetContentSha256: DATASET_HASH }],
        researchDecisionReference,
        researchLineage: {
          schemaVersion: 1,
          candidateId: "q",
          candidateVersion: VERSION,
          originalRunFingerprintSha256: ORIGINAL,
          replayRunFingerprintSha256: REPLAY,
          researchDecisionReference,
          authority: "PAPER_RESEARCH_ONLY",
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        },
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      },
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
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
  assert.equal(result.deployment.status, "NOT_DEPLOYABLE");
});

test("accepts one uniquely qualified deployable artifact only when its immutable Research lineage matches the worker replay", () => {
  const result = client(() => ({ status: 0, stdout: JSON.stringify(deployablePayload()), stderr: "" })).replay(ORIGINAL, { q: {} });
  assert.equal(result.deployment.status, "DEPLOYABLE");
  if (result.deployment.status !== "DEPLOYABLE") throw new Error("expected deployable result");
  assert.equal(result.deployment.artifact.candidateId, "q");
  assert.equal(result.deployment.artifact.candidateVersion, VERSION);
  assert.equal(result.deployment.artifact.researchLineage.originalRunFingerprintSha256, ORIGINAL);
  assert.equal(result.deployment.artifact.researchLineage.replayRunFingerprintSha256, REPLAY);
  assert.equal(result.deployment.liveAuthority, "NONE");
  assert.equal(result.deployment.productionMutationAllowed, false);
});

test("fails closed on process failure, provenance drift, authority drift, coverage filtering, and deployment lineage drift", () => {
  assert.throws(() => client(() => ({ status: 1, stdout: "", stderr: "broken" })).replay(ORIGINAL, { q: {} }), /failed closed/);
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify({ ...payload(), originalRunFingerprintSha256: "e".repeat(64) }), stderr: "" })).replay(ORIGINAL, { q: {} }), /provenance/);
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify({ ...payload(), liveAuthority: "LIVE" }), stderr: "" })).replay(ORIGINAL, { q: {} }), /authority/);
  const filtered = payload();
  filtered.qualification.coverage.candidateCount = 2;
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify(filtered), stderr: "" })).replay(ORIGINAL, { q: {} }), /coverage reconciliation/);
  const drifted = deployablePayload();
  drifted.deployment.artifact.researchLineage.replayRunFingerprintSha256 = "e".repeat(64);
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify(drifted), stderr: "" })).replay(ORIGINAL, { q: {} }), /lineage provenance/);
  const unsafe = deployablePayload();
  unsafe.deployment.artifact.aiAuthority = "FULL_AUTHORITY";
  assert.throws(() => client(() => ({ status: 0, stdout: JSON.stringify(unsafe), stderr: "" })).replay(ORIGINAL, { q: {} }), /artifact authority/);
});

test("rejects non-durable snapshot paths and empty PAPER evidence before process execution", () => {
  assert.throws(() => new ClosedLearningResearchWorkerClient({ snapshotPath: ":memory:" }), /absolute durable/);
  let called = false;
  assert.throws(() => client(() => { called = true; return { status: 0, stdout: JSON.stringify(payload()), stderr: "" }; }).replay(ORIGINAL, {}), /evidence is empty/);
  assert.equal(called, false);
});
