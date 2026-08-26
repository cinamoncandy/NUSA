const test = require("node:test");
const assert = require("node:assert/strict");
const { readPaperAutoLearningReadiness, PAPER_AUTO_LEARNING_MAX_OBSERVATION_AGE_MS } = require("../dist/apps/cloud/src/liveReadinessRuntimeReaders.js");
const { readCloudRuntimeSafety } = require("../dist/apps/cloud/src/liveReadinessRuntimeReaders.js");

const now = 1_000_000;
const state = { now, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY" };
const heartbeat = (lastMarketEventAt = now - 1_000, lastError = null) => ({ lastMarketEventAt, lastError });
const evidence = (overrides = {}) => ({ configured: true, publicMarketDataEnabled: true, connectionState: "CONNECTED", state, heartbeat: heartbeat(), ...overrides });

test("production PAPER readiness reader maps the canonical healthy runtime to STABLE", () => {
  const result = readPaperAutoLearningReadiness(evidence(), now);
  assert.equal(result.value, "STABLE");
  assert.equal(result.freshness, "FRESH");
  assert.equal(result.observedAt, new Date(now - 1_000).toISOString());
});

test("PAPER readiness reader fails closed for missing setup, disabled market data, or missing observation", () => {
  for (const overrides of [
    { configured: false },
    { publicMarketDataEnabled: false },
    { heartbeat: heartbeat(null) },
  ]) {
    const result = readPaperAutoLearningReadiness(evidence(overrides), now);
    assert.deepEqual(result, { value: "UNKNOWN", freshness: "UNKNOWN" });
  }
});

test("PAPER readiness reader reports stale, failed, disconnected, and unsafe runtime evidence", () => {
  const stale = readPaperAutoLearningReadiness(evidence({ heartbeat: heartbeat(now - PAPER_AUTO_LEARNING_MAX_OBSERVATION_AGE_MS - 1) }), now);
  assert.equal(stale.value, "UNSTABLE");
  assert.equal(stale.freshness, "STALE");
  for (const overrides of [
    { connectionState: "DISCONNECTED" },
    { heartbeat: heartbeat(now - 1_000, "PAPER_EXECUTION_FAILED") },
    { state: { ...state, overallHealth: "DEGRADED" } },
    { state: { ...state, killSwitchActive: true } },
  ]) assert.equal(readPaperAutoLearningReadiness(evidence(overrides), now).value, "UNSTABLE");
});

test("PAPER readiness reader is deterministic and read-only", () => {
  const input = evidence();
  const first = readPaperAutoLearningReadiness(input, now);
  const second = readPaperAutoLearningReadiness(input, now);
  assert.deepEqual(first, second);
  assert.equal(input.state.mode, "PAPER");
  assert.equal(input.heartbeat.lastError, null);
});

test("runtime safety reader projects only dashboard-owned facts and keeps incomplete safety UNKNOWN", () => {
  const result = readCloudRuntimeSafety({
    state: { ...state, killSwitchActive: true, intelligence: { staleSources: ["UPBIT_PUBLIC_TICKER"] } },
    connectionState: "DISCONNECTED",
  });
  assert.equal(result.value.killSwitchActive, true);
  assert.equal(result.value.staleMarketData, true);
  assert.equal(result.value.reconciliationMismatch, false);
  assert.equal(result.freshness, "UNKNOWN");
  assert.equal(result.observedAt, new Date(now).toISOString());
});

test("runtime safety reader does not convert an unavailable dashboard into healthy evidence", () => {
  const result = readCloudRuntimeSafety({ state: undefined, connectionState: "DISCONNECTED" });
  assert.equal(result.freshness, "UNKNOWN");
  assert.equal(result.value.killSwitchActive, false);
  assert.equal(result.value.staleMarketData, false);
});
