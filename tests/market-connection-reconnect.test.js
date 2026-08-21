const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  MarketConnectionSupervisor,
  DEFAULT_MARKET_RECONNECT_POLICY,
  marketReconnectDelay,
  validateMarketReconnectPolicy,
  evaluateMarketFreshness
} = require("../dist/apps/desktop/src/exchange/marketConnectionSupervisor.js");
const { buildMarketConnectionEvidence } = require("../dist/apps/desktop/src/exchange/marketConnectionEvidence.js");
const { UpbitWebSocketClient } = require("../dist/apps/desktop/src/exchange/upbitWebSocket.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadow/shadowOperationalRuntime.js");
const { ShadowEvidenceArchive, verifyShadowEvidenceDirectory } = require("../dist/apps/desktop/src/shadow/shadowEvidenceArchive.js");
const { ShadowEvidenceBus, InMemoryEvidenceSink } = require("../dist/apps/desktop/src/shadow/shadowEvidenceBus.js");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { ShadowPilotRuntime } = require("../dist/apps/desktop/src/shadow/shadowPilotRuntime.js");

const SYMBOL = "KRW-BTC";
const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Supervisor: the state model and the retry policy
// ---------------------------------------------------------------------------

test("A4L: a dropped feed is detected and moves DISCONNECTED -> RECONNECTING", () => {
  let now = 1_000;
  const supervisor = new MarketConnectionSupervisor({ now: () => now });
  supervisor.noteOpened();
  assert.equal(supervisor.state(), "CONNECTED");

  now = 5_000;
  const decision = supervisor.noteDisconnected();
  assert.equal(decision.action, "RETRY");
  assert.equal(supervisor.state(), "RECONNECTING", "a retry that was scheduled is RECONNECTING, not merely DISCONNECTED");

  const diagnostics = supervisor.diagnostics();
  assert.equal(diagnostics.reconnectAttempt, 1);
  assert.equal(diagnostics.reconnectStartedAt, 5_000);
  assert.equal(diagnostics.reconnectFailureReason, null);
});

test("A4L: retries use bounded exponential backoff and an unbounded policy is rejected outright", () => {
  assert.equal(marketReconnectDelay(1), 1_000);
  assert.equal(marketReconnectDelay(2), 2_000);
  assert.equal(marketReconnectDelay(3), 4_000);
  assert.equal(marketReconnectDelay(6), 30_000);
  assert.equal(marketReconnectDelay(50), 30_000, "the delay is capped, so a long outage does not stretch to hours between tries");
  assert.throws(() => marketReconnectDelay(0), /positive safe integer/);

  assert.deepEqual(validateMarketReconnectPolicy(DEFAULT_MARKET_RECONNECT_POLICY), []);
  // "무한 재시도 금지" is enforced by the policy validator, not only by a reviewer noticing.
  for (const [override, expected] of [
    [{ maxAttempts: Number.POSITIVE_INFINITY }, "MAX_ATTEMPTS_UNBOUNDED"],
    [{ maxAttempts: 0 }, "MAX_ATTEMPTS_UNBOUNDED"],
    [{ maxTotalReconnectMs: Number.POSITIVE_INFINITY }, "MAX_RECONNECT_TIME_UNBOUNDED"]
  ]) {
    const violations = validateMarketReconnectPolicy({ ...DEFAULT_MARKET_RECONNECT_POLICY, ...override });
    assert.ok(violations.includes(expected), `${JSON.stringify(override)} -> ${JSON.stringify(violations)}`);
  }
  assert.throws(() => new MarketConnectionSupervisor({ policy: { ...DEFAULT_MARKET_RECONNECT_POLICY, maxAttempts: 0 } }), /invalid market reconnect policy/);

  let now = 0;
  const supervisor = new MarketConnectionSupervisor({ now: () => now });
  supervisor.noteOpened();
  const delays = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const decision = supervisor.noteDisconnected();
    assert.equal(decision.action, "RETRY");
    delays.push(decision.delayMs);
    now += decision.delayMs;
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
});

