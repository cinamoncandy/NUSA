import type { PaperRuntime, StrategyChoice } from "./paperRuntime";

export interface ApiRequest {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

const STRATEGY_CHOICES: readonly StrategyChoice[] = ["sma-crossover", "ema-crossover"];

function ok(body: unknown): ApiResponse { return { status: 200, body }; }
function notFound(): ApiResponse { return { status: 404, body: { error: "NOT_FOUND" } }; }
function methodNotAllowed(): ApiResponse { return { status: 405, body: { error: "METHOD_NOT_ALLOWED" } }; }

/** Maps a thrown domain error to an HTTP status: unavailable/stale market or persistence
 * conditions are 503 (retry later), everything else (bad input, risk-policy rejection,
 * insufficient funds/position) is 400 (caller must change the request). */
function errorResponse(error: unknown): ApiResponse {
  const message = error instanceof Error ? error.message : String(error);
  const status = /unavailable|not available yet|stale/i.test(message) ? 503 : 400;
  return { status, body: { error: message } };
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body == null || typeof body !== "object") throw new Error("request body must be a JSON object");
  return body as Record<string, unknown>;
}

function requireSide(value: unknown): "BUY" | "SELL" {
  if (value !== "BUY" && value !== "SELL") throw new Error("side must be \"BUY\" or \"SELL\"");
  return value;
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function requireStrategyChoice(value: unknown): StrategyChoice {
  if (typeof value !== "string" || !STRATEGY_CHOICES.includes(value as StrategyChoice)) {
    throw new Error(`choice must be one of: ${STRATEGY_CHOICES.join(", ")}`);
  }
  return value as StrategyChoice;
}

/**
 * Pure, framework-agnostic request handler (no node:http types here), mirroring the
 * convention already established in apps/cloud/src/mobileDashboardHttp.ts: a plain
 * function from request to response so it's directly unit-testable without a real
 * listening server. apps/server/src/httpServer.ts adapts real IncomingMessage/
 * ServerResponse objects to this shape.
 */
export function handleApiRequest(request: ApiRequest, runtime: PaperRuntime): ApiResponse {
  const { method, pathname } = request;
  try {
    if (pathname === "/api/health") {
      if (method !== "GET") return methodNotAllowed();
      return ok({ status: "ok" });
    }
    if (pathname === "/api/market") {
      if (method !== "GET") return methodNotAllowed();
      return ok(runtime.getMarket());
    }
    if (pathname === "/api/chart/candles") {
      if (method !== "GET") return methodNotAllowed();
      return ok({ candles: runtime.getChartCandles() });
    }
    if (pathname === "/api/account") {
      if (method !== "GET") return methodNotAllowed();
      return ok(runtime.getAccountSnapshot());
    }
    if (pathname === "/api/control") {
      if (method !== "GET") return methodNotAllowed();
      return ok(runtime.getControlSnapshot());
    }
    if (pathname === "/api/dashboard") {
      if (method !== "GET") return methodNotAllowed();
      return ok(runtime.getDashboard());
    }
    if (pathname === "/api/reference-accounting") {
      if (method !== "GET") return methodNotAllowed();
      return ok(runtime.getReferenceAccounting());
    }
    if (pathname === "/api/orders") {
      if (method !== "POST") return methodNotAllowed();
      const body = asRecord(request.body);
      const side = requireSide(body.side);
      const quantity = requireFiniteNumber(body.quantity, "quantity");
      return ok(runtime.placeOrder(side, quantity));
    }
    if (pathname === "/api/strategy/start") {
      if (method !== "POST") return methodNotAllowed();
      return ok(runtime.startStrategy());
    }
    if (pathname === "/api/strategy/stop") {
      if (method !== "POST") return methodNotAllowed();
      return ok(runtime.stopStrategy());
    }
    if (pathname === "/api/strategy/auto-trade") {
      if (method !== "POST") return methodNotAllowed();
      const body = asRecord(request.body);
      return ok(runtime.setAutoTrade(requireBoolean(body.enabled, "enabled")));
    }
    if (pathname === "/api/strategy/quantity") {
      if (method !== "POST") return methodNotAllowed();
      const body = asRecord(request.body);
      return ok(runtime.setOrderQuantity(requireFiniteNumber(body.quantity, "quantity")));
    }
    if (pathname === "/api/strategy/select") {
      if (method !== "POST") return methodNotAllowed();
      const body = asRecord(request.body);
      return ok(runtime.selectStrategy(requireStrategyChoice(body.choice)));
    }
    return notFound();
  } catch (error) {
    return errorResponse(error);
  }
}
