const test = require("node:test");
const assert = require("node:assert/strict");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategyEngine.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadowOperationalRuntime.js");
const { DomainEventBus, InMemoryEvidenceSink } = require("../dist/apps/desktop/src/domainEventBus.js");

const MINUTE = 60_000;

function harness() {
  let now = 0;
  const sink = new InMemoryEvidenceSink();
  const connection = {
    marketConnectionState: "CONNECTED", reconnectAttempt: 0, reconnectStartedAt: null,
    lastMarketMessageAt: 0, lastSuccessfulReconnectAt: null,
    activeMarketListenerCount: 1, activeMarketSubscriptionCount: 1,
    reconnectTimerCount: 0, reconnectFailureReason: null
  };
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  const runtime = new ShadowOperationalRuntime({
    symbol: "KRW-BTC", strategyId: "sma-crossover", sourceCommitSha: "a".repeat(40),
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }, strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: () => undefined,
    riskGate: { evaluate: () => ({ status: "REJECT", reasonCodes: ["SHADOW_ONLY"] }) },
    getHypotheticalOrderQuantity: () => 1,
    getSafetyState: () => ({ deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false }),
    createEvidenceBus: ({ sessionId, onHalt }) => new DomainEventBus({ sessionId, sinks: [sink], onHalt }),
    findIncompleteEvidence: () => [], now: () => now,
    getMarketListenerCount: () => connection.activeMarketListenerCount,
    getMarketSubscriptionCount: () => connection.activeMarketSubscriptionCount,
    getMarketConnectionDiagnostics: () => Object.freeze({ ...connection })
  });
  const feed = (minute) => {
    now = minute * MINUTE;
    connection.lastMarketMessageAt = now;
    runtime.onTicker({ code: "KRW-BTC", trade_price: 100, trade_timestamp: now, trade_volume: 1, trade_id: `tick-${minute}` });
  };
  runtime.onWebSocketStatus("connected");
  for (let minute = 0; minute <= 20; minute += 1) feed(minute);
  return { runtime, connection, sink, setNow: (value) => { now = value; } };
}

test("A4L: a public-market disconnect pauses Shadow and a bounded recovery resumes the same session", async () => {
  const h = harness();
  const started = h.runtime.start();
  const sessionId = started.sessionId;
  h.connection.marketConnectionState = "DISCONNECTED";
  h.connection.lastMarketMessageAt = 20 * MINUTE;
  h.runtime.onWebSocketStatus("disconnected");
  assert.equal(h.runtime.diagnostics().state, "PAUSED");
  assert.equal(h.runtime.diagnostics().sessionId, sessionId);

  h.connection.marketConnectionState = "RECONNECTING";
  h.connection.reconnectAttempt = 2;
  h.connection.reconnectStartedAt = 20 * MINUTE;
  h.connection.reconnectTimerCount = 1;
  h.runtime.onWebSocketStatus("reconnecting-2-8-in-2000ms");
  assert.equal(h.runtime.diagnostics().state, "PAUSED");
  assert.equal(h.runtime.diagnostics().marketConnection.reconnectTimerCount, 1);

  h.connection.marketConnectionState = "RECOVERED";
  h.connection.reconnectTimerCount = 0;
  h.connection.lastSuccessfulReconnectAt = 20 * MINUTE + 2_000;
  h.runtime.onWebSocketStatus("recovered");
  h.connection.marketConnectionState = "CONNECTED";
  h.runtime.onWebSocketStatus("connected");
  const recovered = h.runtime.diagnostics();
  assert.equal(recovered.state, "RUNNING");
  assert.equal(recovered.sessionId, sessionId);
  assert.equal(recovered.actualOrderCount, 0);
  assert.equal(recovered.actualFillCount, 0);
  assert.equal(recovered.cashMutationCount, 0);
  assert.equal(recovered.positionMutationCount, 0);
  assert.equal(recovered.actualBrokerCallCount, 0);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();
  assert.ok(h.sink.snapshot().some((event) => event.eventType === "MARKET_CONNECTION"));
});

test("A4L: reconnect exhaustion halts the session with a deterministic timeout and zero mutations", () => {
  const h = harness();
  h.runtime.start();
  h.connection.marketConnectionState = "FAILED";
  h.connection.reconnectAttempt = 8;
  h.connection.reconnectFailureReason = "MARKET_RECONNECT_TIMEOUT";
  h.runtime.onWebSocketStatus("reconnect-exhausted");
  const result = h.runtime.diagnostics();
  assert.equal(result.state, "HALTED");
  assert.deepEqual(result.blockers, ["MARKET_RECONNECT_TIMEOUT"]);
  assert.equal(result.actualOrderCount, 0);
  assert.equal(result.actualFillCount, 0);
  assert.equal(result.cashMutationCount, 0);
  assert.equal(result.positionMutationCount, 0);
  assert.equal(result.actualBrokerCallCount, 0);
  assert.equal(result.executionGateCallCount, 0);
});

test("A4L: reconnect diagnostics report one listener, subscription, and timer at most", () => {
  const h = harness();
  h.connection.marketConnectionState = "RECONNECTING";
  h.connection.reconnectAttempt = 1;
  h.connection.reconnectTimerCount = 1;
  h.runtime.onWebSocketStatus("reconnecting-1-8-in-1000ms");
  const diagnostics = h.runtime.diagnostics().marketConnection;
  assert.equal(diagnostics.activeMarketListenerCount, 1);
  assert.equal(diagnostics.activeMarketSubscriptionCount, 1);
  assert.equal(diagnostics.reconnectTimerCount, 1);
});