test("A4L: a reconnection is RECOVERED, and only real data settles it to CONNECTED", () => {
  let now = 0;
  const supervisor = new MarketConnectionSupervisor({ now: () => now });
  supervisor.noteOpened();
  now = 10_000;
  supervisor.noteDisconnected();
  now = 13_000;

  assert.equal(supervisor.noteOpened(), "RECOVERED");
  assert.equal(supervisor.state(), "RECOVERED", "an open socket that has delivered nothing is not yet a healthy feed");
  assert.equal(supervisor.diagnostics().lastSuccessfulReconnectAt, 13_000);
  assert.equal(supervisor.diagnostics().reconnectAttempt, 0, "a successful reconnection resets the attempt counter");

  now = 13_500;
  assert.equal(supervisor.noteMessage(), "CONNECTED");

  const [episode, ...rest] = supervisor.episodes();
  assert.equal(rest.length, 0);
  assert.deepEqual(
    { disconnectedAt: episode.disconnectedAt, recoveredAt: episode.recoveredAt, totalDowntime: episode.totalDowntime, finalReconnectState: episode.finalReconnectState, reconnectAttemptCount: episode.reconnectAttemptCount },
    { disconnectedAt: 10_000, recoveredAt: 13_000, totalDowntime: 3_000, finalReconnectState: "RECOVERED", reconnectAttemptCount: 1 }
  );
});

test("A4L: exceeding the attempt ceiling or the time ceiling gives up with a named reason", () => {
  let now = 0;
  const attempts = new MarketConnectionSupervisor({ now: () => now, policy: { ...DEFAULT_MARKET_RECONNECT_POLICY, maxAttempts: 3, maxTotalReconnectMs: 3_600_000 } });
  attempts.noteOpened();
  for (let index = 0; index < 3; index += 1) assert.equal(attempts.noteDisconnected().action, "RETRY");
  const exhausted = attempts.noteDisconnected();
  assert.equal(exhausted.action, "GIVE_UP");
  assert.equal(exhausted.reason, "MAX_ATTEMPTS_EXCEEDED");
  assert.equal(attempts.state(), "FAILED");
  assert.equal(attempts.episodes().at(-1).finalReconnectState, "FAILED");

  now = 0;
  const clock = new MarketConnectionSupervisor({ now: () => now, policy: { ...DEFAULT_MARKET_RECONNECT_POLICY, maxAttempts: 100, maxTotalReconnectMs: 5_000 } });
  clock.noteOpened();
  assert.equal(clock.noteDisconnected().action, "RETRY"); // +1000
  now = 4_500;
  // The ceiling is measured against when the retry would FIRE. 4500 + 2000 > 5000, so
  // arming it would schedule an attempt already known to land past the limit.
  const late = clock.noteDisconnected();
  assert.equal(late.action, "GIVE_UP");
  assert.equal(late.reason, "MAX_RECONNECT_TIME_EXCEEDED");
});

test("A4L: a stale feed is not a disconnected feed, and an unmeasurable one is neither", () => {
  let now = 100_000;
  const supervisor = new MarketConnectionSupervisor({ now: () => now });
  supervisor.noteOpened();
  supervisor.noteMessage();
  assert.equal(supervisor.noteStale(), "STALE");
  assert.equal(supervisor.episodes().length, 0, "a quiet but connected feed opens no downtime episode");
  assert.equal(supervisor.diagnostics().currentDowntimeMs, 0);
  assert.equal(supervisor.noteMessage(), "CONNECTED", "data arriving clears STALE without any reconnection");

  const tolerance = 30_000;
  assert.equal(evaluateMarketFreshness({ now: 100_000, lastMessageAt: 99_000, latestCandleCloseTime: null, toleranceMs: tolerance }), "FRESH");
  assert.equal(evaluateMarketFreshness({ now: 100_000, lastMessageAt: 10_000, latestCandleCloseTime: null, toleranceMs: tolerance }), "STALE");
  // Nothing has ever been received: that is ignorance, not staleness.
  assert.equal(evaluateMarketFreshness({ now: 100_000, lastMessageAt: null, latestCandleCloseTime: null, toleranceMs: tolerance }), "UNKNOWN");
  // A timestamp from the future makes the age negative; no honest verdict can be drawn.
  assert.equal(evaluateMarketFreshness({ now: 100_000, lastMessageAt: 900_000, latestCandleCloseTime: null, toleranceMs: tolerance }), "UNKNOWN");
  // The newer of the two sources wins: a REST candle poll covering a silent socket is fresh.
  assert.equal(evaluateMarketFreshness({ now: 100_000, lastMessageAt: 10_000, latestCandleCloseTime: 99_000, toleranceMs: tolerance }), "FRESH");
});

