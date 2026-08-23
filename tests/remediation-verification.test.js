const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ImprovementObserver,
  verifyRemediationProposal,
  replayRemediationProposal
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

function proposalFixture() {
  const db = new SqliteDatabase(":memory:");
  const observer = new ImprovementObserver(undefined, new SqliteImprovementCandidateMemory(db));
  observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
  const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
  return { db, proposal: result.evidenceBundle.remediationProposals[0], evidence: result.evidenceBundle.evidence };
}

test("WO-0068: valid proposal passes deterministic dry-run and replay", () => {
  const { db, proposal, evidence } = proposalFixture();
  try {
    const context = { asOfTimestamp: 2_000, evidence };
    const first = verifyRemediationProposal(proposal, context);
    const second = replayRemediationProposal(proposal, context);
    assert.equal(first.status, "PASS");
    assert.equal(first.dryRun, true);
    assert.equal(first.replayable, true);
    assert.equal(first.executable, false);
    assert.deepEqual(first, second);
  } finally { db.close(); }
});

test("WO-0068: stale, missing, malformed, and contradictory evidence fail closed", () => {
  const { db, proposal, evidence } = proposalFixture();
  try {
    assert.equal(verifyRemediationProposal(proposal, { asOfTimestamp: 100_000, evidence, maxEvidenceAgeMs: 100 }).status, "INSUFFICIENT");
    assert.ok(verifyRemediationProposal(proposal, { asOfTimestamp: 100_000, evidence, maxEvidenceAgeMs: 100 }).reasonCodes.includes("EVIDENCE_STALE"));
    assert.equal(verifyRemediationProposal(proposal, { asOfTimestamp: 2_000, evidence: [] }).status, "INSUFFICIENT");
    assert.equal(verifyRemediationProposal(proposal, { asOfTimestamp: 2_000, evidence: [{ ...evidence[0], observedAt: "bad" }] }).status, "INVALID");
    assert.equal(verifyRemediationProposal(proposal, { asOfTimestamp: 2_000, evidence: [{ ...evidence[0], fingerprint: "different" }] }).status, "CONTRADICTED");
  } finally { db.close(); }
});

test("WO-0068: rationale, scope, reversibility, and verification plan are explicit gates", () => {
  const { db, proposal, evidence } = proposalFixture();
  try {
    const context = { asOfTimestamp: 2_000, evidence };
    assert.equal(verifyRemediationProposal({ ...proposal, rationale: "unrelated" }, context).status, "BLOCKED");
    assert.equal(verifyRemediationProposal({ ...proposal, changeSurface: "PERSISTENCE" }, context).status, "BLOCKED");
    assert.equal(verifyRemediationProposal({ ...proposal, reversible: false }, context).status, "BLOCKED");
    assert.equal(verifyRemediationProposal({ ...proposal, verificationPlan: ["run it"] }, context).status, "BLOCKED");
  } finally { db.close(); }
});

test("WO-0068: verifier rejects invalid context and never grants execution authority", () => {
  const { db, proposal, evidence } = proposalFixture();
  try {
    const invalid = verifyRemediationProposal(proposal, { asOfTimestamp: -1, evidence });
    assert.equal(invalid.status, "INVALID");
    assert.equal(invalid.executable, false);
    assert.equal(verifyRemediationProposal(null, { asOfTimestamp: 2_000, evidence }).status, "INVALID");
    assert.equal(Object.isFrozen(invalid), true);
  } finally { db.close(); }
});
