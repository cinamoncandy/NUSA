const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EventBus,
  ImprovementObserver,
  buildRemediationProposals,
  correlateRootCauseEvidence
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

function correlatedBundle() {
  const db = new SqliteDatabase(":memory:");
  const memory = new SqliteImprovementCandidateMemory(db);
  const observer = new ImprovementObserver(undefined, memory);
  observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
  const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
  return { db, observer, result, bundle: result.evidenceBundle };
}

test("WO-0067: evidence-bound proposal is deterministic and non-executable", () => {
  const { db, bundle } = correlatedBundle();
  try {
    const first = buildRemediationProposals(bundle);
    const second = buildRemediationProposals(bundle);
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0].status, "PROPOSED");
    assert.equal(first[0].changeSurface, "OBSERVABILITY");
    assert.equal(first[0].riskClass, "LOW");
    assert.equal(first[0].reversible, true);
    assert.equal(first[0].requiresHumanReview, true);
    assert.equal(first[0].executable, false);
    assert.ok(first[0].rationale.includes(first[0].supportingEvidenceIds[0]));
    assert.ok(first[0].unresolvedAssumptions.includes("CAUSALITY_UNRESOLVED"));
  } finally {
    db.close();
  }
});

test("WO-0067: contradiction, insufficiency, and out-of-scope fail closed", () => {
  const { db, result, bundle } = correlatedBundle();
  try {
    const contradictoryEvidence = { ...result.candidate.evidence[0], id: "bad", fingerprint: "different" };
    const contradictory = correlateRootCauseEvidence(result.candidate, [contradictoryEvidence]);
    assert.equal(buildRemediationProposals(contradictory)[0].status, "BLOCKED");
    assert.equal(buildRemediationProposals(contradictory)[0].executable, false);

    const insufficient = correlateRootCauseEvidence(result.candidate, [], { maxEvidence: 1 });
    assert.equal(buildRemediationProposals(insufficient)[0].status, "BLOCKED");

    const outOfScope = {
      ...bundle,
      candidateFingerprint: "UNSUPPORTED|source|cause",
      evidence: bundle.evidence.map((item) => ({ ...item, fingerprint: "UNSUPPORTED|source|cause" })),
      hypotheses: bundle.hypotheses.map((item) => ({ ...item, candidateFingerprint: "UNSUPPORTED|source|cause" }))
    };
    const blocked = buildRemediationProposals(outOfScope)[0];
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.changeSurface, "UNKNOWN");
    assert.ok(blocked.reasonCodes.includes("HYPOTHESIS_OUT_OF_SCOPE"));
    assert.equal(blocked.executable, false);
  } finally {
    db.close();
  }
});

test("WO-0067: proposal fan-out and duplicate hypotheses are bounded", () => {
  const { db, bundle } = correlatedBundle();
  try {
    const duplicateHypotheses = [
      ...bundle.hypotheses,
      { ...bundle.hypotheses[0], id: "hypothesis:second" }
    ];
    const expanded = { ...bundle, hypotheses: duplicateHypotheses };
    const proposals = buildRemediationProposals(expanded, { maxProposals: 1 });
    assert.equal(proposals.length, 1);
    assert.ok(proposals[0].reasonCodes.includes("PROPOSAL_FANOUT_BOUNDED"));
    assert.deepEqual(proposals, buildRemediationProposals(expanded, { maxProposals: 1 }));
  } finally {
    db.close();
  }
});

test("WO-0067: observer projects proposals through the existing EventBus", async () => {
  const { db, observer } = correlatedBundle();
  try {
    const events = new EventBus();
    const seen = [];
    events.subscribe("improvement.remediationProposal", (proposal) => { seen.push(proposal); });
    const attached = observer.attach(events);
    await events.publish("market.connection.diagnostics", { observedAt: 3_000, diagnostics: diagnostics() });
    attached.unsubscribe();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].executable, false);
  } finally {
    db.close();
  }
});