test("A4L: a second reconnect timer cannot be armed, and an owner stop abandons rather than recovers", () => {
  const supervisor = new MarketConnectionSupervisor();
  supervisor.noteOpened();
  supervisor.noteDisconnected();
  supervisor.armReconnectTimer();
  assert.equal(supervisor.diagnostics().reconnectTimerCount, 1);
  assert.throws(() => supervisor.armReconnectTimer(), /already armed/, "a duplicated timer must fail loudly, not double the retry rate");
  supervisor.disarmReconnectTimer();
  assert.equal(supervisor.diagnostics().reconnectTimerCount, 0);

  supervisor.noteDisconnected();
  supervisor.noteStopped();
  assert.equal(supervisor.episodes().at(-1).finalReconnectState, "ABANDONED", "stopping mid-reconnect is not a recovery and not a policy failure");
  assert.equal(supervisor.diagnostics().reconnectTimerCount, 0);
});

test("A4L: a give-up does not pretend the outage ended, and the two downtime figures agree", () => {
  let now = 0;
  const supervisor = new MarketConnectionSupervisor({ now: () => now, policy: { ...DEFAULT_MARKET_RECONNECT_POLICY, maxAttempts: 1, maxTotalReconnectMs: 3_600_000 } });
  supervisor.noteOpened();
  now = 10_000;
  supervisor.noteDisconnected();
  now = 20_000;
  assert.equal(supervisor.noteDisconnected().action, "GIVE_UP");

  now = 40_000;
  const after = supervisor.diagnostics();
  assert.equal(after.marketConnectionState, "FAILED");
  // The episode RECORD closed at the give-up; the OUTAGE did not. Reporting "(none)" and
  // zero here would tell an operator the feed is fine while it is still dead.
  assert.equal(after.reconnectStartedAt, 10_000);
  assert.equal(after.currentDowntimeMs, 30_000);
  assert.ok(after.totalDowntimeMs >= after.currentDowntimeMs, `total ${after.totalDowntimeMs} must not fall behind current ${after.currentDowntimeMs}`);
  assert.equal(after.totalDowntimeMs, 30_000, "downtime past the give-up is still counted, exactly once");
});

test("A4L: a later outage starts from a fresh retry budget, not the previous one's remainder", () => {
  let now = 0;
  const supervisor = new MarketConnectionSupervisor({ now: () => now, policy: { ...DEFAULT_MARKET_RECONNECT_POLICY, maxAttempts: 2, maxTotalReconnectMs: 3_600_000 } });
  supervisor.noteOpened();
  now = 1_000;
  supervisor.noteDisconnected();
  now = 2_000;
  supervisor.noteDisconnected();
  now = 3_000;
  supervisor.noteOpened();
  supervisor.noteMessage();

  now = 10_000;
  const second = supervisor.noteDisconnected();
  assert.equal(second.action, "RETRY", "a new outage must not inherit a spent budget and give up on its first try");
  assert.equal(second.attempt, 1);
  assert.equal(second.delayMs, 1_000, "backoff restarts from the beginning for a new outage");
});

// ---------------------------------------------------------------------------
// Transport: one socket, one timer, no duplicated listeners or subscriptions
// ---------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1; // WebSocket.OPEN
    this.sent = [];
    this.closed = false;
  }
  send(payload) { this.sent.push(payload); }
  close() { this.closed = true; }
}

function makeClient(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sockets = [];
  const statuses = [];
  const states = [];
  const client = new UpbitWebSocketClient(
    SYMBOL,
    () => undefined,
    (status) => statuses.push(status),
    5,
    30_000,
    {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onConnectionState: (diagnostics) => states.push(diagnostics)
    }
  );
  return { client, sockets, statuses, states };
}

