import { createHash } from "node:crypto";

export type ResearchInterval = "1m" | "3m" | "5m" | "10m" | "15m" | "30m" | "60m" | "240m" | "1d";
export type CandleContinuityStatus = "CONTIGUOUS" | "MISSING_INTERVALS" | "IRREGULAR_INTERVAL" | "DUPLICATE" | "OVERLAP";
export type MissingCandlePolicy = "REJECT" | "ALLOW";

export interface CanonicalResearchCandle {
  readonly market: string;
  readonly interval: ResearchInterval;
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly quoteVolume?: number;
  readonly tradeCount?: number;
}

export interface MissingCandleRange { readonly afterCloseTime: number; readonly beforeOpenTime: number; readonly missingIntervals: number; }
export interface ResearchDatasetValidation { readonly candles: readonly CanonicalResearchCandle[]; readonly continuityStatus: CandleContinuityStatus; readonly missingCandleCount: number; readonly missingRanges: readonly MissingCandleRange[]; readonly warnings: readonly string[]; }
export interface HistoricalDatasetManifest {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly source: string;
  readonly market: string;
  readonly interval: ResearchInterval;
  readonly candleCount: number;
  readonly startOpenTime: number;
  readonly endCloseTime: number;
  readonly timezone: "UTC";
  readonly ordering: "OPEN_TIME_ASC";
  readonly missingCandlePolicy: MissingCandlePolicy;
  readonly missingCandleCount: number;
  readonly createdAt: string;
  readonly contentSha256: string;
  readonly sourceRequest?: string;
  readonly notes?: string;
}
export interface CreateManifestOptions { readonly source: string; readonly allowMissing?: boolean; readonly createdAt?: string; readonly sourceRequest?: string; readonly notes?: string; }

function canonicalCandle(candle: CanonicalResearchCandle): Record<string, string | number> {
  const output: Record<string, string | number> = { market: candle.market, interval: candle.interval, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
  if (candle.quoteVolume != null) output.quoteVolume = candle.quoteVolume;
  if (candle.tradeCount != null) output.tradeCount = candle.tradeCount;
  return output;
}

export function canonicalSerializeResearchCandles(candles: readonly CanonicalResearchCandle[]): string {
  return JSON.stringify(candles.map(canonicalCandle));
}

export function calculateResearchCandleSha256(candles: readonly CanonicalResearchCandle[]): string {
  return createHash("sha256").update(canonicalSerializeResearchCandles(candles), "utf8").digest("hex");
}

export function calculateResearchDatasetId(source: string, candles: readonly CanonicalResearchCandle[], contentSha256: string): string {
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const datePart = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
  return `${source.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.market.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.interval}_${datePart(first.openTime)}_${datePart(last.closeTime)}_${contentSha256.slice(0, 12)}`;
}
