"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyAiBudgetState } = require("../dist/apps/autopilot/src/aiBudgetState.js");

const stop = (overrides = {}) => ({
  schemaVersion: 1,
  taskId: "task-1",
  executionId: "exec-1",
  provider: "workers-ai",
  headSha: "a".repeat(40),
  stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
  stoppedAt: 1_000,
  attemptCount: 1,
  lastFailure: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
  nextRetryAt: 2_000,
  resumeCondition: "provider-capacity-and-exact-head-revalidation",
  dedupeKey: "dedupe-1",
  evidenceRef: null,
  ...overrides,
});

test("no recorded wait is NORMAL", () => {
  assert.equal(classifyAiBudgetState(null, 1_500), "NORMAL");
  assert.equal(classifyAiBudgetState(undefined, 1_500), "NORMAL");
});

test("an elapsed wait is NORMAL even if still recorded", () => {
  assert.equal(classifyAiBudgetState(stop({ nextRetryAt: 1_000 }), 1_500), "NORMAL");
});

test("the daily free-allocation exhaustion is HARD_STOP while active", () => {
  assert.equal(classifyAiBudgetState(stop({ stopReason: "WORKERS_AI_DAILY_QUOTA_EXHAUSTED" }), 1_500), "HARD_STOP");
});

test("transient rate limiting is CONSERVE, not HARD_STOP, while active", () => {
  assert.equal(classifyAiBudgetState(stop({ stopReason: "WORKERS_AI_RATE_LIMITED" }), 1_500), "CONSERVE");
});

test("an unrecognized future stop reason fails closed to HARD_STOP, not NORMAL", () => {
  assert.equal(classifyAiBudgetState(stop({ stopReason: "PAID_COST_CEILING_REACHED" }), 1_500), "HARD_STOP");
});

test("a malformed nextRetryAt is treated as NORMAL rather than throwing", () => {
  assert.equal(classifyAiBudgetState(stop({ nextRetryAt: Number.NaN }), 1_500), "NORMAL");
});
