const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ImprovementObserver,
  verifyRemediationProposal,
  prioritizeVerifiedRemediationProposals,
  assessRemediationReadiness
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

// Builds the real WO-0067 -> WO-0068/0069 -> WO-0070 chain rather than hand-writing a proposal,
// so readiness is asserted against inputs the upstream pipeline actually produces. Hand-built
// fixtures would let this file keep passing after an upstream contract change it should catch.
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
  const advisory = prioritizeVerifiedRemediationProposals([proposal], {
    verifications: [verification],
    asOfTimestamp: 2_000
  });
  return { db, proposal, verification, priority: advisory.queue[0] };
}

function close(value) { value.db.close(); }

function assertZeroAuthority(result) {
  assert.equal(result.mode, "ADVISORY");
  assert.equal(result.readOnly, true);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  for (const item of result.items) {
    assert.equal(item.advisoryOnly, true);
    assert.equal(item.executable, false);
    assert.equal(item.requiresHumanApproval, true);
  }
}

test("WO-0071: a verified, prioritized, unblocked proposal becomes a human-review readiness item", () => {
  const value = fixture();
  try {
    const result = assessRemediationReadiness([value.priority], { proposals: [value.proposal] });
    assertZeroAuthority(result);
    assert.equal(result.failClosed, false);
    assert.equal(result.items.length, 1);
    assert.equal(result.readyForHumanReview.length, 1);
    const item = result.items[0];
    assert.equal(item.status, "READY_FOR_HUMAN_REVIEW");
    assert.equal(item.proposalId, value.proposal.id);
    assert.equal(item.priorityRank, 1);
    assert.equal(item.blastRadius, "BOUNDED");
    assert.equal(item.rollbackComplete, true);
    assert.equal(item.verificationComplete, true);
    // Even the fully-clean path still carries the approval gate: readiness is never approval.
    assert.deepEqual(item.reasonCodes, ["HUMAN_APPROVAL_REQUIRED"]);
    assert.match(item.id, /^remediation-readiness:[0-9a-f]{64}$/);
    assert.match(item.provenanceFingerprint, /^[0-9a-f]{64}$/);
  } finally { close(value); }
});

test("WO-0071: identical canonical input replays to an identical result, ordering and fingerprint", () => {
  const value = fixture();
  try {
    const context = { proposals: [value.proposal], dependencies: { [value.proposal.id]: ["dep-a"] }, satisfiedDependencies: ["dep-a"] };
    const first = assessRemediationReadiness([value.priority], context);
    const second = assessRemediationReadiness([value.priority], context);
    const third = assessRemediationReadiness([value.priority], context);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
    assert.equal(first.canonicalHash, third.canonicalHash);
    assert.equal(first.items[0].provenanceFingerprint, third.items[0].provenanceFingerprint);
  } finally { close(value); }
});

test("WO-0071: input order does not change the canonical result, and assessment has no side effects", () => {
  const value = fixture();
  try {
    const ids = ["remediation:aaa", "remediation:zzz"];
    const proposals = ids.map((id) => ({ ...value.proposal, id }));
    const prioritized = ids.map((id) => ({ ...value.priority, proposalId: id, rank: 1 }));
    const before = JSON.stringify({ prioritized, proposals });
    const forward = assessRemediationReadiness(prioritized, { proposals });
    const reversed = assessRemediationReadiness([...prioritized].reverse(), { proposals: [...proposals].reverse() });
    assert.equal(forward.canonicalHash, reversed.canonicalHash);
    // Equal rank falls back to proposalId ascending, so ordering is total, not input-dependent.
    assert.deepEqual(forward.items.map((item) => item.proposalId), ids);
    assert.deepEqual(reversed.items.map((item) => item.proposalId), ids);
    assert.equal(JSON.stringify({ prioritized, proposals }), before);
  } finally { close(value); }
});