test("A4L: reconnecting releases the previous socket instead of stacking listeners or subscriptions", (t) => {
  const { client, sockets, states } = makeClient(t);
  client.start();
  assert.equal(sockets.length, 1);
  sockets[0].emit("open");
  assert.equal(client.connectionDiagnostics().activeMarketListenerCount, 1);
  assert.equal(client.connectionDiagnostics().activeMarketSubscriptionCount, 1);

  sockets[0].emit("close");
  t.mock.timers.tick(1_000);
  assert.equal(sockets.length, 2, "exactly one new socket per retry");
  sockets[1].emit("open");

  assert.equal(sockets[0].listenerCount("message"), 0, "the replaced socket keeps no listener that would deliver each ticker twice");
  assert.equal(sockets[0].closed, true, "the replaced socket is closed, not merely forgotten");
  assert.equal(client.connectionDiagnostics().activeMarketListenerCount, 1, "one live connection, not two");
  assert.equal(client.connectionDiagnostics().activeMarketSubscriptionCount, 1);
  assert.ok(states.some((state) => state.marketConnectionState === "RECOVERED"), "the structured callback reports the recovery");

  client.stop();
});

test("A4L: exactly one reconnect timer exists at a time, and it is cleared once it fires", (t) => {
  const { client, sockets } = makeClient(t);
  client.start();
  sockets[0].emit("open");

  sockets[0].emit("close");
  assert.equal(client.connectionDiagnostics().reconnectTimerCount, 1);
  // A close from the socket that was already replaced must not arm a second timer.
  sockets[0].emit("close");
  assert.equal(client.connectionDiagnostics().reconnectTimerCount, 1, "a stale socket's close is ignored");

  t.mock.timers.tick(1_000);
  assert.equal(client.connectionDiagnostics().reconnectTimerCount, 0, "the timer is disarmed when it fires, not left counted forever");
  assert.equal(sockets.length, 2);

  client.stop();
  assert.equal(client.connectionDiagnostics().reconnectTimerCount, 0);
});

test("A4L: the transport stops retrying at the configured ceiling and says so", (t) => {
  const { client, sockets, statuses } = makeClient(t);
  client.start();
  sockets[0].emit("open");
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    sockets.at(-1).emit("close");
    t.mock.timers.tick(60_000);
  }
  sockets.at(-1).emit("close");
  assert.equal(client.connectionDiagnostics().marketConnectionState, "FAILED");
  assert.equal(client.connectionDiagnostics().reconnectFailureReason, "MAX_ATTEMPTS_EXCEEDED");
  assert.ok(statuses.includes("reconnect-exhausted"));
  assert.equal(client.connectionDiagnostics().reconnectTimerCount, 0, "nothing is left armed after giving up");
  // A client that abandoned the feed has nothing left to judge freshness of. Leaving the
  // staleness heartbeat running would keep a live timer that no diagnostic counts.
  assert.equal(client.activeTimerCount(), 0, "the heartbeat is released on give-up, not left running");
  client.stop();
  assert.equal(client.activeTimerCount(), 0);
});

// ---------------------------------------------------------------------------
// Shadow session behaviour across an outage
// ---------------------------------------------------------------------------

function connectionState(overrides = {}) {
  return Object.assign({
    marketConnectionState: "CONNECTED",
    reconnectAttempt: 0,
    reconnectAttemptLimit: DEFAULT_MARKET_RECONNECT_POLICY.maxAttempts,
    reconnectStartedAt: null,
    lastMarketMessageAt: null,
    lastSuccessfulReconnectAt: null,
    activeMarketListenerCount: 1,
    activeMarketSubscriptionCount: 1,
    reconnectTimerCount: 0,
    reconnectFailureReason: null,
    currentDowntimeMs: 0,
    totalDowntimeMs: 0,
    episodes: []
  }, overrides);
}

