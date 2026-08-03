export type AiEventType = "TRADE" | "PORTFOLIO_SNAPSHOT" | "MARKET_SNAPSHOT" | "ANALYTICS" | "STRATEGY" | "RISK";

export interface AiDataEvent { readonly type: AiEventType; readonly timestamp: number; readonly payload: Readonly<Record<string, string | number | boolean | null | readonly number[]>>; }
export interface FeatureVector { readonly eventType: AiEventType; readonly timestamp: number; readonly values: readonly number[]; }
export interface AiDatasetExport { readonly datasetVersion: string; readonly generatedAt: number; readonly events: readonly AiDataEvent[]; readonly featureVectors: readonly FeatureVector[]; readonly checksum: string; }

const EVENT_TYPES: readonly AiEventType[] = ["TRADE", "PORTFOLIO_SNAPSHOT", "MARKET_SNAPSHOT", "ANALYTICS", "STRATEGY", "RISK"];
const SENSITIVE_KEYS = /account|user|email|phone|token|secret|api.?key|credential|order.?id|client.?id/i;
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const checksum = (value: unknown): string => { let hash = 2166136261; for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); };

function anonymize(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number | boolean | null | readonly number[]>> {
  const result: Record<string, string | number | boolean | null | readonly number[]> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))) result[key] = Object.freeze([...value]);
  }
  return Object.freeze(result);
}

export class AiDataPipeline {
  private readonly events: AiDataEvent[] = [];
  public constructor(public readonly datasetVersion = "paper-ai-v1") { if (!datasetVersion.trim()) throw new Error("datasetVersion is required"); }
  public record(type: AiEventType, timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent {
    if (!EVENT_TYPES.includes(type)) throw new Error("unsupported AI event type");
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("timestamp is invalid");
    const event = Object.freeze({ type, timestamp, payload: anonymize(payload) });
    this.events.push(event);
    return event;
  }
  public recordTradeEvent(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("TRADE", timestamp, payload); }
  public recordPortfolioSnapshot(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("PORTFOLIO_SNAPSHOT", timestamp, payload); }
  public recordMarketSnapshot(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("MARKET_SNAPSHOT", timestamp, payload); }
  public recordAnalytics(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("ANALYTICS", timestamp, payload); }
  public recordStrategyLog(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("STRATEGY", timestamp, payload); }
  public recordRiskEvent(timestamp: number, payload: Readonly<Record<string, unknown>>): AiDataEvent { return this.record("RISK", timestamp, payload); }
  public featureVectors(): readonly FeatureVector[] { return Object.freeze(this.events.map((event) => Object.freeze({ eventType: event.type, timestamp: event.timestamp, values: Object.freeze(Object.values(event.payload).flatMap((value) => typeof value === "number" && Number.isFinite(value) ? [value] : Array.isArray(value) ? value : [])) }))); }
  public export(): AiDatasetExport { const events = Object.freeze(this.events.map((event) => Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) }))); const featureVectors = this.featureVectors(); const body = { datasetVersion: this.datasetVersion, generatedAt: this.events.at(-1)?.timestamp ?? 0, events, featureVectors }; return Object.freeze({ ...body, checksum: checksum(body) }); }
}

export function verifyAiDatasetExport(dataset: AiDatasetExport): boolean { if (!dataset.datasetVersion.trim() || !Number.isSafeInteger(dataset.generatedAt) || !Array.isArray(dataset.events) || !Array.isArray(dataset.featureVectors)) return false; const { checksum: expected, ...body } = dataset; return checksum(body) === expected; }
