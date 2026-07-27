/**
 * Exact-allowlist payload validators for the shadow:* IPC channels (WO-0034-A2).
 *
 * Every parser rejects extra fields, arrays, null, and malformed values rather than
 * loosely coercing them, so a renderer cannot smuggle an arbitrary limits/approval/broker
 * object through a shadow:* channel.
 */

export const SHADOW_ALLOWED_SYMBOL = "KRW-BTC";
export const SHADOW_ALLOWED_STRATEGY_ID = "sma-crossover";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseShadowStartIpc(input: unknown): Readonly<{ symbol: string; strategyId: string }> {
  if (!isPlainObject(input)) throw new Error("invalid shadow:start input");
  if (Object.keys(input).sort().join(",") !== "strategyId,symbol") throw new Error("invalid shadow:start input");
  if (input.symbol !== SHADOW_ALLOWED_SYMBOL) throw new Error("unsupported shadow:start symbol");
  if (input.strategyId !== SHADOW_ALLOWED_STRATEGY_ID) throw new Error("unsupported shadow:start strategyId");
  return Object.freeze({ symbol: input.symbol, strategyId: input.strategyId });
}

export function parseShadowSessionIpc(input: unknown): Readonly<{ sessionId: string }> {
  if (!isPlainObject(input)) throw new Error("invalid shadow session input");
  if (Object.keys(input).sort().join(",") !== "sessionId") throw new Error("invalid shadow session input");
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) throw new Error("invalid shadow session input");
  return Object.freeze({ sessionId: input.sessionId });
}

export function parseShadowStatusIpc(input: unknown): Readonly<Record<string, never>> {
  if (input == null) return Object.freeze({});
  if (!isPlainObject(input) || Object.keys(input).length !== 0) throw new Error("invalid shadow:status input");
  return Object.freeze({});
}