function makeRuntime(overrides = {}) {
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  const productionSignals = [];
  const finalized = [];
  let now = 0;
  const recordingSink = {
    name: "recording",
    deliver() {},
    finalize(reason, status, completion, marketConnection) { finalized.push({ reason, status, completion, marketConnection }); }
  };
  const runtime = new ShadowOperationalRuntime(Object.assign({
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    sourceCommitSha: "b".repeat(40),
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: (input) => productionSignals.push(input),
    riskGate: { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) },
    getHypotheticalOrderQuantity: () => 1,
    createEvidenceBus: ({ sessionId, onHalt }) => new ShadowEvidenceBus({ sessionId, sinks: [new InMemoryEvidenceSink(), recordingSink], onHalt }),
    findIncompleteEvidence: () => [],
    getSafetyState: () => ({ deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false }),
    now: () => now,
    autoResumeOnMarketRecovery: true
  }, overrides));

  const feed = (minuteIndex, price, suffix = "a") => {
    now = minuteIndex * MINUTE;
    runtime.onTicker({ code: SYMBOL, trade_price: price, trade_timestamp: minuteIndex * MINUTE, trade_volume: 1, trade_id: `t-${minuteIndex}-${suffix}` });
  };
  return {
    runtime, productionSignals, finalized,
    setNow: (value) => { now = value; },
    getNow: () => now,
    feed,
    connect: () => {
      runtime.onMarketConnectionState(connectionState());
      runtime.onWebSocketStatus("connected");
    },
    warmUp: (flatPrice = 100) => {
      runtime.onMarketConnectionState(connectionState());
      runtime.onWebSocketStatus("connected");
      for (let minute = 0; minute <= 20; minute += 1) feed(minute, flatPrice);
    },
    /** A tick opens a bucket; the NEXT tick closes it. Two are needed to close AT `price`. */
    crossover: (minuteIndex, price) => { feed(minuteIndex, price, "x1"); feed(minuteIndex + 1, price, "x2"); }
  };
}

test("A4L: a dropped feed puts the session into a safe wait, keeping the same sessionId", () => {
  const h = makeRuntime();
  h.warmUp();
  const started = h.runtime.start();
  assert.equal(started.state, "RUNNING");
  const sessionId = started.sessionId;
  assert.notEqual(sessionId, null);

  h.setNow(30 * MINUTE);
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECONNECTING", reconnectAttempt: 1, reconnectStartedAt: 30 * MINUTE, reconnectTimerCount: 1 }));
  h.runtime.onWebSocketStatus("reconnecting-in-1000ms");

  const paused = h.runtime.diagnostics();
  assert.equal(paused.state, "PAUSED", "an outage is a wait, not an immediate failure");
  assert.equal(paused.sessionId, sessionId, "the session is not restarted, so its archive stays one session");
  assert.equal(paused.marketDataStatus, "RECONNECTING");
  assert.ok(paused.blockers.includes("MARKET_DATA_RECONNECTING"));
  assert.equal(paused.marketConnection.reconnectTimerCount, 1);
});

test("A4L: no signal is dispatched while the feed is down, and dispatch resumes after recovery", () => {
  const h = makeRuntime();
  h.warmUp();
  const sessionId = h.runtime.start().sessionId;
  assert.equal(h.runtime.diagnostics().signalCount, 0);

  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECONNECTING", reconnectAttempt: 1, reconnectStartedAt: 21 * MINUTE, reconnectTimerCount: 1 }));
  h.runtime.onWebSocketStatus("reconnecting-in-1000ms");
  assert.equal(h.runtime.diagnostics().state, "PAUSED");

  // A crossover-sized move while the feed is judged down must produce no Shadow signal.
  h.crossover(22, 100_000);
  assert.equal(h.runtime.diagnostics().signalCount, 0, "a paused session generates no observation");
  assert.equal(h.runtime.diagnostics().state, "PAUSED");

  h.runtime.onMarketConnectionState(connectionState({
    marketConnectionState: "RECOVERED",
    lastSuccessfulReconnectAt: 24 * MINUTE,
    lastMarketMessageAt: 24 * MINUTE,
    episodes: [{ episodeId: 1, disconnectedAt: 21 * MINUTE, reconnectAttemptCount: 2, recoveredAt: 24 * MINUTE, totalDowntime: 3 * MINUTE, finalReconnectState: "RECOVERED", failureReason: null }]
  }));
  h.runtime.onWebSocketStatus("connected");
  assert.equal(h.runtime.diagnostics().state, "PAUSED", "an open socket alone does not resume anything");

  h.feed(25, 100_000, "r");
  const resumed = h.runtime.diagnostics();
  assert.equal(resumed.state, "RUNNING", "real market data plus a clean precheck resumes the session");
  assert.equal(resumed.sessionId, sessionId, "resumption keeps the SAME session, not a new one");

  h.crossover(26, 1_000);
  assert.ok(h.runtime.diagnostics().signalCount > 0, "signal processing is genuinely back, not merely the state label");
});

