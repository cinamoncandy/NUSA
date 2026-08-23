const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ImprovementObserver,
  verifyRemediationProposal,
  evaluateRemediationPlans
} = require("../dist/packages/core/src/index.js");
const { SqliteDatabase, SqliteImprovementCandidateMemory } = require("../dist/packages/storage/src/index.js");

const diagnostics = (overrides = {}) => ({
  marketConnectionState: "RECONNECTING",
  reconnectAttempt: 2,
  reconnectAttemptLimit: 10,
  reconnectStartedAt: 0,
  lastMarketMessageAt: 0,
  lastSuccessfulReconnectAt: null,
  activeMarketListenerCount: 1,
  activeMarketSubscriptionCount: 1,
  reconnectTimerCount: 1,
  reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED",
  currentDowntimeMs: 30_000,
  totalDowntimeMs: 30_000,
  episodes: [],
  ...overrides
});

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const observer = new ImprovementObserver(undefined, new SqliteImprovementCandidateMemory(db));
  observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
  const observation = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
  const proposal = observation.evidenceBundle.remediationProposals[0];
  const verification = verifyRemediationProposal(proposal, { asOfTimestamp: 2_000, evidence: observation.evidenceBundle.evidence });
  const candidate = {
    id: "plan:observability-a",
    proposalId: proposal.id,
    verificationId: verification.id,
    steps: [{ id: "step:a", description: "record safe reconnect diagnostics", dependencies: [], affectedSurfaces: ["observability"], reversible: true, verificationIds: ["verify:a"] }],
    declaredScope: ["OBSERVABILITY"],
    prerequisites: ["human review approval"],
    riskClass: "LOW",
    riskScore: 1,
    riskBound: 2,
    rollbackSteps: [{ id: "rollback:a", forStepId: "step:a", description: "remove advisory record", dependencies: [] }],
    verificationPlan: [{ id: "verify:a", stepId: "step:a", expectedOutcome: "replay is identical", failureCondition: "authority state changes" }],
    affectedSurfaces: ["observability"],
    provenanceFingerprint: verification.canonicalHash
  };
  return { db, proposal, verification, candidate, context: { proposals: [proposal], verifications: [verification] } };
}

function close(fixtureValue) { fixtureValue.db.close(); }

test("WO-0070: valid candidate is accepted and remains advisory", () => {
  const value = fixture();
  try {
    const result = evaluateRemediationPlans([value.candidate], value.context);
    assert.equal(result.bestCandidateId, value.candidate.id);
    assert.equal(result.acceptedCandidates.length, 1);
    assert.equal(result.acceptedCandidates[0].status, "ACCEPTED");
    assert.equal(result.acceptedCandidates[0].dependencyOrder[0], "step:a");
    assert.equal(result.acceptedCandidates[0].rollbackValid, true);
    assert.equal(result.acceptedCandidates[0].verificationCoverageValid, true);
  } finally { close(value); }
});

test("WO-0070: candidate and step input order do not affect ranking or topology", () => {
  const value = fixture();
  try {
    const other = { ...value.candidate, id: "plan:observability-b", riskScore: 2 };
    const first = evaluateRemediationPlans([value.candidate, other], value.context);
    const second = evaluateRemediationPlans([other, value.candidate], value.context);
    assert.deepEqual(first, second);
    const shuffled = { ...value.candidate, steps: [{ ...value.candidate.steps[0] }] };
    assert.deepEqual(evaluateRemediationPlans([shuffled], value.context).acceptedCandidates[0].dependencyOrder, ["step:a"]);
  } finally { close(value); }
});

