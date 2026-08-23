const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ImprovementObserver,
  prepareRootCauseHypotheses,
  rankRootCauseEvidence,
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
  reconnectFailureReason: null,
  currentDowntimeMs: 30_000,
  totalDowntimeMs: 30_000,
  episodes: [],
  ...overrides
});

test("WO-0066: evidence ranking is deterministic and exposes observable reasons", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const observer = new ImprovementObserver(undefined, new SqliteImprovementCandidateMemory(db));
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics({ reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED" }) });
    const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics({
      marketConnectionState: "FAILED",
      reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED",
      reconnectAttempt: 10,
      currentDowntimeMs: 90_000,
      totalDowntimeMs: 90_000
    }) });
    const bundle = result.evidenceBundle;
    const ranked = rankRootCauseEvidence(bundle);
    assert.equal(bundle.status, "CORRELATED");
    assert.deepEqual(ranked, bundle.rankedEvidence);
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[0].evidenceId, result.candidate.evidence[1].id);
    assert.ok(ranked[0].reasonCodes.includes("STATE_FAILED"));
    assert.ok(ranked[0].reasonCodes.includes("FAILURE_REASON_PRESENT"));
    assert.ok(ranked[0].factors.every((item) => Number.isSafeInteger(item.points)));
    assert.deepEqual(rankRootCauseEvidence(bundle), ranked);
  } finally {
    db.close();
  }
});

test("WO-0066: tie-breaking and hypothesis identities are stable", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const observer = new ImprovementObserver(undefined, new SqliteImprovementCandidateMemory(db));
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics({ reconnectAttempt: 2, reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED" }) });
    const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics({ reconnectAttempt: 2, reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED" }) });
    const first = prepareRootCauseHypotheses(result.evidenceBundle);
    const second = prepareRootCauseHypotheses(result.evidenceBundle);
    assert.deepEqual(first, second);
    assert.ok(first.length <= 3);
    assert.ok(first.every((item) => item.status === "EVIDENCE_BOUND"));
    assert.ok(first.every((item) => item.unresolvedCodes.includes("CAUSALITY_UNRESOLVED")));
    assert.ok(first.every((item) => !item.statement.toLowerCase().includes("must")));
  } finally {
    db.close();
  }
});

test("WO-0066: contradiction and insufficiency fail closed", () => {
  assert.equal(prepareRootCauseHypotheses(null)[0].status, "BLOCKED");
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver(undefined, memory);
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
    const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    const contradictoryEvidence = { ...result.candidate.evidence[0], fingerprint: "different-fingerprint", id: "contradiction" };
    const contradictory = correlateRootCauseEvidence(result.candidate, [contradictoryEvidence]);
    assert.equal(contradictory.status, "CONTRADICTORY");
    assert.equal(rankRootCauseEvidence(contradictory).length, 0);
    assert.equal(prepareRootCauseHypotheses(contradictory)[0].status, "BLOCKED");

    const insufficient = correlateRootCauseEvidence(result.candidate, [], { maxEvidence: 1 });
    assert.equal(insufficient.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(rankRootCauseEvidence(insufficient).length, 0);
    assert.equal(prepareRootCauseHypotheses(insufficient)[0].status, "UNRESOLVED");
  } finally {
    db.close();
  }
});

test("WO-0066: ranking and hypothesis fan-out are bounded", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const observer = new ImprovementObserver({ minReconnectAttempts: 2, minDowntimeMs: 30_000, minOccurrences: 2, maxSignals: 64, maxCandidates: 64 }, new SqliteImprovementCandidateMemory(db));
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics({ reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED" }) });
    const result = observer.observe({ observedAt: 2_000, diagnostics: diagnostics({ reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED" }) });
    assert.ok(rankRootCauseEvidence(result.evidenceBundle, { maxRankedEvidence: 1 }).length <= 1);
    assert.ok(prepareRootCauseHypotheses(result.evidenceBundle, { maxRankedEvidence: 2, maxHypotheses: 1 }).length <= 1);
  } finally {
    db.close();
  }
});