test("WO-0071: identical duplicates are idempotent and contradictory duplicates fail closed", () => {
  const value = fixture();
  try {
    const single = assessRemediationReadiness([value.priority], { proposals: [value.proposal] });
    const duplicated = assessRemediationReadiness([value.priority, value.priority, value.priority], { proposals: [value.proposal] });
    assert.equal(duplicated.items.length, 1);
    assert.equal(duplicated.canonicalHash, single.canonicalHash);

    // Two records disagreeing about the same canonical identity must not silently resolve to
    // one of them: keeping either would advertise a readiness decision the evidence contradicts.
    const contradictory = { ...value.priority, priorityScore: 999, evaluationFingerprint: "conflicting-fingerprint" };
    const conflict = assessRemediationReadiness([value.priority, contradictory], { proposals: [value.proposal] });
    assertZeroAuthority(conflict);
    assert.equal(conflict.failClosed, true);
    assert.equal(conflict.readyForHumanReview.length, 0);
    assert.deepEqual(conflict.items[0].reasonCodes, ["DUPLICATE_CONFLICT"]);
  } finally { close(value); }
});

test("WO-0071: upstream prioritization gates fail closed instead of being re-derived here", () => {
  const value = fixture();
  try {
    const context = { proposals: [value.proposal] };
    for (const override of [{ status: "INSUFFICIENT" }, { status: "REJECTED" }, { executable: true }, { advisoryOnly: false }, { rank: null }]) {
      const result = assessRemediationReadiness([{ ...value.priority, ...override }], context);
      assertZeroAuthority(result);
      assert.equal(result.failClosed, true);
      assert.equal(result.items[0].status, "REJECTED");
      assert.deepEqual(result.items[0].reasonCodes, ["NOT_PRIORITIZED"], `override ${JSON.stringify(override)} must not be treated as prioritized`);
    }
  } finally { close(value); }
});

test("WO-0071: a missing or mismatched proposal cannot be assessed", () => {
  const value = fixture();
  try {
    const missing = assessRemediationReadiness([value.priority], { proposals: [] });
    assert.equal(missing.failClosed, true);
    assert.deepEqual(missing.items[0].reasonCodes, ["PROPOSAL_MISSING"]);

    const mismatched = assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, candidateFingerprint: "   " }] });
    assert.equal(mismatched.failClosed, true);
    assert.deepEqual(mismatched.items[0].reasonCodes, ["PROPOSAL_MISMATCH"]);
  } finally { close(value); }
});

test("WO-0071: unsatisfied dependencies block readiness and satisfied ones release it", () => {
  const value = fixture();
  try {
    const dependencies = { [value.proposal.id]: ["dep-a", "dep-b"] };
    const unmet = assessRemediationReadiness([value.priority], { proposals: [value.proposal], dependencies, satisfiedDependencies: ["dep-a"] });
    assert.equal(unmet.failClosed, true);
    assert.equal(unmet.items[0].status, "NOT_READY");
    assert.ok(unmet.items[0].reasonCodes.includes("DEPENDENCY_UNMET"));
    assert.deepEqual(unmet.items[0].dependencies, ["dep-a", "dep-b"]);

    const satisfied = assessRemediationReadiness([value.priority], { proposals: [value.proposal], dependencies, satisfiedDependencies: ["dep-b", "dep-a"] });
    assert.equal(satisfied.failClosed, false);
    assert.equal(satisfied.items[0].status, "READY_FOR_HUMAN_REVIEW");

    // Declared prerequisites are surfaced for the human reviewer, deduplicated and ordered.
    const withPrerequisites = assessRemediationReadiness([value.priority], { proposals: [value.proposal], prerequisites: { [value.proposal.id]: ["p-b", "p-a", "p-b"] } });
    assert.deepEqual(withPrerequisites.items[0].prerequisites, ["p-a", "p-b"]);
  } finally { close(value); }
});

