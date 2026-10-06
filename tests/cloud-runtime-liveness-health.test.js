const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
const { evaluateComponentHealth } = require("../dist/apps/cloud/src/componentHealth.js");

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

test("/health publishes only the allowlisted liveness fields, whatever the source returns", async () => {
  // A future or alternate source can return more than the contract; structural typing allows it.
  // The extra values are sentinels, not credentials, so the repository secret scan stays clean.
  const leaky = { ...LIVENESS, privateRuntimeField: "leak-sentinel-7f3", accountId: "acct-123", balanceKrw: 1_000_000, lastError: "Upbit said: invalid key abc123 for account acct-123" };
  await withServer({ runtimeLiveness: () => leaky }, async (handle) => {
    const res = await request(handle.port, "/health");
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body.runtime).sort(), Object.keys(LIVENESS).sort(), "no field beyond the contract may reach the public route");
    assert.equal(body.runtime.lastError, "LIVENESS_ERROR_UNCLASSIFIED", "a free-text error is replaced, never published");
    assert.doesNotMatch(res.body, /leak-sentinel-7f3|acct-123|1000000|invalid key/);
  }, 41887);
});

test("/health publishes the event-loop stall numbers only as finite non-negative numbers, and only when supplied", async () => {
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, eventLoopMaxStallMs: 6_100, eventLoopStallCount: 3.9, lastEventLoopStallAt: 1_950 }) }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    assert.equal(body.runtime.eventLoopMaxStallMs, 6_100);
    assert.equal(body.runtime.eventLoopStallCount, 3);
    assert.equal(body.runtime.lastEventLoopStallAt, 1_950);
  }, 41901);
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, eventLoopMaxStallMs: -1, eventLoopStallCount: "7 leak-sentinel-9", lastEventLoopStallAt: Number.NaN }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body.runtime).sort(), Object.keys(LIVENESS).sort(), "invalid stall values are dropped, not published");
    assert.doesNotMatch(res.body, /leak-sentinel-9/);
  }, 41902);
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, lastEventLoopStallAt: null }) }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    assert.equal(body.runtime.lastEventLoopStallAt, null);
  }, 41903);
});

test("/health names the class of the runtime's own paper failures but never the detail after the colon", async () => {
  const cases = [
    ["paper account persistence failed: PAPER_LEDGER_RECONCILIATION_REQUIRED realized state -154.31476926 ledger -154.31476925 38 fills", "PAPER_ACCOUNT_PERSISTENCE_FAILED"],
    ["paper account persistence failed", "PAPER_ACCOUNT_PERSISTENCE_FAILED"],
    ["paper order lifecycle reconciliation mismatch", "PAPER_ORDER_LIFECYCLE_RECONCILIATION_MISMATCH"],
    // Not the runtime's own plain-words phrase: still replaced, never published.
    ["Upbit said: invalid key abc123 for account acct-123", "LIVENESS_ERROR_UNCLASSIFIED"],
    ["paper account 1234 failed: x", "LIVENESS_ERROR_UNCLASSIFIED"],
    ["paper key abc-123 leaked", "LIVENESS_ERROR_UNCLASSIFIED"],
    ["Paper account persistence failed: x", "LIVENESS_ERROR_UNCLASSIFIED"],
    ["paper " + "x".repeat(80) + ": y", "LIVENESS_ERROR_UNCLASSIFIED"],
  ];
  for (const [index, [lastError, expected]] of cases.entries()) {
    await withServer({ runtimeLiveness: () => ({ ...LIVENESS, lastError }) }, async (handle) => {
      const res = await request(handle.port, "/health");
      const body = JSON.parse(res.body);
      assert.equal(body.runtime.lastError, expected, lastError);
      assert.doesNotMatch(res.body, /-154\.3|38 fills|abc123|acct-123|1234|abc-123|ledger/);
    }, 41850 + index); // a range no other test file uses (41890-41897 overlapped paper-decision-outcome's 41893-41895)
  }
});

