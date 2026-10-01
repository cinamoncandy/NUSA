const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { codePaperDecisionOutcome } = require("../dist/apps/cloud/src/paperDecisionOutcome.js");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

const publicCode = /^[A-Z]{3,12}:[A-Z0-9_.:+-]{1,100}$/;

test("the boundary reason becomes a public code that answers why no order was placed", () => {
  assert.equal(codePaperDecisionOutcome({ status: "BLOCKED", reason: "PAPER_INVESTMENT_ALLOCATION_EXCEEDED" }), "BLOCKED:PAPER_INVESTMENT_ALLOCATION_EXCEEDED");
  assert.equal(codePaperDecisionOutcome({ status: "WAIT", reason: "no actionable paper decision" }), "WAIT:NO_ACTIONABLE_PAPER_DECISION");
  assert.equal(codePaperDecisionOutcome({ status: "REJECTED", reason: "insufficient paper position" }), "REJECTED:INSUFFICIENT_PAPER_POSITION");
  assert.equal(codePaperDecisionOutcome({ status: "BLOCKED", reason: "PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH" }), "BLOCKED:PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH");
});

test("risk codes are used when the result has no reason, and the status is the last fallback", () => {
  assert.equal(codePaperDecisionOutcome({ status: "REJECTED", risk: { status: "REJECT", reasonCodes: ["MAX_ORDER_NOTIONAL", "FAMILY_EXPOSURE"] } }), "REJECTED:MAX_ORDER_NOTIONAL+FAMILY_EXPOSURE");
  assert.equal(codePaperDecisionOutcome({ status: "FILLED", risk: { status: "ALLOW", reasonCodes: [] } }), "FILLED:FILLED");
  assert.equal(codePaperDecisionOutcome({ status: "WAIT", reason: "   " }), "WAIT:WAIT");
});

test("every produced code is public-safe, bounded and never carries free text", () => {
  for (const reason of ["a price of 12,345 KRW at 09:00", "x".repeat(400), "한글 사유", "SIMPLE_CODE"]) {
    const code = codePaperDecisionOutcome({ status: "BLOCKED", reason });
    assert.match(code, publicCode, code);
    assert.ok(code.length <= 120);
  }
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { connection: "close" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.end();
  });
}

const owner = Object.freeze({ userId: "operator", email: "operator@nusa.local", scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"]) });
const base = Object.freeze({ tokenVerifier: Object.freeze({ ownerPrincipal: owner, verify: () => undefined }), loadDashboard: () => { throw new Error("not used"); } });
const LIVENESS = { startedAt: 1_000, lastHeartbeatAt: 2_000, lastMarketEventAt: 1_900, lastPaperDecisionAt: 1_800, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 4, decisionCount: 2, paperOrderCount: 0, paperFillCount: 0, lastError: null };

async function health(liveness, port) {
  const handle = startCloudDashboardServer({ port, ...base, runtimeLiveness: () => liveness });
  try { return await get(handle.port, "/health"); } finally { await handle.stop(); }
}

test("/health publishes only a well-formed decision outcome code", async () => {
  const good = await health({ ...LIVENESS, lastPaperDecisionOutcome: "BLOCKED:PAPER_INVESTMENT_ALLOCATION_EXCEEDED" }, 41893);
  assert.equal(good.runtime.lastPaperDecisionOutcome, "BLOCKED:PAPER_INVESTMENT_ALLOCATION_EXCEEDED");
  const free = await health({ ...LIVENESS, lastPaperDecisionOutcome: "balance is 9,999 KRW" }, 41894);
  assert.equal(Object.hasOwn(free.runtime, "lastPaperDecisionOutcome"), false, "free text must never become public");
  const absent = await health(LIVENESS, 41895);
  assert.equal(Object.hasOwn(absent.runtime, "lastPaperDecisionOutcome"), false, "the field is additive and optional");
});