test("WO-0071: protected surfaces and unknown scope are unbounded blast radius, never ready", () => {
  const value = fixture();
  try {
    for (const proposal of [
      { ...value.proposal, changeSurface: "BROKER" },
      { ...value.proposal, changeSurface: "PRODUCTION" },
      { ...value.proposal, title: "review live order routing" }
    ]) {
      const result = assessRemediationReadiness([value.priority], { proposals: [proposal] });
      assertZeroAuthority(result);
      assert.equal(result.failClosed, true);
      assert.equal(result.items[0].status, "NOT_READY");
      assert.equal(result.items[0].blastRadius, "UNBOUNDED");
      assert.ok(result.items[0].reasonCodes.includes("PROTECTED_SURFACE"));
      assert.ok(result.items[0].reasonCodes.includes("BLAST_RADIUS_UNBOUNDED"));
      assert.equal(result.readyForHumanReview.length, 0);
    }

    // Unknown scope is unbounded without being protected: the reason codes stay distinguishable.
    const unknown = assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, changeSurface: "UNKNOWN" }] });
    assert.equal(unknown.items[0].blastRadius, "UNBOUNDED");
    assert.ok(unknown.items[0].reasonCodes.includes("BLAST_RADIUS_UNBOUNDED"));
    assert.equal(unknown.items[0].reasonCodes.includes("PROTECTED_SURFACE"), false);
  } finally { close(value); }
});

test("WO-0071: incomplete rollback and incomplete verification plans each block readiness", () => {
  const value = fixture();
  try {
    for (const proposal of [{ ...value.proposal, reversible: false }, { ...value.proposal, reversibilityPlan: "   " }]) {
      const result = assessRemediationReadiness([value.priority], { proposals: [proposal] });
      assert.equal(result.failClosed, true);
      assert.equal(result.items[0].rollbackComplete, false);
      assert.ok(result.items[0].reasonCodes.includes("ROLLBACK_INCOMPLETE"));
    }
    for (const proposal of [
      { ...value.proposal, verificationPlan: [] },
      { ...value.proposal, verificationPlan: ["step", "   "] },
      { ...value.proposal, verificationPlan: "not-a-list" }
    ]) {
      const result = assessRemediationReadiness([value.priority], { proposals: [proposal] });
      assert.equal(result.failClosed, true);
      assert.equal(result.items[0].verificationComplete, false);
      assert.ok(result.items[0].reasonCodes.includes("VERIFICATION_INCOMPLETE"));
    }
  } finally { close(value); }
});

test("WO-0071: bounds are enforced, and truncation is deterministic by rank", () => {
  const value = fixture();
  try {
    const context = { proposals: [value.proposal] };
    for (const [label, prioritized, override] of [
      ["maxItems below range", [value.priority], { maxItems: 0 }],
      ["maxItems above range", [value.priority], { maxItems: 65 }],
      ["maxItems non-integer", [value.priority], { maxItems: 1.5 }],
      ["prioritized overflow", new Array(65).fill(value.priority), {}],
      ["prioritized not a list", "not-a-list", {}]
    ]) {
      const result = assessRemediationReadiness(prioritized, { ...context, ...override });
      assertZeroAuthority(result);
      assert.equal(result.failClosed, true, `${label} must fail closed`);
      assert.deepEqual(result.items[0].reasonCodes, ["BOUND_EXCEEDED"], label);
    }
    assert.deepEqual(assessRemediationReadiness([value.priority], { proposals: "not-a-list" }).items[0].reasonCodes, ["BOUND_EXCEEDED"]);

    // Within bounds, the queue truncates to the highest-priority items only -- deterministically,
    // by the rank the upstream prioritizer already assigned.
    const ids = ["remediation:001", "remediation:002", "remediation:003", "remediation:004"];
    const proposals = ids.map((id) => ({ ...value.proposal, id }));
    const prioritized = ids.map((id, index) => ({ ...value.priority, proposalId: id, rank: index + 1 }));
    const truncated = assessRemediationReadiness([...prioritized].reverse(), { proposals, maxItems: 2 });
    assert.deepEqual(truncated.items.map((item) => item.priorityRank), [1, 2]);
    assert.deepEqual(truncated.items.map((item) => item.proposalId), ["remediation:001", "remediation:002"]);
  } finally { close(value); }
});

