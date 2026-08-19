const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

const VALID_TOKEN = "mobile-paper-session-token";
const RELAY_TOKEN = "cloud-to-relay-token";
const principal = Object.freeze({ userId: "mobile-user", email: "mobile@example.com", scopes: Object.freeze(["dashboard:read"]) });
const verifier = { ownerPrincipal: principal, verify(token) { return token === VALID_TOKEN ? principal : undefined; } };
const dashboard = () => ({ ok: true });

function request(port, path, { method = "GET", token = VALID_TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...(token == null ? {} : { authorization: `Bearer ${token}` }), connection: "close" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function startRelay() {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    if (req.headers.authorization !== `Bearer ${RELAY_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      return;
    }
    const payload = req.url === "/api/v1/account/summary"
      ? { provider: "UPBIT", mode: "READ_ONLY", fetchedAt: new Date(1000).toISOString(), cash: { currency: "KRW", available: 1000, locked: 0 }, assets: [] }
      : req.url === "/api/v1/orders/open" ? []
        : req.url === "/api/v1/orders/history" ? []
          : { uuid: "01234567-89ab-cdef-0123-456789abcdef", market: "KRW-BTC", side: "BUY", ordType: "MARKET", price: 100, volume: 1, executedVolume: 1, remainingVolume: 0, state: "DONE", createdAt: new Date(1000).toISOString() };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, paths, port: server.address().port }));
  });
}

test("Cloud exposes authenticated read-only Upbit routes through the existing server-side relay", async () => {
  const relay = await startRelay();
  const cloud = startCloudDashboardServer({
    port: 41821,
    tokenVerifier: verifier,
    loadDashboard: dashboard,
    upbitReadOnlyRelayOrigin: `http://127.0.0.1:${relay.port}`,
    upbitReadOnlyRelayToken: RELAY_TOKEN
  });
  try {
    const summary = await request(cloud.port, "/api/v1/account/summary");
    assert.equal(summary.status, 200);
    assert.equal(JSON.parse(summary.body).provider, "UPBIT");
    assert.deepEqual(JSON.parse(summary.body).assets, []);

    const open = await request(cloud.port, "/api/v1/orders/open");
    const history = await request(cloud.port, "/api/v1/orders/history");
    const detail = await request(cloud.port, "/api/v1/orders/01234567-89ab-cdef-0123-456789abcdef");
    assert.equal(open.status, 200);
    assert.equal(history.status, 200);
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(detail.body).uuid, "01234567-89ab-cdef-0123-456789abcdef");
    assert.deepEqual(relay.paths, [
      "/api/v1/account/summary",
      "/api/v1/orders/open",
      "/api/v1/orders/history",
      "/api/v1/orders/01234567-89ab-cdef-0123-456789abcdef"
    ]);
  } finally {
    await cloud.stop();
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test("Upbit read-only routes require dashboard:read before contacting the relay", async () => {
  const relay = await startRelay();
  const cloud = startCloudDashboardServer({
    port: 41822,
    tokenVerifier: verifier,
    loadDashboard: dashboard,
    upbitReadOnlyRelayOrigin: `http://127.0.0.1:${relay.port}`,
    upbitReadOnlyRelayToken: RELAY_TOKEN
  });
  try {
    assert.equal((await request(cloud.port, "/api/v1/account/summary", { token: null })).status, 401);
    assert.equal((await request(cloud.port, "/api/v1/account/summary", { token: "invalid" })).status, 401);
    assert.equal((await request(cloud.port, "/api/v1/account/summary", { method: "POST" })).status, 405);
    assert.deepEqual(relay.paths, []);
  } finally {
    await cloud.stop();
    await new Promise((resolve) => relay.server.close(resolve));
  }
});

test("missing or failing relay configuration fails closed and exposes no mutation routes", async () => {
  const cloud = startCloudDashboardServer({ port: 41823, tokenVerifier: verifier, loadDashboard: dashboard, upbitReadOnlyRelayToken: "" });
  try {
    const unavailable = await request(cloud.port, "/api/v1/account/summary");
    assert.equal(unavailable.status, 503);
    assert.equal(JSON.parse(unavailable.body).error, "UPBIT_READONLY_UNAVAILABLE");

    assert.equal((await request(cloud.port, "/api/v1/orders/open", { method: "POST" })).status, 405);
    assert.equal((await request(cloud.port, "/api/v1/withdraws")).status, 404);
    assert.equal((await request(cloud.port, "/api/v1/orders/cancel")).status, 404);
    assert.equal((await request(cloud.port, "/api/v1/transfer")).status, 404);
  } finally {
    await cloud.stop();
  }
});
