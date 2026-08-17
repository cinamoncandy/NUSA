"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createGateway, startServer, TOOL_DEFINITIONS } = require("../server");

const CLIENT_TOKEN = "client-read-only-token-12345678901234567890";
const NUSA_TOKEN = "nusa-upstream-read-only-token-1234567890";
const UPBIT_TOKEN = "upbit-upstream-read-only-token-1234567890";
const config = Object.freeze({ port: 18887, host: "127.0.0.1", clientToken: CLIENT_TOKEN, nusaOrigin: "http://127.0.0.1:18808", upbitOrigin: "http://127.0.0.1:18300", nusaToken: NUSA_TOKEN, upbitToken: UPBIT_TOKEN });

function paperPayload() {
  return {
    generatedAt: 1_700_000_000_000,
    mode: "PAPER",
    health: "HEALTHY",
    readyForPaperOperations: true,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    dashboard: { mode: "PAPER", overallHealth: "HEALTHY", tradingAllowed: true, headline: "paper ready", issues: [] },
    operations: { runtimeState: "READY", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, updatedAt: 1_700_000_000_000 },
    portfolio: { observedAt: "2023-11-14T22:13:20.000Z", mode: "PAPER", account: { available: true, cash: 900, equity: 1_000, unrealizedPnl: 10, realizedPnl: 5, markPrice: 100, position: { market: "KRW-BTC", quantity: 1, averagePrice: 90, realizedPnl: 5 } }, openOrderCount: 0 },
    orders: [{ id: "paper-1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 90, fee: 0.1, filledAt: "2023-11-14T22:13:20.000Z", status: "FILLED", fills: [] }],
    markets: [{ market: "KRW-BTC", price: 100, changeRate: 0.01, volume: 1000, observedAt: "2023-11-14T22:13:20.000Z", source: "UPBIT_PUBLIC_TICKER" }],
    ai: { status: "AVAILABLE", thesis: "evidence-bound signal", confidence: 0.7, calibrationStatus: "CALIBRATED", evidenceReferences: ["e1"], uncertainty: "limited", explanationVerdict: "VERIFIED", liveAuthority: "NONE", productionMutationAllowed: false }
  };
}

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, url: "", json: async () => payload }; }

function fetchFixture({ calls = [], status = 200, throwError = false } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init.method, "GET");
    if (throwError) throw new Error("socket secret should not escape");
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/health") return response({ ok: true }, 200);
    if (pathname === "/api/paper-operations") return response(paperPayload(), status);
    if (pathname === "/api/v1/account/summary") return response({ provider: "UPBIT", mode: "READ_ONLY", fetchedAt: "2023-11-14T22:13:20.000Z", cash: { currency: "KRW", available: 1, locked: 0 }, assets: [] }, status);
    if (pathname === "/api/v1/orders/open" || pathname === "/api/v1/orders/history") return response([], status);
    if (pathname.startsWith("/api/v1/orders/")) return response({ uuid: "12345678-1234-1234-1234-123456789012", market: "KRW-BTC", side: "BUY", ordType: "LIMIT", price: 100, volume: 1, executedVolume: 1, remainingVolume: 0, state: "DONE", createdAt: "2023-11-14T22:13:20.000Z" }, status);
    return response({ ok: false }, 404);
  };
}

test("tool inventory is limited to existing read-only projections", () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.name);
  assert.ok(names.includes("nusa_health"));
  assert.ok(names.includes("get_market_ticker"));
  assert.ok(names.includes("get_upbit_order_detail"));
  assert.ok(!names.includes("get_market_candles"));
  assert.ok(!names.some((name) => /create|cancel|withdraw|transfer|execute/i.test(name)));
  assert.ok(TOOL_DEFINITIONS.every((tool) => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false));
});