test("WO-0071: structurally malformed input fails closed instead of throwing", () => {
  const value = fixture();
  try {
    const context = { proposals: [value.proposal] };
    for (const prioritized of [[null], [undefined], ["not-an-object"], [42], [{ ...value.priority, proposalId: undefined }], [{ ...value.priority, proposalId: "   " }]]) {
      const result = assessRemediationReadiness(prioritized, context);
      assertZeroAuthority(result);
      assert.equal(result.failClosed, true);
      assert.deepEqual(result.items[0].reasonCodes, ["MALFORMED"]);
      assert.equal(result.readyForHumanReview.length, 0);
    }
    // A missing context must fail closed rather than propagate a TypeError to the caller.
    assert.equal(assessRemediationReadiness([value.priority], undefined).failClosed, true);
    assert.equal(assessRemediationReadiness(undefined, undefined).failClosed, true);
  } finally { close(value); }
});

test("WO-0071: every declared reason code is reachable, so no gate is advertised without existing", () => {
  const value = fixture();
  try {
    const emitted = new Set();
    const collect = (result) => { for (const item of result.items) for (const code of item.reasonCodes) emitted.add(code); };
    const context = { proposals: [value.proposal] };
    collect(assessRemediationReadiness([value.priority], context));
    collect(assessRemediationReadiness([{ ...value.priority, status: "REJECTED" }], context));
    collect(assessRemediationReadiness([value.priority], { proposals: [] }));
    collect(assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, candidateFingerprint: " " }] }));
    collect(assessRemediationReadiness([value.priority], { ...context, dependencies: { [value.proposal.id]: ["dep"] } }));
    collect(assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, changeSurface: "BROKER" }] }));
    collect(assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, reversible: false }] }));
    collect(assessRemediationReadiness([value.priority], { proposals: [{ ...value.proposal, verificationPlan: [] }] }));
    collect(assessRemediationReadiness([value.priority], { ...context, maxItems: 0 }));
    collect(assessRemediationReadiness([null], context));
    collect(assessRemediationReadiness([value.priority, { ...value.priority, evaluationFingerprint: "other" }], context));

    assert.deepEqual([...emitted].sort(), [
      "BLAST_RADIUS_UNBOUNDED", "BOUND_EXCEEDED", "DEPENDENCY_UNMET", "DUPLICATE_CONFLICT",
      "HUMAN_APPROVAL_REQUIRED", "MALFORMED", "NOT_PRIORITIZED", "PROPOSAL_MISMATCH",
      "PROPOSAL_MISSING", "PROTECTED_SURFACE", "ROLLBACK_INCOMPLETE", "VERIFICATION_INCOMPLETE"
    ]);
  } finally { close(value); }
});

test("WO-0071: readiness assessment grants no execution, mutation, or deployment authority", () => {
  const value = fixture();
  try {
    const proposalBefore = JSON.stringify(value.proposal);
    const priorityBefore = JSON.stringify(value.priority);
    const result = assessRemediationReadiness([value.priority], { proposals: [value.proposal] });

    // The returned surface is inert: no callable was handed back that could apply, commit,
    // deploy, trade, or otherwise act on the remediation this queue describes.
    const serialized = JSON.stringify(result);
    for (const forbidden of ["apply", "execute", "commit", "push", "merge", "deploy", "release", "order", "broker", "credential", "withdraw", "transfer"]) {
      assert.equal(serialized.toLowerCase().includes(`"${forbidden}"`), false, `readiness output must not expose a ${forbidden} field`);
    }
    const walk = (node) => {
      if (node === null || typeof node !== "object") { assert.notEqual(typeof node, "function"); return; }
      for (const entry of Object.values(node)) { assert.notEqual(typeof entry, "function"); walk(entry); }
    };
    walk(result);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.items[0]), true);

    // Inputs are untouched: assessment observes, it does not write back.
    assert.equal(JSON.stringify(value.proposal), proposalBefore);
    assert.equal(JSON.stringify(value.priority), priorityBefore);
    assertZeroAuthority(result);
  } finally { close(value); }
});