test("A4L: auto-resume is opt-in and never clears a stale, drifted, or owner-requested pause", () => {
  const off = makeRuntime({ autoResumeOnMarketRecovery: false });
  off.warmUp();
  off.runtime.start();
  off.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECONNECTING", reconnectAttempt: 1, reconnectStartedAt: 21 * MINUTE }));
  off.runtime.onWebSocketStatus("reconnecting-in-1000ms");
  off.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED" }));
  off.runtime.onWebSocketStatus("connected");
  off.feed(22, 100, "z");
  assert.equal(off.runtime.diagnostics().state, "PAUSED", "the runtime resumes nothing unless a caller asked for it");
  assert.equal(off.runtime.diagnostics().marketRecoveryResumeAllowed, false);

  const stale = makeRuntime();
  stale.warmUp();
  stale.runtime.start();
  stale.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "STALE" }));
  stale.runtime.onWebSocketStatus("stale-40000ms");
  assert.equal(stale.runtime.diagnostics().state, "PAUSED");
  stale.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED" }));
  stale.runtime.onWebSocketStatus("connected");
  stale.feed(22, 100, "z");
  assert.equal(stale.runtime.diagnostics().state, "PAUSED", "a feed that went quiet while connected is not cleared by data resuming");
  assert.equal(stale.runtime.diagnostics().marketRecoveryResumeSuggested, false);

  const owner = makeRuntime();
  owner.warmUp();
  owner.runtime.start();
  owner.runtime.pause();
  owner.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED" }));
  owner.feed(22, 100, "z");
  assert.equal(owner.runtime.diagnostics().state, "PAUSED", "only the owner undoes an owner pause");
});

test("A4L: an exhausted reconnect ends the session as MARKET_RECONNECT_TIMEOUT", () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.setNow(40 * MINUTE);
  h.runtime.onMarketConnectionState(connectionState({
    marketConnectionState: "FAILED",
    reconnectAttempt: 10,
    reconnectFailureReason: "MAX_ATTEMPTS_EXCEEDED",
    reconnectStartedAt: 30 * MINUTE,
    episodes: [{ episodeId: 1, disconnectedAt: 30 * MINUTE, reconnectAttemptCount: 10, recoveredAt: null, totalDowntime: 10 * MINUTE, finalReconnectState: "FAILED", failureReason: "MAX_ATTEMPTS_EXCEEDED" }]
  }));
  const halted = h.runtime.diagnostics();
  assert.equal(halted.state, "HALTED", "a feed that never came back ends the observation rather than waiting forever");
  assert.ok(halted.blockers.includes("MARKET_RECONNECT_TIMEOUT"));
  assert.ok(halted.blockers.includes("MAX_ATTEMPTS_EXCEEDED"), "the specific ceiling that was hit stays visible");
});

test("A4L: every real-mutation counter stays zero across an outage, a recovery, and a give-up", async () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECONNECTING", reconnectAttempt: 1, reconnectStartedAt: 21 * MINUTE }));
  h.runtime.onWebSocketStatus("reconnecting-in-1000ms");
  h.crossover(22, 100_000);
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED", lastMarketMessageAt: 24 * MINUTE }));
  h.runtime.onWebSocketStatus("connected");
  h.feed(25, 100_000, "m");
  h.crossover(26, 1_000);

  const during = h.runtime.diagnostics();
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();
  const after = h.runtime.diagnostics();

  for (const snapshot of [during, after]) {
    assert.equal(snapshot.actualOrderCount, 0);
    assert.equal(snapshot.actualFillCount, 0);
    assert.equal(snapshot.cashMutationCount, 0);
    assert.equal(snapshot.positionMutationCount, 0);
    assert.equal(snapshot.actualBrokerCallCount, 0);
    assert.equal(snapshot.executionGateCallCount, 0);
    assert.equal(snapshot.longRunning.privateApiCallCount, 0);
    assert.equal(snapshot.productionMutationAllowed, false);
  }
});

