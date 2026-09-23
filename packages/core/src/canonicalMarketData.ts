import { createHash } from "node:crypto";
import type { UpbitPublicMessage } from "./upbitWebSocket";

export const CANONICAL_MARKET_EVENT_SCHEMA_VERSION = 1 as const;
export const UPBIT_PUBLIC_NORMALIZER_VERSION = "upbit-public-v1" as const;

export type CanonicalMarketStream = "TICKER" | "TRADE" | "ORDERBOOK";
export type MarketEventIntegrity = "ACCEPTED" | "DUPLICATE" | "OUT_OF_ORDER" | "GAP_SUSPECT";

export interface CanonicalMarketEvent {
  readonly schemaVersion: 1;
  readonly provider: "UPBIT";
  readonly source: "PUBLIC_WEBSOCKET";
  readonly normalizerVersion: typeof UPBIT_PUBLIC_NORMALIZER_VERSION;
  readonly stream: CanonicalMarketStream;
  readonly market: string;
  readonly exchangeTimestamp: number | null;
  readonly receivedAt: number;
  readonly sequence: string | null;
  readonly integrity: MarketEventIntegrity;
  readonly sourceFingerprint: string;
  readonly payload: UpbitPublicMessage;
}

export interface MarketStreamCursor {
  readonly exchangeTimestamp: number | null;
  readonly sequence: string | null;
  readonly sourceFingerprint: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex");
}

function exchangeTimestamp(message: UpbitPublicMessage): number | null {
  return message.type === "ticker" || message.type === "trade" ? message.trade_timestamp : null;
}

function sequence(message: UpbitPublicMessage): string | null {
  // sequential_id arrives through JSON as a Number and can exceed the safe-integer range.
  // It is therefore provenance only; it is never used as a precise ordering key.
  return message.type === "trade" && message.sequential_id != null ? String(message.sequential_id) : null;
}

export function canonicalUpbitSourceFingerprint(message: UpbitPublicMessage): string {
  return fingerprint({
    provider: "UPBIT",
    source: "PUBLIC_WEBSOCKET",
    normalizerVersion: UPBIT_PUBLIC_NORMALIZER_VERSION,
    payload: message
  });
}

export function classifyMarketEventIntegrity(
  message: UpbitPublicMessage,
  prior?: MarketStreamCursor,
): MarketEventIntegrity {
  const currentFingerprint = canonicalUpbitSourceFingerprint(message);
  if (!prior) return "ACCEPTED";
  if (currentFingerprint === prior.sourceFingerprint) return "DUPLICATE";
  const currentTimestamp = exchangeTimestamp(message);
  if (currentTimestamp != null && prior.exchangeTimestamp != null && currentTimestamp < prior.exchangeTimestamp) {
    return "OUT_OF_ORDER";
  }
  // Upbit's public payload does not provide a safe, lossless sequence for all channels.
  // Never fabricate a definitive gap. A forward timestamp jump is only a suspicion signal.
  if (currentTimestamp != null && prior.exchangeTimestamp != null && currentTimestamp > prior.exchangeTimestamp + 60_000) {
    return "GAP_SUSPECT";
  }
  return "ACCEPTED";
}

export function normalizeUpbitPublicEvent(
  message: UpbitPublicMessage,
  receivedAt: number,
  prior?: MarketStreamCursor,
): CanonicalMarketEvent {
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new Error("receivedAt must be a non-negative safe integer");
  const sourceFingerprint = canonicalUpbitSourceFingerprint(message);
  return Object.freeze({
    schemaVersion: CANONICAL_MARKET_EVENT_SCHEMA_VERSION,
    provider: "UPBIT",
    source: "PUBLIC_WEBSOCKET",
    normalizerVersion: UPBIT_PUBLIC_NORMALIZER_VERSION,
    stream: message.type.toUpperCase() as CanonicalMarketStream,
    market: message.code,
    exchangeTimestamp: exchangeTimestamp(message),
    receivedAt,
    sequence: sequence(message),
    integrity: classifyMarketEventIntegrity(message, prior),
    sourceFingerprint,
    payload: message
  });
}

export function marketStreamCursor(event: CanonicalMarketEvent): MarketStreamCursor {
  return Object.freeze({
    exchangeTimestamp: event.exchangeTimestamp,
    sequence: event.sequence,
    sourceFingerprint: event.sourceFingerprint
  });
}