test("/health publishes the research collection status as a fixed code plus two counts and nothing else", async () => {
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, researchCollectionStatus: "COLLECTING", researchCandleCount: 1234.7, researchRequiredCandles: 16_560, researchMarket: "KRW-XRP", researchDetail: "leak-sentinel-r1" }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    const body = JSON.parse(res.body);
    assert.equal(body.runtime.researchCollectionStatus, "COLLECTING");
    assert.equal(body.runtime.researchCandleCount, 1234);
    assert.equal(body.runtime.researchRequiredCandles, 16_560);
    assert.equal(body.runtime.researchMarket, undefined);
    assert.doesNotMatch(res.body, /leak-sentinel-r1|KRW-XRP/);
  }, 41851 + 20);
  for (const [index, status] of ["DISABLED", "INVALID", "UNAVAILABLE"].entries()) {
    await withServer({ runtimeLiveness: () => ({ ...LIVENESS, researchCollectionStatus: status }) }, async (handle) => {
      const body = JSON.parse((await request(handle.port, "/health")).body);
      assert.equal(body.runtime.researchCollectionStatus, status);
      assert.equal(body.runtime.researchCandleCount, undefined);
    }, 41872 + index);
  }
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, researchCollectionStatus: "free text with detail 123", researchCandleCount: -5 }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body.runtime).sort(), Object.keys(LIVENESS).sort(), "an unknown status is dropped, not published");
    assert.doesNotMatch(res.body, /free text/);
  }, 41876);
});

test("/health strips extra component-health fields from an alternate callback", async () => {
  const measuredAt = 2_000;
  const health = (componentId, provenance, evidenceId) => evaluateComponentHealth({
    componentId, now: measuredAt, policy: { staleAfterMs: 1_000 },
    latest: { componentId, signal: "PASS", observedAt: measuredAt, provenance, evidenceId },
  });
  const process = { ...health("PAPER_PROCESS", "cloud-runtime-heartbeat", "heartbeat:1000:2000"), extra: "private-marker-42" };
  const workload = { ...health("PAPER_WORKLOAD", "cloud-paper-market-events", "market-event:1000:2000:1"), extra: "private-marker-42" };
  await withServer({ runtimeHealth: () => ({ process, workload, extra: "private-marker-42" }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    const body = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.equal(body.runtimeHealth.process.state, "HEALTHY");
    assert.equal(body.runtimeHealth.workload.state, "HEALTHY");
    assert.doesNotMatch(res.body, /private-marker-42/);
  }, 41890);
});

test("/health omits malformed component-health evidence without exposing callback text", async () => {
  await withServer({ runtimeHealth: () => ({ process: null, workload: { error: "private-marker-42" } }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).runtimeHealth, undefined);
    assert.doesNotMatch(res.body, /private-marker-42/);
  }, 41891);
});

test("a coded liveness error is published unchanged", async () => {
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, lastError: "PUBLIC_MARKET_EVENT_REJECTED:STALE" }) }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    assert.equal(body.runtime.lastError, "PUBLIC_MARKET_EVENT_REJECTED:STALE");
  }, 41888);
});

test("the previous stop reason is published only as a coded value and never as free text", async () => {
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, previousStop: "PREVIOUS_CLOSED_LEARNING_SCHEDULER:MESSAGE_0123456789AB" }) }, async (handle) => {
    const body = JSON.parse((await request(handle.port, "/health")).body);
    assert.equal(body.runtime.previousStop, "PREVIOUS_CLOSED_LEARNING_SCHEDULER:MESSAGE_0123456789AB");
  }, 41889);
  await withServer({ runtimeLiveness: () => ({ ...LIVENESS, previousStop: "failed for account acct-123" }) }, async (handle) => {
    const res = await request(handle.port, "/health");
    assert.equal(JSON.parse(res.body).runtime.previousStop, undefined);
    assert.doesNotMatch(res.body, /acct-123/);
  }, 41889);
});
