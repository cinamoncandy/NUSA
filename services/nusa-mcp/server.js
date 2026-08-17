"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const MCP_PATH = "/mcp";
const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ITEMS = 100;
const PROTOCOL_VERSION = "2025-06-18";

const TOOL_DEFINITIONS = Object.freeze([
  { name: "nusa_health", description: "Read NUSA Cloud process and upstream health. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_paper_state", description: "Read normalized PAPER runtime state from NUSA Cloud. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_paper_portfolio", description: "Read the normalized PAPER portfolio projection. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_paper_order_history", description: "Read bounded filled PAPER order history. Read-only.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_market_ticker", description: "Read current public Upbit ticker projections already held by NUSA Cloud. Read-only.", inputSchema: { type: "object", properties: { market: { type: "string", pattern: "^KRW-[A-Z0-9-]+$" } }, additionalProperties: false } },
  { name: "get_ai_signal", description: "Read the evidence-bound, zero-authority AI signal projection. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_upbit_readonly_summary", description: "Read the server-side Upbit account summary through the approved read-only relay. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_upbit_open_orders", description: "Read open Upbit orders through the approved read-only relay. Read-only.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_upbit_order_history", description: "Read bounded completed Upbit order history through the approved read-only relay. Read-only.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_upbit_order_detail", description: "Read one Upbit order detail through the approved read-only relay. Read-only.", inputSchema: { type: "object", properties: { uuid: { type: "string", pattern: "^[0-9a-f-]{20,64}$" } }, required: ["uuid"], additionalProperties: false } }
].map((tool) => Object.freeze({ ...tool, annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true }) })));

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
const NUSA_PATHS = new Set(["/health", "/api/dashboard", "/api/paper-operations"]);
const UPBIT_PATHS = new Set(["/api/v1/account/summary", "/api/upbit/accounts", "/api/v1/orders/open", "/api/v1/orders/history"]);

function jsonResponse(status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": String(Buffer.byteLength(body)), ...extraHeaders }, body };
}

