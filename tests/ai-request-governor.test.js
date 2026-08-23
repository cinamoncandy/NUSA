const test = require("node:test");
const assert = require("node:assert/strict");
const { AiRequestGovernor, AiRequestRateLimitedError } = require("../dist/apps/desktop/src/aiRequestGovernor.js");

test("a fresh call reaches the underlying function and is cached", async () => {
  let calls = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 6, cacheTtlMs: 30_000 });
  const call = async () => { calls += 1; return { value: calls }; };

  const first = await governor.guard("ai:explain-latest-signal", { market: "KRW-BTC" }, call);
  const second = await governor.guard("ai:explain-latest-signal", { market: "KRW-BTC" }, call);

  assert.equal(calls, 1, "second call with an identical input should be served from cache");
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
});

test("a different input bypasses the cache and calls again", async () => {
  let calls = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 6, cacheTtlMs: 30_000 });
  const call = async () => { calls += 1; return calls; };

  await governor.guard("ai:explain-regime", { regime: "TRENDING" }, call);
  await governor.guard("ai:explain-regime", { regime: "RANGING" }, call);

  assert.equal(calls, 2);
});

test("cache key does not depend on object property order", async () => {
  let calls = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 6, cacheTtlMs: 30_000 });
  const call = async () => { calls += 1; return calls; };

  await governor.guard("ai:summarize-session", { a: 1, b: 2 }, call);
  await governor.guard("ai:summarize-session", { b: 2, a: 1 }, call);

  assert.equal(calls, 1);
});

test("exceeding the per-minute budget throws AiRequestRateLimitedError instead of calling", async () => {
  let calls = 0;
  let nowMs = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 2, cacheTtlMs: 0, now: () => nowMs });
  const call = async () => { calls += 1; return calls; };

  await governor.guard("ai:explain-risk", { attempt: 1 }, call);
  await governor.guard("ai:explain-risk", { attempt: 2 }, call);

  await assert.rejects(
    () => governor.guard("ai:explain-risk", { attempt: 3 }, call),
    AiRequestRateLimitedError
  );
  assert.equal(calls, 2, "the third, over-budget call must never reach the underlying function");
});

test("the rate limit window rolls forward and admits calls again after 60s", async () => {
  let calls = 0;
  let nowMs = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 1, cacheTtlMs: 0, now: () => nowMs });
  const call = async () => { calls += 1; return calls; };

  await governor.guard("ai:explain-challenger-disagreement", { attempt: 1 }, call);
  await assert.rejects(() => governor.guard("ai:explain-challenger-disagreement", { attempt: 2 }, call), AiRequestRateLimitedError);

  nowMs = 60_001;
  await governor.guard("ai:explain-challenger-disagreement", { attempt: 3 }, call);
  assert.equal(calls, 2);
});

test("rate limits are tracked independently per handler name", async () => {
  let nowMs = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 1, cacheTtlMs: 0, now: () => nowMs });
  const call = async () => "ok";

  await governor.guard("ai:explain-latest-signal", { x: 1 }, call);
  await assert.doesNotReject(() => governor.guard("ai:ask-followup-question", { x: 1 }, call));
});

test("a cache hit does not consume rate-limit budget", async () => {
  let calls = 0;
  let nowMs = 0;
  const governor = new AiRequestGovernor({ maxCallsPerMinute: 1, cacheTtlMs: 30_000, now: () => nowMs });
  const call = async () => { calls += 1; return calls; };

  await governor.guard("ai:summarize-session", { fixed: true }, call);
  for (let i = 0; i < 10; i++) {
    await governor.guard("ai:summarize-session", { fixed: true }, call);
  }
  assert.equal(calls, 1);
});
