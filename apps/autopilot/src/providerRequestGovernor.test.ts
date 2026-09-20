import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderRequestGovernor, providerRateLimitRetryDelay } from "./providerRequestGovernor";

const response = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("ProviderRequestGovernor", () => {
  it("honors Retry-After and retries a bounded 429", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    let calls = 0;
    const governor = new ProviderRequestGovernor({
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
      random: () => 0,
      policies: { github: { maxAttempts: 3, baseBackoffMs: 100, maxBackoffMs: 10_000 } },
    });

    const result = await governor.execute("github", async () => {
      calls += 1;
      return calls === 1 ? response(429, { "retry-after": "2" }) : response(204);
    });

    assert.equal(result.status, 204);
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [2_000]);
    assert.equal(governor.snapshot("github").consecutiveRateLimits, 0);
  });

  it("uses bounded exponential backoff with jitter when no retry header exists", async () => {
    let now = 0;
    const sleeps: number[] = [];
    let calls = 0;
    const governor = new ProviderRequestGovernor({
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
      random: () => 0,
      policies: { claude: { maxAttempts: 3, baseBackoffMs: 100, maxBackoffMs: 1_000 } },
    });

    const result = await governor.execute("claude", async () => {
      calls += 1;
      return response(429);
    });

    assert.equal(result.status, 429);
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [100, 100, 200, 200]);
    const snapshot = governor.snapshot("claude");
    assert.equal(snapshot.consecutiveRateLimits, 3);
    assert.equal(snapshot.cooldownUntilMs, 700);
  });

  it("keeps provider cooldown isolated", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const governor = new ProviderRequestGovernor({
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
      random: () => 0,
      policies: {
        github: { maxAttempts: 1, baseBackoffMs: 500, maxBackoffMs: 500 },
        openai: { maxAttempts: 1, baseBackoffMs: 500, maxBackoffMs: 500 },
      },
    });

    await governor.execute("github", async () => response(429));
    assert.equal(governor.snapshot("github").consecutiveRateLimits, 1);
    assert.equal(governor.snapshot("openai").consecutiveRateLimits, 0);

    const result = await governor.execute("openai", async () => response(200));
    assert.equal(result.status, 200);
    assert.deepEqual(sleeps, []);
  });

  it("serializes above the provider concurrency budget", async () => {
    const governor = new ProviderRequestGovernor({
      policies: { github: { maxConcurrent: 1, maxAttempts: 1 } },
    });
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;

    const operation = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 1) await gate;
      active -= 1;
      return response(200);
    };

    const first = governor.execute("github", operation);
    const second = governor.execute("github", operation);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(governor.snapshot("github").queued, 1);
    releaseFirst?.();
    await Promise.all([first, second]);
    assert.equal(maxActive, 1);
    assert.equal(governor.snapshot("github").queued, 0);
  });

  it("parses GitHub reset evidence and ignores it for non-429 responses", () => {
    assert.equal(providerRateLimitRetryDelay(response(429, { "x-ratelimit-reset": "3" }), 1_000), 2_000);
    assert.equal(providerRateLimitRetryDelay(response(200, { "retry-after": "5" }), 0), null);
  });

  it("rejects invalid provider identities", async () => {
    const governor = new ProviderRequestGovernor();
    await assert.rejects(() => governor.execute("../github", async () => response(200)), /PROVIDER_ID_INVALID/);
  });
});
