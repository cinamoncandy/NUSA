const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EventBus,
  ImprovementObserver,
  ImprovementBacklog,
  DEFAULT_IMPROVEMENT_OBSERVER_POLICY,
  detectImprovementSignal
} = require("../dist/packages/core/src/index.js");
const { MarketConnectionSupervisor } = require("../dist/packages/core/src/marketConnectionSupervisor.js");

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

test("WO-0063: reconnect instability is deterministic and suppresses one-off noise", () => {
  assert.equal(detectImprovementSignal({ ...diagnostics(), reconnectAttempt: 1 }, 1000), null);
  assert.equal(detectImprovementSignal({ ...diagnostics(), currentDowntimeMs: 29_999 }, 1000), null);
  const first = detectImprovementSignal(diagnostics(), 1000);
  const second = detectImprovementSignal(diagnostics(), 1000);
  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, "MARKET_RECONNECT_INSTABILITY|MarketConnectionSupervisor|RECONNECTING");
  assert.equal(first.severity, "MEDIUM");
});

test("WO-0063: malformed diagnostics fail closed without a signal", () => {
  const observer = new ImprovementObserver();
  const result = observer.observe({ observedAt: 1000, diagnostics: { marketConnectionState: "FAILED", reconnectAttempt: "bad" } });
  assert.equal(result.signal, null);
  assert.equal(result.candidate, null);
  assert.equal(observer.signals().length, 0);
});

test("WO-0063: equivalent signals deduplicate and cross the candidate threshold", () => {
  const observer = new ImprovementObserver();
  assert.equal(observer.observe({ observedAt: 1000, diagnostics: diagnostics() }).candidate, null);
  const candidate = observer.observe({ observedAt: 2000, diagnostics: diagnostics() }).candidate;
  assert.ok(candidate);
  assert.equal(candidate.occurrences, 2);
  assert.equal(candidate.firstSeenAt, 1000);
  assert.equal(candidate.lastSeenAt, 2000);
  assert.equal(observer.candidates().length, 1);
});

test("WO-0063: failed reconnects have a stable failure fingerprint", () => {
  const signal = detectImprovementSignal(diagnostics({
    marketConnectionState: "FAILED",
    reconnectAttempt: 10,
    reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED",
    currentDowntimeMs: 60_000
  }), 3000);
  assert.equal(signal.fingerprint, "MARKET_RECONNECT_INSTABILITY|MarketConnectionSupervisor|MAX_ATTEMPTS_EXCEEDED");
  assert.equal(signal.severity, "HIGH");
});

test("WO-0063: backlog retention is bounded deterministically", () => {
  const backlog = new ImprovementBacklog({ ...DEFAULT_IMPROVEMENT_OBSERVER_POLICY, minOccurrences: 1, maxCandidates: 2 });
  for (const [index, severity] of [[1, "MEDIUM"], [2, "HIGH"], [3, "LOW"]]) {
    backlog.record({
      id: `signal-${index}`, type: "MARKET_RECONNECT_INSTABILITY", source: "MarketConnectionSupervisor",
      fingerprint: `fingerprint-${index}`, severity, observedAt: index,
      summary: "test", evidence: { state: "RECONNECTING", reconnectAttempt: 2, reconnectAttemptLimit: 10, downtimeMs: 30_000, failureReason: null }
    });
  }
  assert.equal(backlog.size(), 2);
  assert.deepEqual(backlog.candidates().map((candidate) => candidate.fingerprint), ["fingerprint-2", "fingerprint-1"]);
});

test("WO-0063: existing supervisor remains the sole diagnostic owner and EventBus wiring is display-only", async () => {
  let now = 0;
  const supervisor = new MarketConnectionSupervisor({ now: () => now });
  supervisor.noteOpened();
  now = 1_000;
  supervisor.noteDisconnected();
  now = 2_000;
  supervisor.noteDisconnected();
  now = 31_000;
  const observer = new ImprovementObserver();
  const events = new EventBus();
  const signals = [];
  const candidates = [];
  events.subscribe("improvement.signal", (signal) => signals.push(signal));
  events.subscribe("improvement.candidate", (candidate) => candidates.push(candidate));
  const subscription = observer.attach(events);
  await events.publish("market.connection.diagnostics", { observedAt: now, diagnostics: supervisor.diagnostics() });
  now = 61_000;
  await events.publish("market.connection.diagnostics", { observedAt: now, diagnostics: supervisor.diagnostics() });
  assert.equal(supervisor.state(), "RECONNECTING");
  assert.equal(signals.length, 2);
  assert.equal(candidates.length, 1, "the second equivalent observation crosses the candidate threshold");
  subscription.unsubscribe();
  assert.equal(events.listenerCount("market.connection.diagnostics"), 0);
});