test("WO-0070: missing, rejected, stale, and mismatched upstream verification fail closed", () => {
  const value = fixture();
  try {
    assert.ok(evaluateRemediationPlans([value.candidate], { proposals: value.context.proposals, verifications: [] }).rejectedCandidates[0].rejectionReasons.includes("UPSTREAM_VERIFICATION_MISSING"));
    const rejected = { ...value.verification, status: "BLOCKED" };
    assert.ok(evaluateRemediationPlans([value.candidate], { proposals: value.context.proposals, verifications: [rejected] }).rejectedCandidates[0].rejectionReasons.includes("UPSTREAM_VERIFICATION_REJECTED"));
    assert.ok(evaluateRemediationPlans([value.candidate], { proposals: value.context.proposals, verifications: [{ ...value.verification, canonicalHash: "wrong" }] }).rejectedCandidates[0].rejectionReasons.includes("PROVENANCE_INVALID"));
    assert.ok(evaluateRemediationPlans([value.candidate], { proposals: [{ ...value.proposal, status: "BLOCKED" }], verifications: [value.verification] }).rejectedCandidates[0].rejectionReasons.includes("PROPOSAL_BLOCKED"));
    assert.ok(evaluateRemediationPlans([value.candidate], {
      proposals: value.context.proposals,
      verifications: [{ ...value.verification, verifiedAt: 1 }],
      asOfTimestamp: 10_000,
      maxVerificationAgeMs: 100
    }).rejectedCandidates[0].rejectionReasons.includes("UPSTREAM_VERIFICATION_STALE"));
  } finally { close(value); }
});

test("WO-0070: malformed provenance, scope expansion, and protected surface are rejected", () => {
  const value = fixture();
  try {
    for (const candidate of [
      { ...value.candidate, provenanceFingerprint: "" },
      { ...value.candidate, declaredScope: ["PERSISTENCE"] },
      { ...value.candidate, affectedSurfaces: ["broker"] },
      { ...value.candidate, steps: [{ ...value.candidate.steps[0], affectedSurfaces: ["persistence"] }] },
      { ...value.candidate, riskClass: "HIGH" },
      { ...value.candidate, riskScore: 3, riskBound: 2 }
    ]) assert.equal(evaluateRemediationPlans([candidate], value.context).acceptedCandidates.length, 0);
  } finally { close(value); }
});

test("WO-0070: missing dependency, cycle, duplicate step, and missing prerequisite reject", () => {
  const value = fixture();
  try {
    const cases = [
      { ...value.candidate, steps: [{ ...value.candidate.steps[0], dependencies: ["missing"] }] },
      { ...value.candidate, steps: [{ ...value.candidate.steps[0], dependencies: ["step:a"] }] },
      { ...value.candidate, steps: [value.candidate.steps[0], value.candidate.steps[0]] },
      { ...value.candidate, prerequisites: [] }
    ];
    for (const candidate of cases) assert.equal(evaluateRemediationPlans([candidate], value.context).acceptedCandidates.length, 0);
  } finally { close(value); }
});

test("WO-0070: rollback and verification coverage are complete gates", () => {
  const value = fixture();
  try {
    for (const candidate of [
      { ...value.candidate, rollbackSteps: [] },
      { ...value.candidate, rollbackSteps: [{ ...value.candidate.rollbackSteps[0], forStepId: "other" }] },
      { ...value.candidate, steps: [{ ...value.candidate.steps[0], reversible: false }] },
      { ...value.candidate, verificationPlan: [] },
      { ...value.candidate, steps: [{ ...value.candidate.steps[0], verificationIds: ["missing"] }] }
    ]) assert.equal(evaluateRemediationPlans([candidate], value.context).acceptedCandidates.length, 0);
  } finally { close(value); }
});

test("WO-0070: bounds, malformed input, and empty accepted set fail closed", () => {
  const value = fixture();
  try {
    assert.equal(evaluateRemediationPlans([], value.context).failClosed, true);
    assert.equal(evaluateRemediationPlans([null], value.context).rejectedCandidates.length, 1);
    assert.equal(evaluateRemediationPlans(new Array(33).fill(value.candidate), value.context).failClosed, true);
    assert.equal(evaluateRemediationPlans([value.candidate], { proposals: value.context.proposals, verifications: value.context.verifications, maxStepsPerCandidate: 0 }).failClosed, true);
  } finally { close(value); }
});

test("WO-0070: evaluation is deterministic and has no execution side effects", () => {
  const value = fixture();
  try {
    const before = JSON.stringify(value.candidate);
    const first = evaluateRemediationPlans([value.candidate], value.context);
    const second = evaluateRemediationPlans([value.candidate], value.context);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(value.candidate), before);
    assert.equal(first.acceptedCandidates[0].evaluationFingerprint.length, 64);
    assert.equal(first.acceptedCandidates[0].status, "ACCEPTED");
  } finally { close(value); }
});
