const test = require("node:test");
const assert = require("node:assert/strict");
const { ResearchAssistantGovernor } = require("../dist/apps/desktop/src/ai/aiResearchAssistantGovernor");

test("constructor validates policy fields are positive safe integers", () => {
  assert.throws(() => new ResearchAssistantGovernor({ maxCallsPerAssistant: 0 }), /maxCallsPerAssistant must be a positive safe integer/);
  assert.throws(() => new ResearchAssistantGovernor({ cacheWindowMs: -1 }), /cacheWindowMs must be a positive safe integer/);
  assert.throws(() => new ResearchAssistantGovernor({ totalMaxCalls: 1.5 }), /totalMaxCalls must be a positive safe integer/);
  assert.doesNotThrow(() => new ResearchAssistantGovernor());
});

test("check() admits fresh requests up to the per-assistant cap, then blocks", () => {
  const governor = new ResearchAssistantGovernor({ maxCallsPerAssistant: 2, totalMaxCalls: 100 });
  assert.equal(governor.check("SIGNAL_EXPLAINER", "hash-a", 0), "ADMITTED");
  governor.recordCall("SIGNAL_EXPLAINER", "hash-a", 0);
  assert.equal(governor.check("SIGNAL_EXPLAINER", "hash-b", 1), "ADMITTED");
  governor.recordCall("SIGNAL_EXPLAINER", "hash-b", 1);
  assert.equal(governor.check("SIGNAL_EXPLAINER", "hash-c", 2), "BLOCKED");
});

test("check() enforces the total cap across all six assistants combined", () => {
  const governor = new ResearchAssistantGovernor({ maxCallsPerAssistant: 100, totalMaxCalls: 2 });
  governor.recordCall("REGIME_EXPLAINER", "h1", 0);
  governor.recordCall("RISK_COMMENTARY", "h2", 0);
  assert.equal(governor.check("SESSION_SUMMARY", "h3", 0), "BLOCKED");
});

test("identical (assistantId, inputHash) within the cache window is a CACHE_HIT, not a new call", () => {
  const governor = new ResearchAssistantGovernor({ cacheWindowMs: 1000 });
  governor.recordCall("STRATEGY_OPTIMIZER", "same-hash", 0);
  assert.equal(governor.check("STRATEGY_OPTIMIZER", "same-hash", 500), "CACHE_HIT");
  // Different assistant, same hash, is not a cache hit
  assert.equal(governor.check("SCENARIO_COUNTERFACTUAL", "same-hash", 500), "ADMITTED");
  // Same assistant, different hash, is not a cache hit
  assert.equal(governor.check("STRATEGY_OPTIMIZER", "different-hash", 500), "ADMITTED");
});

test("cache entries expire after the cache window elapses", () => {
  const governor = new ResearchAssistantGovernor({ cacheWindowMs: 1000, maxCallsPerAssistant: 100 });
  governor.recordCall("SIGNAL_EXPLAINER", "hash", 0);
  assert.equal(governor.check("SIGNAL_EXPLAINER", "hash", 999), "CACHE_HIT");
  assert.equal(governor.check("SIGNAL_EXPLAINER", "hash", 1001), "ADMITTED"); // window elapsed, new call allowed
});

test("recordCacheHit() tracks cache hits separately from calls in the snapshot", () => {
  const governor = new ResearchAssistantGovernor();
  governor.recordCall("SESSION_SUMMARY", "hash", 0);
  governor.recordCacheHit();
  governor.recordCacheHit();
  const snapshot = governor.snapshot(0);
  assert.equal(snapshot.totalCalls, 1);
  assert.equal(snapshot.cacheHits, 2);
});

test("snapshot reports per-assistant call counts across all six assistants", () => {
  const governor = new ResearchAssistantGovernor();
  governor.recordCall("REGIME_EXPLAINER", "h1", 0);
  governor.recordCall("REGIME_EXPLAINER", "h2", 0);
  governor.recordCall("RISK_COMMENTARY", "h3", 0);
  const snapshot = governor.snapshot(0);
  assert.equal(snapshot.callsByAssistant.REGIME_EXPLAINER, 2);
  assert.equal(snapshot.callsByAssistant.RISK_COMMENTARY, 1);
  assert.equal(snapshot.callsByAssistant.SESSION_SUMMARY, 0);
  assert.equal(snapshot.callsByAssistant.SIGNAL_EXPLAINER, 0);
  assert.equal(snapshot.callsByAssistant.SCENARIO_COUNTERFACTUAL, 0);
  assert.equal(snapshot.callsByAssistant.STRATEGY_OPTIMIZER, 0);
  assert.equal(snapshot.totalCalls, 3);
});

test("reset() clears all counters and cache", () => {
  const governor = new ResearchAssistantGovernor({ maxCallsPerAssistant: 1 });
  governor.recordCall("STRATEGY_OPTIMIZER", "hash", 0);
  assert.equal(governor.check("STRATEGY_OPTIMIZER", "different", 0), "BLOCKED");
  governor.reset();
  assert.equal(governor.check("STRATEGY_OPTIMIZER", "different", 0), "ADMITTED");
  const snapshot = governor.snapshot(0);
  assert.equal(snapshot.totalCalls, 0);
  assert.equal(snapshot.cacheHits, 0);
});

test("default policy allows a reasonable number of calls before blocking", () => {
  const governor = new ResearchAssistantGovernor();
  const snapshot = governor.snapshot(0);
  assert.equal(snapshot.policy.maxCallsPerAssistant, 10);
  assert.equal(snapshot.policy.totalMaxCalls, 40);
  assert.equal(snapshot.policy.cacheWindowMs, 120_000);
});
