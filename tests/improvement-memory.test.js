const test = require("node:test");
const assert = require("node:assert/strict");

const { ImprovementObserver } = require("../dist/packages/core/src/index.js");
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

test("WO-0064: candidate history persists, recovers, and classifies recurrence", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver(undefined, memory);
    assert.equal(observer.persistenceStatus(), "AVAILABLE");
    assert.equal(observer.observe({ observedAt: 1_000, diagnostics: diagnostics() }).candidate, null);
    assert.equal(memory.size(), 1, "below-threshold observations are durable so restart can detect recurrence");
    const second = observer.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    assert.equal(second.candidate.recurrence, "RECURRING");
    assert.deepEqual(memory.load()[0].occurrenceTimestamps, [1_000, 2_000]);

    const recovered = new ImprovementObserver(undefined, memory);
    assert.equal(recovered.persistenceStatus(), "AVAILABLE");
    assert.equal(recovered.histories()[0].occurrences, 2);
    assert.equal(recovered.histories()[0].firstSeenAt, 1_000);
    assert.equal(recovered.histories()[0].lastSeenAt, 2_000);
    const duplicate = recovered.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    assert.equal(duplicate.candidate.occurrences, 2, "same fingerprint/timestamp is idempotent");
    assert.equal(memory.load()[0].occurrences, 2);
    const third = recovered.observe({ observedAt: 3_000, diagnostics: diagnostics() });
    assert.equal(third.candidate.occurrences, 3);
    assert.deepEqual(memory.load()[0].occurrenceTimestamps, [1_000, 2_000, 3_000]);
  } finally {
    db.close();
  }
});

test("WO-0064: bounded retention is deterministic and keeps the strongest records", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db, 2);
    const record = (fingerprint, score, timestamp) => ({
      id: `candidate:${fingerprint}`, fingerprint, type: "MARKET_RECONNECT_INSTABILITY", source: "MarketConnectionSupervisor",
      severity: score >= 4_000 ? "HIGH" : "MEDIUM", score, occurrences: 2, firstSeenAt: timestamp, lastSeenAt: timestamp + 1,
      occurrenceTimestamps: [timestamp, timestamp + 1], recurrence: "RECURRING", title: "Market reconnect instability detected", status: "PENDING_REVIEW"
    });
    memory.save(record("weak", 1_001, 10));
    memory.save(record("strong", 4_002, 20));
    memory.save(record("middle", 3_002, 30));
    assert.equal(memory.size(), 2);
    assert.deepEqual(memory.load().map((item) => item.fingerprint), ["strong", "middle"]);
  } finally {
    db.close();
  }
});

test("WO-0064: corrupted durable memory fails closed without emitting a candidate", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const memory = new SqliteImprovementCandidateMemory(db);
    const observer = new ImprovementObserver(undefined, memory);
    observer.observe({ observedAt: 1_000, diagnostics: diagnostics() });
    db.connection.prepare("UPDATE improvement_candidate_memory SET checksum='corrupted'").run();
    const recovered = new ImprovementObserver(undefined, memory);
    assert.equal(recovered.persistenceStatus(), "UNAVAILABLE");
    const result = recovered.observe({ observedAt: 2_000, diagnostics: diagnostics() });
    assert.equal(result.signal != null, true);
    assert.equal(result.candidate, null);
    assert.equal(result.reason, "PERSISTENCE_UNAVAILABLE");
  } finally {
    db.close();
  }
});
