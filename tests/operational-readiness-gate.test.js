const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateOperationalReadiness } = require("../dist/apps/cloud/src/operationalReadinessGate.js");

const input = (overrides = {}) => ({
  now: 1_000, mode: "PAPER", killSwitchActive: false, recoveryUnresolved: false,
  strategySuspended: false, dataFingerprintMatches: true, marketDataObservedAt: 990,
  maximumDataAgeMs: 100, warmupSamples: 100, requiredWarmupSamples: 100,
  reconnectCooldownMs: 50, ...overrides
});

test("allows new PAPER entries only after warmup with fresh data", () => {
  const result = evaluateOperationalReadiness(input());
  assert.equal(result.action, "ALLOW_NEW_ENTRIES");
  assert.equal(result.ready, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("warmup, stale data, fingerprint drift and protection lock allow exits only", () => {
  for (const overrides of [
    { warmupSamples: 99 },
    { marketDataObservedAt: 800 },
    { dataFingerprintMatches: false },
    { protectionLockedUntil: 1_100 }
  ]) assert.equal(evaluateOperationalReadiness(input(overrides)).action, "ALLOW_EXIT_ONLY");
});

test("disconnect halts and reconnect requires a cooldown", () => {
  assert.equal(evaluateOperationalReadiness(input({ disconnectedAt: 900 })).action, "HALT");
  assert.equal(evaluateOperationalReadiness(input({ disconnectedAt: 900, reconnectedAt: 980 })).action, "ALLOW_EXIT_ONLY");
  assert.equal(evaluateOperationalReadiness(input({ disconnectedAt: 900, reconnectedAt: 940 })).action, "ALLOW_NEW_ENTRIES");
});

test("kill switch, unresolved recovery and non-paper mode halt", () => {
  assert.equal(evaluateOperationalReadiness(input({ killSwitchActive: true })).action, "HALT");
  assert.equal(evaluateOperationalReadiness(input({ recoveryUnresolved: true })).action, "HALT");
  assert.equal(evaluateOperationalReadiness(input({ mode: "STOPPED" })).action, "HALT");
});

test("same input is deterministic and invalid timestamps fail closed", () => {
  assert.deepEqual(evaluateOperationalReadiness(input()), evaluateOperationalReadiness(input()));
  assert.throws(() => evaluateOperationalReadiness(input({ marketDataObservedAt: 1_001 })), /future/);
});