test("A4L: the minute being assembled when the feed drops is discarded, not spliced across the gap", () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.feed(21, 100, "pre"); // closes minute 20 and OPENS minute 21
  const before = h.runtime.diagnostics().closedCandleCount;

  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECONNECTING", reconnectAttempt: 1, reconnectStartedAt: 21 * MINUTE + 30_000 }));
  h.runtime.onWebSocketStatus("reconnecting-in-1000ms");
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED" }));
  h.runtime.onWebSocketStatus("connected");
  h.feed(22, 100, "post"); // would have CLOSED minute 21 had the half-built candle survived

  assert.equal(h.runtime.diagnostics().closedCandleCount, before, "a candle built from both sides of an outage is not a minute of trading");
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

test("A4L: connection transitions are sealed as separate evidence, including 'never dropped'", async () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.runtime.onMarketConnectionState(connectionState({
    marketConnectionState: "CONNECTED",
    lastSuccessfulReconnectAt: 24 * MINUTE,
    episodes: [{ episodeId: 1, disconnectedAt: 21 * MINUTE, reconnectAttemptCount: 3, recoveredAt: 24 * MINUTE, totalDowntime: 3 * MINUTE, finalReconnectState: "RECOVERED", failureReason: null }]
  }));
  h.setNow(30 * MINUTE);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();

  const sealed = h.finalized.at(-1).marketConnection;
  assert.ok(sealed, "a sealed session carries its connection record");
  assert.equal(sealed.disconnectedAt, 21 * MINUTE);
  assert.equal(sealed.reconnectAttemptCount, 3);
  assert.equal(sealed.recoveredAt, 24 * MINUTE);
  assert.equal(sealed.totalDowntime, 3 * MINUTE);
  assert.equal(sealed.finalReconnectState, "RECOVERED");
  assert.equal(sealed.episodeCount, 1);

  const clean = makeRuntime();
  clean.warmUp();
  clean.runtime.start();
  clean.runtime.stop();
  await clean.runtime.awaitEvidenceFinalized();
  const quiet = clean.finalized.at(-1).marketConnection;
  assert.equal(quiet.episodeCount, 0);
  assert.equal(quiet.finalReconnectState, "NEVER_DISCONNECTED", "an uninterrupted session says so, rather than claiming a recovery it never made");
  assert.equal(quiet.totalDowntime, 0);
});

test("A4L: each closed outage also lands in the pilot hash chain, exactly once", async () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  const episode = { episodeId: 1, disconnectedAt: 21 * MINUTE, reconnectAttemptCount: 2, recoveredAt: 24 * MINUTE, totalDowntime: 3 * MINUTE, finalReconnectState: "RECOVERED", failureReason: null };
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "RECOVERED", episodes: [episode] }));
  // Re-reporting the same episode must not append a second event: the chain would then
  // record two outages where the transport saw one.
  h.runtime.onMarketConnectionState(connectionState({ marketConnectionState: "CONNECTED", episodes: [episode] }));
  h.setNow(30 * MINUTE);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();

  const events = h.finalized.at(-1) && h.runtime.marketConnectionEpisodes();
  assert.equal(events.length, 1, "the episode is recorded once, however often it is reported");
  const sealed = h.finalized.at(-1).marketConnection;
  assert.equal(sealed.episodeCount, 1, "the summary file and the chain describe the same single outage");
  assert.equal(sealed.totalDowntime, 3 * MINUTE);
});

test("A4L: an earlier session's outage is never attributed to the next session", () => {
  const evidence = buildMarketConnectionEvidence({
    sessionId: "s-1",
    generatedAt: 10,
    episodes: [
      { episodeId: 2, disconnectedAt: 200, reconnectAttemptCount: 1, recoveredAt: 250, totalDowntime: 50, finalReconnectState: "RECOVERED", failureReason: null },
      { episodeId: 1, disconnectedAt: 100, reconnectAttemptCount: 2, recoveredAt: null, totalDowntime: 40, finalReconnectState: "FAILED", failureReason: "MAX_ATTEMPTS_EXCEEDED" }
    ]
  });
  assert.deepEqual(evidence.episodes.map((episode) => episode.episodeId), [1, 2], "episodes are ordered, so the record reads chronologically");
  assert.equal(evidence.reconnectAttemptCount, 3);
  assert.equal(evidence.totalDowntime, 90);
  assert.equal(evidence.recoveredAt, 250);
  assert.equal(evidence.finalReconnectState, "RECOVERED");
});

