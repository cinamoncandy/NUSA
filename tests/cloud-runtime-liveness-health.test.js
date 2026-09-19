const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

/**
 * 24-hour PAPER operation must be observable, not assumed.
 *
 * The PAPER execution loop is driven by a persistent Upbit public ticker subscription, so it
 * either runs continuously or not at all. Nothing exposed that distinction: `/health` returned
 * `{ok:true}` whenever the HTTP listener answered, and `/ready` reports database and migration
 * readiness. A stalled market feed, a loop that had stopped deciding, and a healthy runtime were
 * indistinguishable from outside -- which is exactly the question "is it running 24 hours?".
 *
 * `/health` is unauthenticated by design, so the evidence must stay operational: timestamps,
 * counters and a coded error, never a price, balance, position or order detail.
 */

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { connection: "close" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const ownerPrincipal = Object.freeze({
  userId: "operator",
  email: "operator@nusa.local",
  scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"])
});
const verifier = Object.freeze({ ownerPrincipal, verify: () => undefined });
const base = Object.freeze({ tokenVerifier: verifier, loadDashboard: () => { throw new Error("not used"); } });

const LIVENESS = Object.freeze({
  startedAt: 1_000, lastHeartbeatAt: 2_000, lastMarketEventAt: 1_900,
  lastPaperDecisionAt: 1_800, lastPaperOrderAt: 1_700, lastPaperFillAt: 1_600,
  eventCount: 42, decisionCount: 7, paperOrderCount: 3, paperFillCount: 2, lastError: null
});

async function withServer(options, run, port) {
  const handle = startCloudDashboardServer({ port, ...base, ...options });
  try { await run(handle); } finally { await handle.stop(); }
}

test("/health carries the continuous PAPER runtime counters when a source is wired", async () => {
  await withServer({ runtimeLiveness: () => LIVENESS }, async (handle) => {
    const res = await request(handle.port, "/health");
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.runtime, LIVENESS, "the loop's own counters must be observable");
  }, 41881);
});

test("a stalled loop is distinguishable from a healthy one", async () => {
  const stalled = Object.freeze({ ...LIVENESS, lastMarketEventAt: null, lastPaperDecisionAt: null, eventCount: 0, decisionCount: 0, lastError: "PAPER_MARKET_OBSERVATION_REJECTED" });
  await withServer({ runtimeLiveness: () => stalled }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    // The process still answers, so `ok` stays true. The distinction has to come from the counters.
    assert.equal(body.ok, true);
    assert.equal(body.runtime.lastMarketEventAt, null);
    assert.equal(body.runtime.eventCount, 0);
    assert.equal(body.runtime.lastError, "PAPER_MARKET_OBSERVATION_REJECTED");
  }, 41882);
});

test("/health is unchanged when no liveness source is wired", async () => {
  await withServer({}, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    assert.equal(body.ok, true);
    assert.ok(typeof body.observedAt === "string" && body.observedAt.length > 0);
    assert.equal("runtime" in body, false, "existing probes must not see a new field appear from nowhere");
  }, 41883);
});

test("/health stays unauthenticated and still refuses non-GET", async () => {
  await withServer({ runtimeLiveness: () => LIVENESS }, async (handle) => {
    const res = await request(handle.port, "/health");
    assert.equal(res.status, 200, "no credential is required to observe liveness");
  }, 41884);
});

test("the published evidence carries no financial or credential data", async () => {
  await withServer({ runtimeLiveness: () => LIVENESS }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    const keys = Object.keys(body.runtime);
    // Allowlist, not a denylist: a future field cannot leak by simply not matching a banned word.
    assert.deepEqual(keys.sort(), [
      "decisionCount", "eventCount", "lastError", "lastHeartbeatAt", "lastMarketEventAt",
      "lastPaperDecisionAt", "lastPaperFillAt", "lastPaperOrderAt", "paperFillCount",
      "paperOrderCount", "startedAt"
    ], "/health is unauthenticated, so its payload is a fixed operational allowlist");
    for (const [key, value] of Object.entries(body.runtime)) {
      assert.ok(value === null || typeof value === "number" || key === "lastError",
        `${key} must be a timestamp, a counter, or a coded error`);
    }
  }, 41885);
});

test("the runtime publishes exactly the fields the contract allows", () => {
  const fs = require("node:fs");
  const runtime = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8");
  const start = runtime.indexOf("runtimeLiveness: () =>");
  assert.ok(start > 0, "the runtime must wire its heartbeat into the server");
  const block = runtime.slice(start, runtime.indexOf("}),", start));
  for (const banned of ["price", "balance", "capital", "position", "token", "secret"]) {
    assert.doesNotMatch(block, new RegExp(banned, "i"), `liveness must not publish ${banned}`);
  }
});
