export interface ShadowStartCommand { readonly symbol: string; readonly strategyId: string; readonly strategyVersion: string; }
export interface ShadowSessionCommand { readonly sessionId: string; }
const exact = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid Shadow command payload");
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw new Error("Shadow command payload contains unexpected fields");
  return candidate;
};
export function parseShadowStart(value: unknown): ShadowStartCommand { const candidate = exact(value, ["symbol", "strategyId", "strategyVersion"]); if (![candidate.symbol, candidate.strategyId, candidate.strategyVersion].every((item) => typeof item === "string" && item.length > 0)) throw new Error("invalid Shadow start payload"); return Object.freeze({ symbol: candidate.symbol as string, strategyId: candidate.strategyId as string, strategyVersion: candidate.strategyVersion as string }); }
export function parseShadowSession(value: unknown): ShadowSessionCommand { const candidate = exact(value, ["sessionId"]); if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) throw new Error("invalid Shadow session payload"); return Object.freeze({ sessionId: candidate.sessionId }); }
export function parseShadowStatus(value: unknown): Record<string, never> { exact(value, []); return Object.freeze({}); }
