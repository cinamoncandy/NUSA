const assert = require("node:assert/strict");
const http = require("node:http");
const { BoundedHttpRateLimiter } = require("../dist/apps/cloud/src/httpRateLimiter.js");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

function request(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/dashboard", method: "GET", headers: { ...headers, connection: "close" } }, (res) => {
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

run();

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
  console.log("cloud-rate-limit.test.js: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