function jsonRpc(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function isObject(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function boundedLimit(value) { return value === undefined ? 50 : Number.isSafeInteger(value) && value >= 1 && value <= MAX_ITEMS ? value : null; }
function hashCaller(token) { return crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16); }
function nowIso(now) { return new Date(now()).toISOString(); }

function readConfig(env = process.env) {
  const port = env.NUSA_MCP_PORT === undefined ? DEFAULT_PORT : Number(env.NUSA_MCP_PORT);
  const host = (env.NUSA_MCP_HOST || "127.0.0.1").trim();
  const clientToken = (env.NUSA_MCP_READONLY_TOKEN || "").trim();
  const nusaOrigin = (env.NUSA_MCP_NUSA_ORIGIN || "").trim().replace(/\/$/, "");
  const upbitOrigin = (env.NUSA_MCP_UPBIT_READONLY_ORIGIN || "").trim().replace(/\/$/, "");
  const nusaToken = (env.NUSA_MCP_NUSA_UPSTREAM_TOKEN || "").trim();
  const upbitToken = (env.NUSA_MCP_UPBIT_UPSTREAM_TOKEN || "").trim();
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("invalid MCP port");
  if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error("MCP gateway must bind to loopback");
  if (Buffer.byteLength(clientToken, "utf8") < 32) throw new Error("MCP read-only token must contain at least 32 bytes");
  if (!nusaOrigin) throw new Error("NUSA MCP upstream origin is required");
  for (const [name, origin] of [["NUSA", nusaOrigin], ["Upbit", upbitOrigin]]) {
    if (!origin) continue;
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${name} MCP origin must not contain credentials or query data`);
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname.toLowerCase() === "localhost";
    if (parsed.protocol !== "https:" && !loopback) throw new Error(`${name} MCP upstream must use HTTPS outside loopback`);
  }
  if (upbitOrigin && Buffer.byteLength(upbitToken, "utf8") < 32) throw new Error("Upbit MCP upstream token must contain at least 32 bytes");
  if (Buffer.byteLength(nusaToken, "utf8") < 32) throw new Error("NUSA MCP upstream token must contain at least 32 bytes");
  return Object.freeze({ port, host, clientToken, nusaOrigin, upbitOrigin, nusaToken, upbitToken });
}

function bearer(headers) {
  const value = headers.authorization ?? headers.Authorization;
  return typeof value === "string" && /^Bearer\s+[^\s]+$/i.test(value.trim()) ? value.trim().slice(7).trim() : undefined;
}

function tokensEqual(actual, expected) {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeError(error) {
  if (error?.code === "UNAUTHORIZED") return error;
  if (error?.code === "RATE_LIMITED") return error;
  if (error?.code === "INVALID_ARGUMENT") return error;
  if (error?.code === "UNKNOWN_TOOL") return error;
  return Object.assign(new Error("upstream unavailable"), { code: "UPSTREAM_UNAVAILABLE" });
}

function toolError(error) {
  const normalized = normalizeError(error);
  return Object.freeze({ isError: true, structuredContent: Object.freeze({ error: Object.freeze({ code: normalized.code }) }), content: [{ type: "text", text: JSON.stringify({ error: normalized.code }) }] });
}

function toolOk(value) {
  return Object.freeze({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });
}

function validateObjectArguments(args) {
  if (args === undefined) return {};
  if (!isObject(args)) throw Object.assign(new Error("invalid arguments"), { code: "INVALID_ARGUMENT" });
  return args;
}

function validateMarket(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^KRW-[A-Z0-9-]+$/.test(value.trim().toUpperCase())) throw Object.assign(new Error("invalid market"), { code: "INVALID_ARGUMENT" });
  return value.trim().toUpperCase();
}

async function upstreamJson({ origin, token, path, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, requireToken = true }) {
  if (!origin || !NUSA_PATHS.has(path) && !UPBIT_PATHS.has(path) && !path.startsWith("/api/v1/orders/")) throw new Error("upstream route unavailable");
  const url = new URL(path, `${origin}/`);
  const headers = { accept: "application/json" };
  if (requireToken) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw Object.assign(new Error("upstream unavailable"), { code: "UPSTREAM_UNAVAILABLE" }); }
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("unauthorized"), { code: "UNAUTHORIZED" });
  if (response.status === 429) throw Object.assign(new Error("rate limited"), { code: "RATE_LIMITED" });
  if (!response.ok) throw Object.assign(new Error("upstream unavailable"), { code: "UPSTREAM_UNAVAILABLE" });
  try { return await response.json(); } catch { throw Object.assign(new Error("upstream unavailable"), { code: "UPSTREAM_UNAVAILABLE" }); }
}

function normalizeOperations(payload) {
  if (!isObject(payload) || payload.liveAuthority !== "NONE" || payload.productionMutationAllowed !== false || !Array.isArray(payload.orders) || !Array.isArray(payload.markets)) throw new Error("invalid read-only PAPER projection");
  const dashboard = isObject(payload.dashboard) ? payload.dashboard : null;
  const operations = isObject(payload.operations) ? payload.operations : null;
  if (!dashboard || !operations) throw new Error("invalid read-only PAPER projection");
  return payload;
}

function normalizePaperState(payload, now) {
  const snapshot = normalizeOperations(payload);
  const dashboard = snapshot.dashboard;
  const operations = snapshot.operations;
  return Object.freeze({ source: "PAPER", observedAt: new Date(snapshot.generatedAt).toISOString(), mode: snapshot.mode, health: snapshot.health, readyForPaperOperations: snapshot.readyForPaperOperations === true, dashboard: { mode: dashboard.mode, overallHealth: dashboard.overallHealth, tradingAllowed: dashboard.tradingAllowed === true, headline: typeof dashboard.headline === "string" ? dashboard.headline.slice(0, 500) : "", issues: Array.isArray(dashboard.issues) ? dashboard.issues.slice(0, 20).map(String) : [] }, operations: { runtimeState: operations.runtimeState, transport: operations.transport, killSwitchActive: operations.killSwitchActive === true, accountHalted: operations.accountHalted === true, pendingWrites: operations.pendingWrites, updatedAt: operations.updatedAt }, liveAuthority: "NONE", productionMutationAllowed: false, readAt: nowIso(now) });
}

function normalizePortfolio(payload, now) {
  const snapshot = normalizeOperations(payload);
  const account = snapshot.portfolio?.account;
  const position = account?.position;
  const portfolio = account == null || position == null ? null : Object.freeze({ mode: "PAPER", account: Object.freeze({ available: true, cash: account.cash, equity: account.equity, unrealizedPnl: account.unrealizedPnl, ...(finite(account.assetValue) ? { assetValue: account.assetValue } : {}), ...(finite(account.realizedPnl) ? { realizedPnl: account.realizedPnl } : {}), markPrice: account.markPrice, position: Object.freeze({ market: String(position.market), quantity: position.quantity, averagePrice: position.averagePrice, realizedPnl: position.realizedPnl, ...(finite(position.unrealizedPnl) ? { unrealizedPnl: position.unrealizedPnl } : {}) }) }), openOrderCount: 0 });
  return Object.freeze({ source: "PAPER", observedAt: snapshot.portfolio?.observedAt ?? new Date(snapshot.generatedAt).toISOString(), portfolio, liveAuthority: "NONE", productionMutationAllowed: false, readAt: nowIso(now) });
}

function normalizePaperOrders(payload, limit, now) {
  const snapshot = normalizeOperations(payload);
  const orders = snapshot.orders.slice(0, limit).map((order) => Object.freeze({ id: String(order.id), market: String(order.market), side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, filledAt: order.filledAt, status: "FILLED", fills: Array.isArray(order.fills) ? order.fills.slice(0, MAX_ITEMS).map((fill) => Object.freeze({ id: String(fill.id), quantity: fill.quantity, price: fill.price, filledAt: fill.filledAt })) : [] }));
  return Object.freeze({ source: "PAPER", observedAt: new Date(snapshot.generatedAt).toISOString(), orders, readAt: nowIso(now) });
}

function normalizeMarkets(payload, market, now) {
  const snapshot = normalizeOperations(payload);
  const markets = snapshot.markets.filter((item) => market === undefined || item.market === market).slice(0, MAX_ITEMS).map((item) => Object.freeze({ market: item.market, price: item.price, changeRate: item.changeRate ?? null, volume: item.volume ?? null, observedAt: item.observedAt, source: "UPBIT_PUBLIC_TICKER" }));
  return Object.freeze({ source: "UPBIT_PUBLIC", markets, readAt: nowIso(now) });
}

function normalizeAi(payload, now) {
  const snapshot = normalizeOperations(payload);
  const ai = snapshot.ai;
  const calibrated = ai && ai.calibrationStatus === "CALIBRATED" && finite(ai.confidence) ? ai.confidence : undefined;
  return Object.freeze({ source: "PAPER", status: ai?.status ?? "UNAVAILABLE", thesis: typeof ai?.thesis === "string" ? ai.thesis.slice(0, 1_000) : null, ...(calibrated === undefined ? {} : { confidence: calibrated }), evidenceCount: Array.isArray(ai?.evidenceReferences) ? Math.min(ai.evidenceReferences.length, MAX_ITEMS) : 0, uncertainty: typeof ai?.uncertainty === "string" ? ai.uncertainty.slice(0, 500) : null, explanationVerdict: ai?.explanationVerdict ?? "NOT_EVALUATED", liveAuthority: "NONE", productionMutationAllowed: false, readAt: nowIso(now) });
}

function normalizeUpbitSummary(payload, now) {
  if (!isObject(payload) || payload.provider !== "UPBIT" || payload.mode !== "READ_ONLY" || !isObject(payload.cash) || !Array.isArray(payload.assets)) throw new Error("invalid Upbit summary");
  const cash = Object.freeze({ currency: String(payload.cash.currency), available: payload.cash.available, locked: payload.cash.locked });
  const assets = payload.assets.slice(0, MAX_ITEMS).map((asset) => Object.freeze({ currency: String(asset.currency), available: asset.available, locked: asset.locked, avgBuyPrice: asset.avgBuyPrice, unitCurrency: String(asset.unitCurrency) }));
  if (!finite(cash.available) || !finite(cash.locked) || assets.some((asset) => !finite(asset.available) || !finite(asset.locked) || !finite(asset.avgBuyPrice))) throw new Error("invalid Upbit summary");
  return Object.freeze({ source: "UPBIT_READ_ONLY", fetchedAt: payload.fetchedAt, cash, assets, readAt: nowIso(now) });
}

function normalizeUpbitOrder(order) {
  if (!isObject(order) || typeof order.uuid !== "string" || typeof order.market !== "string" || !finite(order.volume) || !finite(order.executedVolume) || !finite(order.remainingVolume)) throw new Error("invalid Upbit order");
  return Object.freeze({ uuid: order.uuid, market: order.market, side: order.side, ordType: order.ordType, price: order.price == null ? null : order.price, volume: order.volume, executedVolume: order.executedVolume, remainingVolume: order.remainingVolume, state: order.state, createdAt: order.createdAt });
}

function normalizeUpbitOrders(payload, limit, now) {
  if (!Array.isArray(payload)) throw new Error("invalid Upbit orders");
  return Object.freeze({ source: "UPBIT_READ_ONLY", orders: payload.slice(0, limit).map(normalizeUpbitOrder), readAt: nowIso(now) });
}

function normalizeUpbitDetail(payload, now) {
  if (!isObject(payload) || typeof payload.uuid !== "string") throw new Error("invalid Upbit order detail");
  return Object.freeze({ source: "UPBIT_READ_ONLY", order: normalizeUpbitOrder(payload), readAt: nowIso(now) });
}

function createGateway({ config, fetchImpl = globalThis.fetch, now = Date.now, auditLog = (entry) => console.log(JSON.stringify(entry)) }) {
  const calls = new Map();
  const limits = new Map([["get_upbit_readonly_summary", 10], ["get_upbit_open_orders", 10], ["get_upbit_order_history", 10], ["get_upbit_order_detail", 10], ["get_ai_signal", 10]]);
  function rateAllowed(tool, caller) {
    const key = `${caller}:${tool}`;
    const current = calls.get(key);
    const timestamp = Date.now();
    const max = limits.get(tool) ?? 30;
    if (!current || timestamp - current.windowStart >= 60_000) { calls.set(key, { windowStart: timestamp, count: 1 }); return true; }
    if (current.count >= max) return false;
    current.count += 1;
    return true;
  }
  async function callTool(name, rawArgs, caller) {
    if (!TOOL_NAMES.has(name)) {
      auditLog({ event: "mcp.audit", tool: String(name).slice(0, 80), timestamp: new Date().toISOString(), callerRef: caller, outcome: "UNKNOWN_TOOL", latencyMs: 0 });
      return toolError(Object.assign(new Error("unknown tool"), { code: "UNKNOWN_TOOL" }));
    }
    if (!rateAllowed(name, caller)) return toolError(Object.assign(new Error("rate limited"), { code: "RATE_LIMITED" }));
    const started = Date.now();
    let outcome = "SUCCESS";
    try {
      const args = validateObjectArguments(rawArgs);
      const result = name === "nusa_health"
        ? await (async () => { const reachable = await upstreamJson({ origin: config.nusaOrigin, path: "/health", fetchImpl, requireToken: false }); return Object.freeze({ source: "NUSA_CLOUD", ok: isObject(reachable) && reachable.ok === true, checks: Object.freeze({ process: true, upstreamReachable: true, authConfigured: Buffer.byteLength(config.clientToken, "utf8") >= 32 }), observedAt: nowIso(now) }); })()
        : name === "get_paper_state" ? normalizePaperState(await upstreamJson({ origin: config.nusaOrigin, token: config.nusaToken, path: "/api/paper-operations", fetchImpl }), now)
          : name === "get_paper_portfolio" ? normalizePortfolio(await upstreamJson({ origin: config.nusaOrigin, token: config.nusaToken, path: "/api/paper-operations", fetchImpl }), now)
            : name === "get_paper_order_history" ? normalizePaperOrders(await upstreamJson({ origin: config.nusaOrigin, token: config.nusaToken, path: "/api/paper-operations", fetchImpl }), boundedLimit(args.limit) ?? (() => { throw Object.assign(new Error("invalid limit"), { code: "INVALID_ARGUMENT" }); })(), now)
              : name === "get_market_ticker" ? normalizeMarkets(await upstreamJson({ origin: config.nusaOrigin, token: config.nusaToken, path: "/api/paper-operations", fetchImpl }), validateMarket(args.market), now)
                : name === "get_ai_signal" ? normalizeAi(await upstreamJson({ origin: config.nusaOrigin, token: config.nusaToken, path: "/api/paper-operations", fetchImpl }), now)
                  : name === "get_upbit_readonly_summary" ? normalizeUpbitSummary(await upstreamJson({ origin: config.upbitOrigin, token: config.upbitToken, path: "/api/v1/account/summary", fetchImpl }), now)
                    : name === "get_upbit_open_orders" ? normalizeUpbitOrders(await upstreamJson({ origin: config.upbitOrigin, token: config.upbitToken, path: "/api/v1/orders/open", fetchImpl }), boundedLimit(args.limit) ?? (() => { throw Object.assign(new Error("invalid limit"), { code: "INVALID_ARGUMENT" }); })(), now)
                      : name === "get_upbit_order_history" ? normalizeUpbitOrders(await upstreamJson({ origin: config.upbitOrigin, token: config.upbitToken, path: "/api/v1/orders/history", fetchImpl }), boundedLimit(args.limit) ?? (() => { throw Object.assign(new Error("invalid limit"), { code: "INVALID_ARGUMENT" }); })(), now)
                        : await (async () => { const uuid = typeof args.uuid === "string" && /^[0-9a-f-]{20,64}$/i.test(args.uuid) ? args.uuid : (() => { throw Object.assign(new Error("invalid uuid"), { code: "INVALID_ARGUMENT" }); })(); return normalizeUpbitDetail(await upstreamJson({ origin: config.upbitOrigin, token: config.upbitToken, path: `/api/v1/orders/${encodeURIComponent(uuid)}`, fetchImpl }), now); })();
      return toolOk(result);
    } catch (error) {
      outcome = error?.code ?? "UPSTREAM_UNAVAILABLE";
      return toolError(error);
    } finally {
      auditLog({ event: "mcp.audit", tool: name, timestamp: new Date().toISOString(), callerRef: caller, outcome, latencyMs: Date.now() - started });
    }
  }
  return Object.freeze({
    tools: () => TOOL_DEFINITIONS,
    callTool,
    async health() { try { await upstreamJson({ origin: config.nusaOrigin, path: "/health", fetchImpl, requireToken: false }); return { process: true, upstreamReachable: true, authConfigured: true }; } catch { return { process: true, upstreamReachable: false, authConfigured: true }; } }
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => { bytes += Buffer.byteLength(chunk, "utf8"); if (bytes > MAX_BODY_BYTES) { request.resume(); reject(new Error("body too large")); } else body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function startServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = readConfig(env);
  const gateway = createGateway({ config, fetchImpl });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      if (request.method !== "GET") { response.writeHead(405, { allow: "GET" }); response.end(); return; }
      const checks = await gateway.health();
      const result = jsonResponse(checks.upstreamReachable ? 200 : 503, { ok: checks.process && checks.upstreamReachable && checks.authConfigured, service: "nusa-mcp", checks });
      response.writeHead(result.status, result.headers); response.end(result.body); return;
    }
    if (url.pathname !== MCP_PATH) { const result = jsonResponse(404, { error: "NOT_FOUND" }); response.writeHead(result.status, result.headers); response.end(result.body); return; }
    if (request.method !== "POST") { const result = jsonResponse(405, { error: "METHOD_NOT_ALLOWED" }, { allow: "POST" }); response.writeHead(result.status, result.headers); response.end(result.body); return; }
    const token = bearer(request.headers);
    if (token == null || !tokensEqual(token, config.clientToken)) { const result = jsonResponse(401, { error: "UNAUTHORIZED" }); response.writeHead(result.status, result.headers); response.end(result.body); return; }
    const caller = hashCaller(token);
    let message;
    try { message = JSON.parse(await readBody(request)); } catch { const result = jsonResponse(400, jsonRpcError(null, -32700, "Invalid JSON")); response.writeHead(result.status, result.headers); response.end(result.body); return; }
    if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") { const result = jsonResponse(400, jsonRpcError(message?.id ?? null, -32600, "Invalid Request")); response.writeHead(result.status, result.headers); response.end(result.body); return; }
    if (message.id === undefined && message.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
    let result;
    if (message.method === "initialize") result = jsonRpc(message.id ?? null, { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nusa-read-only-mcp", version: "0.1.0" } });
    else if (message.method === "tools/list") result = jsonRpc(message.id ?? null, { tools: gateway.tools() });
    else if (message.method === "tools/call") {
      if (!isObject(message.params) || typeof message.params.name !== "string") result = jsonRpcError(message.id ?? null, -32602, "Invalid tool arguments");
      else result = jsonRpc(message.id ?? null, await gateway.callTool(message.params.name, message.params.arguments, caller));
    } else result = jsonRpcError(message.id ?? null, -32601, "Method not found");
    const responseBody = jsonResponse(200, result); response.writeHead(responseBody.status, responseBody.headers); response.end(responseBody.body);
  });
  server.listen(config.port, config.host);
  return { port: config.port, host: config.host, stop: () => new Promise((resolve) => server.close(resolve)) };
}

if (require.main === module) startServer();

module.exports = { MCP_PATH, TOOL_DEFINITIONS, readConfig, createGateway, startServer, normalizePaperState, normalizePortfolio, normalizePaperOrders, normalizeMarkets, normalizeAi, normalizeUpbitSummary, normalizeUpbitOrders, normalizeUpbitDetail };