test("health and normalized PAPER/market/AI projections are truthful", async () => {
  const calls = [];
  const gateway = createGateway({ config, fetchImpl: fetchFixture({ calls }), now: () => 1_700_000_001_000, auditLog: () => {} });
  assert.deepEqual(await gateway.health(), { process: true, upstreamReachable: true, authConfigured: true });
  const state = await gateway.callTool("get_paper_state", {}, "caller");
  assert.equal(state.structuredContent.source, "PAPER");
  assert.equal(state.structuredContent.liveAuthority, "NONE");
  assert.equal((await gateway.callTool("get_paper_portfolio", {}, "caller")).structuredContent.source, "PAPER");
  assert.equal((await gateway.callTool("get_market_ticker", { market: "KRW-BTC" }, "caller")).structuredContent.markets[0].source, "UPBIT_PUBLIC_TICKER");
  const ai = await gateway.callTool("get_ai_signal", {}, "caller");
  assert.equal(ai.structuredContent.source, "PAPER");
  assert.equal(ai.structuredContent.confidence, 0.7);
  assert.ok(calls.every((call) => call.init.headers.authorization === `Bearer ${NUSA_TOKEN}` || call.init.headers.authorization === undefined));
});

test("Upbit read-only projections use GET-only relay routes and retain provenance", async () => {
  const gateway = createGateway({ config, fetchImpl: fetchFixture(), now: () => 1_700_000_001_000, auditLog: () => {} });
  assert.equal((await gateway.callTool("get_upbit_readonly_summary", {}, "caller")).structuredContent.source, "UPBIT_READ_ONLY");
  assert.equal((await gateway.callTool("get_upbit_open_orders", { limit: 1 }, "caller")).structuredContent.source, "UPBIT_READ_ONLY");
  assert.equal((await gateway.callTool("get_upbit_order_history", { limit: 1 }, "caller")).structuredContent.source, "UPBIT_READ_ONLY");
  assert.equal((await gateway.callTool("get_upbit_order_detail", { uuid: "12345678-1234-1234-1234-123456789012" }, "caller")).structuredContent.source, "UPBIT_READ_ONLY");
});

test("errors are normalized, secrets are absent, and rate limits are bounded", async () => {
  const logs = [];
  const gateway = createGateway({ config, fetchImpl: fetchFixture({ throwError: true }), now: Date.now, auditLog: (entry) => logs.push(entry) });
  const failure = await gateway.callTool("get_paper_state", {}, "hashed-caller");
  assert.equal(failure.structuredContent.error.code, "UPSTREAM_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(failure), /client-read-only|upstream-read-only|secret|Bearer/i);
  for (let index = 0; index < 11; index += 1) await gateway.callTool("get_ai_signal", {}, "same-caller");
  const limited = await gateway.callTool("get_ai_signal", {}, "same-caller");
  assert.equal(limited.structuredContent.error.code, "RATE_LIMITED");
  assert.ok(logs.every((entry) => !JSON.stringify(entry).includes(CLIENT_TOKEN)));
  const unauthorized = createGateway({ config, fetchImpl: fetchFixture({ status: 401 }), auditLog: () => {} });
  assert.equal((await unauthorized.callTool("get_paper_state", {}, "caller")).structuredContent.error.code, "UNAUTHORIZED");
});

function request(port, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) } }, (res) => {
      let value = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { value += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: value ? JSON.parse(value) : null }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("remote MCP HTTP boundary requires auth and denies mutation/unknown routes", async () => {
  const server = startServer({ env: { NUSA_MCP_HOST: "127.0.0.1", NUSA_MCP_PORT: "18887", NUSA_MCP_READONLY_TOKEN: CLIENT_TOKEN, NUSA_MCP_NUSA_ORIGIN: config.nusaOrigin, NUSA_MCP_UPBIT_READONLY_ORIGIN: config.upbitOrigin, NUSA_MCP_NUSA_UPSTREAM_TOKEN: NUSA_TOKEN, NUSA_MCP_UPBIT_UPSTREAM_TOKEN: UPBIT_TOKEN }, fetchImpl: fetchFixture() });
  try {
    assert.equal((await request(18_887, "POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status, 401);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await request(18_887, method, "/api/paper-orders", "{}", CLIENT_TOKEN)).status, 404);
    assert.equal((await request(18_887, "GET", "/unknown", undefined, CLIENT_TOKEN)).status, 404);
    assert.equal((await request(18_887, "POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "unknown_tool", arguments: {} } }), CLIENT_TOKEN)).body.result.structuredContent.error.code, "UNKNOWN_TOOL");
    const initialized = await request(18_887, "POST", "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } }), CLIENT_TOKEN);
    assert.equal(initialized.body.result.serverInfo.name, "nusa-read-only-mcp");
  } finally { await server.stop(); }
});
