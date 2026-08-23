const test = require("node:test");
const assert = require("node:assert/strict");

const { ImprovementObserver, correlateRootCauseEvidence } = require("../dist/packages/core/src/index.js");
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

test("WO-0065: recurrent persisted diagnostics produce deterministic evidence bundle and recover after restart", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver(undefined, memory);
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
    const second = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    assert.equal(second.evidenceBundle.status, "CORRELATED");
    assert.equal(second.evidenceBundle.confidence, 1);
    assert.deepEqual(second.evidenceBundle.provenance.map((item) => item.observedAt), [1_000, 2_000]);
    assert.equal(second.evidenceBundle.id, `root-cause:${second.candidate.fingerprint}`);

    const recovered = new ImprovementObserver(undefined, memory);
    const bundle = recovered.rootCauseEvidence(second.candidate.fingerprint);
    assert.deepEqual(bundle, second.evidenceBundle);
  } finally {
    db.close();
  }
});

test("WO-0065: contradictory evidence fails closed without inferring a cause", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver(undefined, memory);
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
    const second = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    const contradictory = { ...second.candidate.evidence[0], id: "conflicting-evidence", fingerprint: "MARKET_RECONNECT_INSTABILITY|MarketConnectionSupervisor|OTHER" };
    const bundle = correlateRootCauseEvidence(second.candidate, [contradictory]);
    assert.equal(bundle.status, "CONTRADICTORY");
    assert.equal(bundle.confidence, null);
    assert.ok(bundle.contradictionCodes.includes("EVIDENCE_FINGERPRINT_MISMATCH"));
  } finally {
    db.close();
  }
});

test("WO-0065: evidence fan-out is bounded and duplicate evidence is idempotent", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver({ minOccurrences: 2, maxSignals: 32, maxCandidates: 64, minReconnectAttempts: 2, minDowntimeMs: 30_000 }, memory);
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
    observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    const duplicate = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    const bounded = correlateRootCauseEvidence(duplicate.candidate, [], { maxEvidence: 1 });
    assert.equal(duplicate.candidate.occurrences, 2);
    assert.equal(bounded.evidence.length, 1);
    assert.equal(bounded.status, "INSUFFICIENT_EVIDENCE");
    assert.ok(bounded.contradictionCodes.includes("EVIDENCE_FANOUT_BOUNDED"));
    assert.ok(bounded.contradictionCodes.includes("EVIDENCE_MISSING_FOR_OCCURRENCE"));
  } finally {
    db.close();
  }
});
