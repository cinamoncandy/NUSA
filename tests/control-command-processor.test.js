const test = require("node:test");
const assert = require("node:assert/strict");
const { processControlCommand } = require("../dist/apps/cloud/src/controlCommandProcessor.js");

const runtime = (overrides = {}) => ({ mode: "STOPPED", killSwitchActive: false, healthy: true, ...overrides });
const request = (overrides = {}) => ({
  id: "cmd-1",
  userId: "user-1",
  deviceId: "device-1",
  type: "RESUME_PAPER",
  issuedAt: 100,
  expiresAt: 200,
  authStrength: "STRONG",
  reason: "owner request",
  ...overrides
});
const state = (overrides = {}) => ({ runtime: runtime(), processedCommandIds: new Set(), ...overrides });

test("accepts strongly authenticated paper resume", () => {
  const result = processControlCommand({ now: 150, request: request(), state: state() });
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.runtime.mode, "PAPER");
  assert.equal(result.audit.resultingMode, "PAPER");
});

test("rejects weakly authenticated resume", () => {
  const result = processControlCommand({ now: 150, request: request({ authStrength: "SESSION" }), state: state() });
  assert.equal(result.status, "REJECTED");
  assert.match(result.audit.reason, /strong authentication/);
});

test("emergency stop activates kill switch and requests cancellation", () => {
  const result = processControlCommand({
    now: 150,
    request: request({ type: "EMERGENCY_STOP", authStrength: "SESSION" }),
    state: state({ runtime: runtime({ mode: "PAPER" }) })
  });
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.runtime.mode, "STOPPED");
  assert.equal(result.runtime.killSwitchActive, true);
  assert.equal(result.audit.cancelOpenOrders, true);
});

test("rejects expired, future, and out-of-order commands", () => {
  assert.equal(processControlCommand({ now: 201, request: request(), state: state() }).status, "REJECTED");
  assert.throws(() => processControlCommand({ now: 99, request: request(), state: state() }), /future-issued/);
  const ordered = state({ runtime: runtime({ lastAcceptedCommandAt: 100 }) });
  assert.equal(processControlCommand({ now: 150, request: request({ issuedAt: 100 }), state: ordered }).status, "REJECTED");
});

test("deduplicates commands without changing runtime", () => {
  const current = runtime({ mode: "PAPER" });
  const result = processControlCommand({
    now: 150,
    request: request(),
    state: state({ runtime: current, processedCommandIds: new Set(["cmd-1"]) })
  });
  assert.equal(result.status, "DUPLICATE");
  assert.deepEqual(result.runtime, current);
});

test("fails closed when runtime cannot resume", () => {
  for (const unsafe of [
    runtime({ healthy: false }),
    runtime({ killSwitchActive: true }),
    runtime({ mode: "FAULTED" })
  ]) {
    const result = processControlCommand({ now: 150, request: request(), state: state({ runtime: unsafe }) });
    assert.equal(result.status, "REJECTED");
    assert.notEqual(result.runtime.mode, "PAPER");
  }
});

test("is deterministic and immutable", () => {
  const input = { now: 150, request: request({ type: "PAUSE", authStrength: "SESSION" }), state: state({ runtime: runtime({ mode: "PAPER" }) }) };
  const first = processControlCommand(input);
  const second = processControlCommand(input);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.runtime), true);
  assert.equal(Object.isFrozen(first.audit), true);
});
