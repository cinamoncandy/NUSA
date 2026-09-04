"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { executeRequest, snapshotPathFromEnv, validateRequest } = require("./closed-learning-research-worker.js");

const HASH = "a".repeat(64);
const SNAPSHOT = Object.freeze({ originalRunFingerprintSha256: HASH });
const qualification = Object.freeze({ schemaVersion: 1, candidates: Object.freeze([{ candidateId: "c1", outcome: "INSUFFICIENT", reasons: Object.freeze(["MORE_PAPER_EVIDENCE_REQUIRED"]), summary: "insufficient" }]), coverage: Object.freeze({ candidateCount: 1, qualifiedCount: 0, insufficientCount: 1, rejectedCount: 0 }), liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });

function deps(overrides = {}) {
  class Store {
    constructor(filename) { this.filename = filename; }
    read(fingerprint) { return fingerprint === HASH ? SNAPSHOT : undefined; }
  }
  return {
    FileResearchRunReplaySnapshotStore: Store,
    replayResearchRunWithPaperEvidence: () => Object.freeze({ run: Object.freeze({ provenance: Object.freeze({ runFingerprintSha256: "b".repeat(64) }) }), qualification }),
    ...overrides,
  };
}

const request = Object.freeze({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: HASH, paperEvidenceByCandidate: Object.freeze({ c1: Object.freeze({ admission: Object.freeze({}), paperPerformance: Object.freeze({}) }) }) });
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
  const result = executeRequest(request, env, deps({ replayResearchRunWithPaperEvidence: () => ({ run: { provenance: { runFingerprintSha256: "b".repeat(64) } }, qualification: mixed }) }));
  assert.deepEqual(result.qualification.candidates.map((item) => item.outcome), ["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);
});

test("fails closed on missing snapshot, unsafe authority, forbidden credential-like fields, and non-durable path", () => {
  assert.throws(() => executeRequest(request, env, deps({ FileResearchRunReplaySnapshotStore: class { read() { return undefined; } } })), /snapshot is unavailable/);
  assert.throws(() => executeRequest(request, env, deps({ replayResearchRunWithPaperEvidence: () => ({ run: { provenance: { runFingerprintSha256: HASH } }, qualification: { ...qualification, liveAuthority: "LIVE" } }) })), /authority invariant/);
  assert.throws(() => validateRequest({ ...request, apiKey: "nope" }), /forbidden field/);
  assert.throws(() => snapshotPathFromEnv({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: ":memory:" }), /absolute durable path/);
});
