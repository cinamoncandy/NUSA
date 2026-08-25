const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ImprovementObserver,
  verifyRemediationProposal,
  prioritizeVerifiedRemediationProposals
} = require("../dist/packages/core/src/index.js");
const { SqliteDatabase, SqliteImprovementCandidateMemory } = require("../dist/packages/storage/src/index.js");

const diagnostics = {
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
  episodes: []
};

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const observer = new ImprovementObserver(undefined, new SqliteImprovementCandidateMemory(db));
  observer.observe({ observedAt: 1_000, diagnostics });
  const observation = observer.observe({ observedAt: 2_000, diagnostics });
  const proposal = observation.evidenceBundle.remediationProposals[0];
  const verification = verifyRemediationProposal(proposal, {
    asOfTimestamp: 2_000,
    evidence: observation.evidenceBundle.evidence
  });
  return { db, proposal, verification };
}

function close(value) { value.db.close(); }

test("WO-0070: verified proposals produce a bounded advisory queue with all explicit factors", () => {
  const value = fixture();
  try {
    const result = prioritizeVerifiedRemediationProposals([value.proposal], {
      verifications: [value.verification],
      asOfTimestamp: 2_000
    });
    assert.equal(result.mode, "ADVISORY");
    assert.equal(result.readOnly, true);
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(result.failClosed, false);
    assert.equal(result.queue.length, 1);
    assert.equal(result.queue[0].status, "PRIORITIZED");
    assert.equal(result.queue[0].rank, 1);
    assert.equal(result.queue[0].advisoryOnly, true);
    assert.equal(result.queue[0].executable, false);
    assert.equal(result.queue[0].requiresHumanReview, true);
    assert.deepEqual(result.queue[0].factors.map((item) => item.code), [
      "IMPACT", "EVIDENCE_STRENGTH", "RISK", "REVERSIBILITY",
      "IMPLEMENTATION_COST", "REGRESSION_SURFACE", "URGENCY"
    ]);
    assert.match(result.queue[0].factors.find((item) => item.code === "IMPACT").reason, /no financial outcome/);
  } finally { close(value); }
});

test("WO-0070: ordering is deterministic, input order independent, and side-effect free", () => {
  const value = fixture();
  try {
    const proposalBefore = JSON.stringify(value.proposal);
    const verificationBefore = JSON.stringify(value.verification);
    const first = prioritizeVerifiedRemediationProposals([value.proposal, value.proposal], {
      verifications: [value.verification, value.verification],
      asOfTimestamp: 2_000
    });
    const second = prioritizeVerifiedRemediationProposals([value.proposal], {
      verifications: [value.verification],
      asOfTimestamp: 2_000
    });
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(value.proposal), proposalBefore);
    assert.equal(JSON.stringify(value.verification), verificationBefore);
  } finally { close(value); }
});

test("WO-0070: missing, non-pass, stale, future, and mismatched verification fail closed", () => {
  const value = fixture();
  try {
    const base = { proposals: [value.proposal], asOfTimestamp: 2_000 };
    assert.ok(prioritizeVerifiedRemediationProposals(base.proposals, { ...base, verifications: [] }).rejected[0].reasonCodes.includes("VERIFICATION_MISSING"));
    assert.ok(prioritizeVerifiedRemediationProposals(base.proposals, { ...base, verifications: [{ ...value.verification, status: "BLOCKED" }] }).rejected[0].reasonCodes.includes("VERIFICATION_NOT_PASS"));
    assert.ok(prioritizeVerifiedRemediationProposals(base.proposals, { ...base, asOfTimestamp: 3_000, verifications: [value.verification], maxProposalAgeMs: 1 }).rejected[0].reasonCodes.includes("PROPOSAL_STALE"));
    assert.ok(prioritizeVerifiedRemediationProposals([{ ...value.proposal, generatedAt: 3_000 }], { ...base, verifications: [value.verification] }).rejected[0].reasonCodes.includes("PROPOSAL_FUTURE"));
    assert.ok(prioritizeVerifiedRemediationProposals(base.proposals, { ...base, verifications: [{ ...value.verification, checkedEvidenceIds: ["other"] }] }).rejected[0].reasonCodes.includes("VERIFICATION_MISMATCH"));
    assert.equal(prioritizeVerifiedRemediationProposals(base.proposals, { ...base, verifications: [] }).failClosed, true);
  } finally { close(value); }
});

test("WO-0070: protected, irreversible, malformed, and unbounded inputs are rejected without mutation", () => {
  const value = fixture();
  try {
    const protectedProposal = { ...value.proposal, changeSurface: "BROKER" };
    const protectedResult = prioritizeVerifiedRemediationProposals([protectedProposal], { verifications: [value.verification], asOfTimestamp: 2_000 });
    assert.ok(protectedResult.rejected[0].reasonCodes.includes("PROTECTED_SURFACE"));
    const irreversibleResult = prioritizeVerifiedRemediationProposals([{ ...value.proposal, reversible: false }], { verifications: [value.verification], asOfTimestamp: 2_000 });
    assert.ok(irreversibleResult.rejected[0].reasonCodes.includes("IRREVERSIBLE"));
    const blockedResult = prioritizeVerifiedRemediationProposals([{ ...value.proposal, status: "BLOCKED" }], { verifications: [value.verification], asOfTimestamp: 2_000 });
    assert.ok(blockedResult.rejected[0].reasonCodes.includes("PROPOSAL_BLOCKED"));
    assert.equal(prioritizeVerifiedRemediationProposals(new Array(65).fill(value.proposal), { verifications: [value.verification], asOfTimestamp: 2_000 }).failClosed, true);
    assert.equal(prioritizeVerifiedRemediationProposals([null], { verifications: [], asOfTimestamp: 2_000 }).rejected[0].reasonCodes.includes("PROPOSAL_MISSING"), true);
  } finally { close(value); }
});

test("WO-0070: malformed context fails closed instead of mutating or throwing", () => {
  const result = prioritizeVerifiedRemediationProposals([], { verifications: [], asOfTimestamp: -1 });
  assert.equal(result.failClosed, true);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.queue.length, 0);
});
