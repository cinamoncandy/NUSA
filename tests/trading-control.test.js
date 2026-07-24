const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTradingControlCommand } = require("../dist/apps/mobile/src/tradingControl.js");

const state = (overrides = {}) => ({
  mode: "PAPER_RUNNING",
  lastAcceptedCommandAt: 100,
  processedCommandIds: [],
  ...overrides
});

const command = (overrides = {}) => ({
  id: "cmd-1",
  type: "PAUSE",
  actorId: "owner-1",
  authLevel: "STANDARD",
  issuedAt: 200,
  expiresAt: 400,
  reason: "owner requested pause",
  ...overrides
});

const context = (overrides = {}) => ({
  now: 250,
  systemHealthy: true,
  killSwitchLatched: false,
  ...overrides
});

test("pause disables trading without forcing order cancellation", () => {
  const result = applyTradingControlCommand(state(), command(), context());
  assert.equal(result.state.mode, "PAUSED");
  assert.equal(result.tradingAllowed, false);
  assert.equal(result.cancelOpenOrders, false);
  assert.equal(result.audit.commandId, "cmd-1");
});

test("emergency stop disables trading and requests open-order cancellation", () => {
  const result = applyTradingControlCommand(
    state(),
    command({ type: "EMERGENCY_STOP", reason: "risk emergency" }),
    context()
  );
  assert.equal(result.state.mode, "STOPPED");
  assert.equal(result.tradingAllowed, false);
  assert.equal(result.cancelOpenOrders, true);
});

test("paper resume requires strong authentication", () => {
  assert.throws(() => applyTradingControlCommand(
    state({ mode: "PAUSED" }),
    command({ type: "RESUME_PAPER" }),
    context()
  ), /strong authentication/);
});

test("paper resume succeeds only from paused or stopped safe state", () => {
  const result = applyTradingControlCommand(
    state({ mode: "STOPPED" }),
    command({ type: "RESUME_PAPER", authLevel: "STRONG" }),
    context()
  );
  assert.equal(result.state.mode, "PAPER_RUNNING");
  assert.equal(result.tradingAllowed, true);
});

test("paper resume fails closed when unhealthy or kill switch is latched", () => {
  for (const overrides of [{ systemHealthy: false }, { killSwitchLatched: true }]) {
    assert.throws(() => applyTradingControlCommand(
      state({ mode: "PAUSED" }),
      command({ type: "RESUME_PAPER", authLevel: "STRONG" }),
      context(overrides)
    ), /runtime safety state/);
  }
});

test("faulted state cannot be paused or resumed", () => {
  assert.throws(() => applyTradingControlCommand(state({ mode: "FAULTED" }), command(), context()), /cannot be paused/);
  assert.throws(() => applyTradingControlCommand(
    state({ mode: "FAULTED" }),
    command({ type: "RESUME_PAPER", authLevel: "STRONG" }),
    context()
  ), /runtime safety state/);
});

test("expired, future-dated, excessive-lifetime and stale commands are rejected", () => {
  assert.throws(() => applyTradingControlCommand(state(), command({ expiresAt: 240 }), context()), /expired/);
  assert.throws(() => applyTradingControlCommand(state(), command({ issuedAt: 260, expiresAt: 400 }), context()), /future-dated/);
  assert.throws(() => applyTradingControlCommand(
    state(),
    command({ expiresAt: 1_000_000 }),
    context({ maximumCommandLifetimeMs: 1_000 })
  ), /lifetime/);
  assert.throws(() => applyTradingControlCommand(
    state({ lastAcceptedCommandAt: 200 }),
    command({ issuedAt: 200 }),
    context()
  ), /stale or non-monotonic/);
});

test("duplicate command IDs and duplicate processed state IDs fail closed", () => {
  assert.throws(() => applyTradingControlCommand(
    state({ processedCommandIds: ["cmd-1"] }),
    command(),
    context()
  ), /duplicate command id/);
  assert.throws(() => applyTradingControlCommand(
    state({ processedCommandIds: ["x", "x"] }),
    command(),
    context()
  ), /must not contain duplicates/);
});

test("same input produces the same immutable decision", () => {
  const first = applyTradingControlCommand(state(), command(), context());
  const second = applyTradingControlCommand(state(), command(), context());
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state), true);
  assert.equal(Object.isFrozen(first.state.processedCommandIds), true);
  assert.equal(Object.isFrozen(first.audit), true);
});
