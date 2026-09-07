const assert = require("node:assert/strict");
const http = require("node:http");
const { BoundedHttpRateLimiter } = require("../dist/apps/cloud/src/httpRateLimiter.js");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { DeterministicRateLimitManager, RateLimitDecisionType } = require("../dist/apps/execution/src/rate-limit-manager.js");

function request(port, headers = {}, path = "/api/dashboard") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { ...headers, connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function run() {
  const limiter = new BoundedHttpRateLimiter({
    policy: { capacity: 2, refillTokens: 1, refillIntervalMs: 1000, maximumQueueDelayMs: 0, maximumTrackedRequests: 2 },
    maxBuckets: 1
  });
  assert.equal(limiter.evaluate("user-a", "request-1").allowed, true);
  assert.equal(limiter.evaluate("user-a", "request-1").allowed, true, "replayed request id must be idempotent");
  assert.equal(limiter.evaluate("user-a", "request-2").allowed, true);
  assert.equal(limiter.evaluate("user-a", "request-3").allowed, false, "bucket exhaustion must fail closed");
  assert.equal(limiter.evaluate("user-b", "request-4").allowed, false, "bucket registry must stay bounded");
}

// A drained bucket is never evicted, so a throttled caller cannot reset its own limit by
// flooding the registry with fresh identities.
function throttledBucketIsNotEvictable() {
  const manager = new DeterministicRateLimitManager(
    { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000, maximumQueueDelayMs: 0 },
    0
  );
  manager.evaluate({ requestId: "r1", weight: 1, nowMs: 0 });
  assert.equal(manager.isIdle(0), false, "a drained bucket must not be idle");
  assert.equal(manager.isIdle(1_000), false, "a bucket with a replayable decision must not be idle");
  assert.equal(manager.isIdle(120_000), true, "a refilled bucket with no live decision must be idle");
}

// Tracking capacity must recover with time. Previously a bucket that had once filled its
// decision registry returned BLOCK forever, locking out the legitimate owner.
function trackingCapacityRecovers() {
  const manager = new DeterministicRateLimitManager(
    { capacity: 100, refillTokens: 100, refillIntervalMs: 1_000, maximumQueueDelayMs: 0, maximumTrackedRequests: 2, decisionRetentionMs: 1_000 },
    0
  );
  assert.equal(manager.evaluate({ requestId: "a", weight: 1, nowMs: 0 }).type, RateLimitDecisionType.ALLOW);
  assert.equal(manager.evaluate({ requestId: "b", weight: 1, nowMs: 0 }).type, RateLimitDecisionType.ALLOW);
  assert.equal(
    manager.evaluate({ requestId: "c", weight: 1, nowMs: 0 }).reason,
    "request tracking capacity exhausted",
    "a full decision registry must fail closed while entries are still replayable"
  );
  assert.equal(
    manager.evaluate({ requestId: "c", weight: 1, nowMs: 5_000 }).type,
    RateLimitDecisionType.ALLOW,
    "tracking capacity must recover once memoized decisions expire"
  );
}

// An idle bucket is reclaimed so a flood of throwaway identities cannot permanently lock the
// registry against a legitimate caller.
function idleBucketIsReclaimed() {
  const limiter = new BoundedHttpRateLimiter({
    policy: { capacity: 5, refillTokens: 5, refillIntervalMs: 1, maximumQueueDelayMs: 0, decisionRetentionMs: 1 },
    maxBuckets: 1
  });
  assert.equal(limiter.evaluate("attacker", "req-1").allowed, true);
  const deadline = Date.now() + 2_000;
  let reclaimed = false;
  while (Date.now() < deadline) {
    if (limiter.evaluate("owner", `req-${Date.now()}`).allowed) { reclaimed = true; break; }
  }
  assert.equal(reclaimed, true, "an idle bucket must be reclaimed for a new identity");
}

run();
throttledBucketIsNotEvictable();
trackingCapacityRecovers();
idleBucketIsReclaimed();

(async () => {
  const owner = { userId: "rate-limit-owner", email: "rate-limit-owner@nusa.local", scopes: ["dashboard:read"] };
  const handle = startCloudDashboardServer({
    port: 41910,
    tokenVerifier: { ownerPrincipal: owner, verify: (token) => token === "token" ? owner : undefined },
    loadDashboard: () => ({ ok: true }),
    rateLimiter: new BoundedHttpRateLimiter({ policy: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000, maximumQueueDelayMs: 0, maximumTrackedRequests: 8 } })
  });
  try {
    const first = await request(handle.port, { authorization: "Bearer token", "x-correlation-id": "rate-1" });
    const second = await request(handle.port, { authorization: "Bearer token", "x-correlation-id": "rate-2" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(JSON.parse(second.body).error, "RATE_LIMITED");
    assert.equal(second.headers["retry-after"], "1");
  } finally {
    await handle.stop();
  }

  // Only the exact /health URL is exempt from metering. A query string previously made the
  // normalized path match the exemption while the handler did not, yielding an unmetered route.
  const bypass = startCloudDashboardServer({
    port: 41911,
    tokenVerifier: { ownerPrincipal: owner, verify: (token) => token === "token" ? owner : undefined },
    loadDashboard: () => ({ ok: true }),
    rateLimiter: new BoundedHttpRateLimiter({ policy: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000, maximumQueueDelayMs: 0, maximumTrackedRequests: 8 } })
  });
  try {
    assert.equal((await request(bypass.port, {}, "/health")).status, 200, "/health stays unmetered");
    assert.equal((await request(bypass.port, {}, "/health")).status, 200, "/health stays unmetered when repeated");
    assert.equal((await request(bypass.port, { "x-correlation-id": "bypass-1" }, "/health?x=1")).status, 404);
    assert.equal(
      (await request(bypass.port, { "x-correlation-id": "bypass-2" }, "/health?x=2")).status,
      429,
      "a query string must not exempt a request from rate limiting"
    );
  } finally {
    await bypass.stop();
  }

  console.log("cloud-rate-limit.test.js: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