test("A4L: the connection record is bound to the manifest and existing evidence still verifies", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "a4l-archive-"));
  try {
    const sessionId = "shadow-a4l-1";
    const fingerprints = { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" };
    const archive = await ShadowEvidenceArchive.create(root, {
      sessionId, createdAt: 1, sourceCommitSha: "c".repeat(40), symbol: SYMBOL,
      strategyId: "sma-crossover", strategyVersion: "v1", controlOrigin: "LOCAL_INTERACTIVE_UI",
      authenticatedOwner: false, fingerprints
    });
    // A real event log, so the new side record is proven not to disturb the existing chain.
    const pilot = new ShadowPilotRuntime({ sessionId, createdAt: 1, sourceCommitSha: "c".repeat(40), symbol: SYMBOL, strategyId: "sma-crossover", fingerprints });
    pilot.precheck({ paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false });
    pilot.start(2);
    pilot.stop(3);
    for (const event of pilot.eventLog()) await archive.append(event, 4);
    const marketConnection = buildMarketConnectionEvidence({
      sessionId, generatedAt: 5,
      episodes: [{ episodeId: 1, disconnectedAt: 2, reconnectAttemptCount: 1, recoveredAt: 3, totalDowntime: 1, finalReconnectState: "RECOVERED", failureReason: null }]
    });
    const manifest = await archive.finalize("OWNER_STOPPED", 6, "COMPLETED", undefined, marketConnection);

    const directory = path.join(root, sessionId);
    assert.ok(fs.existsSync(path.join(directory, "market-connection.json")), "the transport's record is its own file, never mixed into the event log");
    assert.ok(fs.existsSync(path.join(directory, "events.ndjson")), "the existing event log is untouched");
    assert.ok(typeof manifest.marketConnectionSha256 === "string" && manifest.marketConnectionSha256.length === 64);

    const verified = await verifyShadowEvidenceDirectory(directory, 7);
    assert.deepEqual(verified.blockers.filter((code) => code.startsWith("MARKET_CONNECTION")), [], JSON.stringify(verified.blockers));

    // A record edited after sealing must be caught by the same binding that proves it intact.
    const tampered = JSON.parse(fs.readFileSync(path.join(directory, "market-connection.json"), "utf8"));
    tampered.totalDowntime = 0;
    fs.writeFileSync(path.join(directory, "market-connection.json"), `${JSON.stringify(tampered)}\n`);
    const recheck = await verifyShadowEvidenceDirectory(directory, 8);
    assert.ok(recheck.blockers.includes("MARKET_CONNECTION_EVIDENCE_MISMATCH"), JSON.stringify(recheck.blockers));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Static safety
// ---------------------------------------------------------------------------

test("A4L: the reconnect path adds no order, authenticated endpoint, or credential", () => {
  const files = ["marketConnectionSupervisor.ts", "marketConnectionEvidence.ts", "upbitWebSocket.ts"];
  // Presence, not absence: a scan can only prove that a known pattern IS there. That is
  // enough to catch an order path or a credential being introduced here by a later edit.
  const forbidden = [
    /access_key/i, /secret_key/i, /\bjwt\b/i, /Authorization\s*:/i,
    /\/v1\/orders?\b/i, /\/v1\/accounts\b/i, /placeOrder|submitOrder|createOrder/i,
    /PaperBroker|manualOrder|automaticSignal/
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "exchange", file), "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} must not reach ${pattern}`);
  }
  // apps/desktop/src/exchange/upbitWebSocket.ts is a re-export shim; the real source lives in
  // packages/core, shared with apps/cloud/src.
  const transport = fs.readFileSync(path.join(__dirname, "..", "packages", "core", "src", "upbitWebSocket.ts"), "utf8");
  assert.match(transport, /wss:\/\/api\.upbit\.com\/websocket\/v1/, "the only endpoint remains the public ticker stream");
  const supervisor = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "exchange", "marketConnectionSupervisor.ts"), "utf8");
  assert.doesNotMatch(supervisor, /setInterval|setTimeout|require\(|https?:/, "the supervisor owns no timer and reaches no network; the transport owns the single timer");
});

test("A4L: the operator procedure documents the reconnect behaviour it now has", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "operations", "shadow-long-running-observation.md"), "utf8");
  for (const needle of ["재연결", "MARKET_RECONNECT_TIMEOUT", "연결 복구됨"]) {
    assert.ok(doc.includes(needle), `the procedure must mention ${needle}`);
  }
});
