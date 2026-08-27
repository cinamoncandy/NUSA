import { createHash } from "node:crypto";
import type { BacktestExecutionCosts, BacktestPoint } from "../strategy/backtestEngine";
import { runWalkForward, type WalkForwardCandidate, type WalkForwardConfig, type WalkForwardResult } from "../strategy/walkForwardEngine";

export type ResearchInterval = "1m" | "3m" | "5m" | "10m" | "15m" | "30m" | "60m" | "240m" | "1d";
export type CandleContinuityStatus = "CONTIGUOUS" | "MISSING_INTERVALS" | "IRREGULAR_INTERVAL" | "DUPLICATE" | "OVERLAP";
export type MissingCandlePolicy = "REJECT" | "ALLOW";

export interface ResearchCandle {
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
export interface ResearchDatasetValidation { readonly candles: readonly ResearchCandle[]; readonly continuityStatus: CandleContinuityStatus; readonly missingCandleCount: number; readonly missingRanges: readonly MissingCandleRange[]; readonly warnings: readonly string[]; }

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
export interface ResearchDataset { readonly candles: readonly ResearchCandle[]; readonly manifest: HistoricalDatasetManifest; }

export interface ResearchExperimentResult {
  readonly manifest: HistoricalDatasetManifest;
  readonly experimentConfig: Readonly<{ walkForward: WalkForwardConfig; candidates: readonly Readonly<{ id: string; parameters?: Readonly<Record<string, string | number | boolean>> }>[]; executionCosts: BacktestExecutionCosts; }>;
  readonly walkForwardResult: WalkForwardResult;
  readonly generatedAt: string;
  readonly warnings: readonly string[];
}

export class ResearchDatasetError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ResearchDatasetError"; }
}

const INTERVAL_MS: Readonly<Record<ResearchInterval, number>> = Object.freeze({ "1m": 60_000, "3m": 180_000, "5m": 300_000, "10m": 600_000, "15m": 900_000, "30m": 1_800_000, "60m": 3_600_000, "240m": 14_400_000, "1d": 86_400_000 });
const DEFAULT_MANIFEST_CREATED_AT = "1970-01-01T00:00:00.000Z";
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finiteInteger = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value);
const validInterval = (value: string): value is ResearchInterval => Object.prototype.hasOwnProperty.call(INTERVAL_MS, value);

function assertManifestCreatedAt(createdAt: string, endCloseTime: number): void {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) throw new ResearchDatasetError("INVALID_CREATED_AT", "manifest createdAt must be a valid timestamp");
  if (createdAt !== DEFAULT_MANIFEST_CREATED_AT && createdAtMs < endCloseTime) {
    throw new ResearchDatasetError("INVALID_CREATED_AT", "manifest createdAt cannot precede the final candle closeTime");
  }
}

function assertCandle(candle: ResearchCandle, index: number): void {
  if (!candle.market.trim()) throw new ResearchDatasetError("EMPTY_MARKET", `candle ${index} market is required`);
  if (!validInterval(candle.interval)) throw new ResearchDatasetError("UNSUPPORTED_INTERVAL", `candle ${index} interval is unsupported`);
  if (!finiteInteger(candle.openTime) || !finiteInteger(candle.closeTime) || candle.openTime >= candle.closeTime) throw new ResearchDatasetError("INVALID_TIME_RANGE", `candle ${index} has an invalid time range`);
  if (candle.closeTime - candle.openTime !== INTERVAL_MS[candle.interval]) throw new ResearchDatasetError("IRREGULAR_INTERVAL", `candle ${index} duration does not match interval`);
  for (const [name, value] of [["open", candle.open], ["high", candle.high], ["low", candle.low], ["close", candle.close]] as const) if (!Number.isFinite(value) || value <= 0) throw new ResearchDatasetError("INVALID_PRICE", `candle ${index} ${name} must be positive and finite`);
  if (!Number.isFinite(candle.volume) || candle.volume < 0) throw new ResearchDatasetError("INVALID_VOLUME", `candle ${index} volume must be finite and non-negative`);
  if (candle.quoteVolume != null && (!Number.isFinite(candle.quoteVolume) || candle.quoteVolume < 0)) throw new ResearchDatasetError("INVALID_QUOTE_VOLUME", `candle ${index} quoteVolume must be finite and non-negative`);
  if (candle.tradeCount != null && (!finiteInteger(candle.tradeCount) || candle.tradeCount < 0)) throw new ResearchDatasetError("INVALID_TRADE_COUNT", `candle ${index} tradeCount must be a non-negative integer`);
  if (candle.low > candle.high || candle.open < candle.low || candle.open > candle.high || candle.close < candle.low || candle.close > candle.high) throw new ResearchDatasetError("INVALID_OHLC", `candle ${index} violates OHLC bounds`);
}

export function validateResearchCandles(candles: readonly ResearchCandle[], options: { readonly allowMissing?: boolean } = {}): ResearchDatasetValidation {
  if (candles.length === 0) throw new ResearchDatasetError("EMPTY_DATASET", "research dataset requires at least one candle");
  const first = candles[0]!; const missingRanges: MissingCandleRange[] = [];
  assertCandle(first, 0);
  for (let index = 1; index < candles.length; index += 1) {
    const prior = candles[index - 1]!; const candle = candles[index]!; assertCandle(candle, index);
    if (candle.market !== first.market || candle.interval !== first.interval) throw new ResearchDatasetError("MIXED_DATASET_METADATA", "dataset market and interval must be fixed");
    if (candle.openTime === prior.openTime) throw new ResearchDatasetError("DUPLICATE", `duplicate candle at ${candle.openTime}`);
    if (candle.openTime < prior.openTime) throw new ResearchDatasetError("REVERSE_ORDER", `candle order reverses at ${candle.openTime}`);
    if (candle.openTime < prior.closeTime) throw new ResearchDatasetError("OVERLAP", `candle ranges overlap at ${candle.openTime}`);
    if (candle.openTime > prior.closeTime) {
      const gap = candle.openTime - prior.closeTime; const interval = INTERVAL_MS[first.interval];
      if (gap % interval !== 0) throw new ResearchDatasetError("IRREGULAR_INTERVAL", `candle gap is not a whole interval at ${candle.openTime}`);
      missingRanges.push(freeze({ afterCloseTime: prior.closeTime, beforeOpenTime: candle.openTime, missingIntervals: gap / interval }));
    }
  }
  const missingCandleCount = missingRanges.reduce((sum, range) => sum + range.missingIntervals, 0);
  if (missingCandleCount > 0 && !options.allowMissing) throw new ResearchDatasetError("MISSING_INTERVALS", `dataset has ${missingCandleCount} missing candle intervals`);
  return freeze({ candles: Object.freeze(candles.map((candle) => freeze({ ...candle }))), continuityStatus: missingCandleCount === 0 ? "CONTIGUOUS" : "MISSING_INTERVALS", missingCandleCount, missingRanges: Object.freeze(missingRanges), warnings: Object.freeze(missingCandleCount ? [`MISSING_CANDLES_ALLOWED:${missingCandleCount}`] : []) });
}

function canonicalCandle(candle: ResearchCandle): Record<string, string | number> {
  const output: Record<string, string | number> = { market: candle.market, interval: candle.interval, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
  if (candle.quoteVolume != null) output.quoteVolume = candle.quoteVolume;
  if (candle.tradeCount != null) output.tradeCount = candle.tradeCount;
  return output;
}

export function canonicalSerializeCandles(candles: readonly ResearchCandle[]): string {
  const validated = validateResearchCandles(candles, { allowMissing: true });
  return JSON.stringify(validated.candles.map(canonicalCandle));
}

export function calculateCandleSha256(candles: readonly ResearchCandle[]): string { return createHash("sha256").update(canonicalSerializeCandles(candles), "utf8").digest("hex"); }

function datePart(timestamp: number): string { return new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", ""); }
function datasetId(source: string, candles: readonly ResearchCandle[], hash: string): string { const first = candles[0]!; const last = candles[candles.length - 1]!; return `${source.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.market.replace(/[^a-zA-Z0-9]+/g, "-")}_${first.interval}_${datePart(first.openTime)}_${datePart(last.closeTime)}_${hash.slice(0, 12)}`; }

export function createHistoricalDatasetManifest(candles: readonly ResearchCandle[], options: CreateManifestOptions): HistoricalDatasetManifest {
  if (!options.source.trim()) throw new ResearchDatasetError("EMPTY_SOURCE", "manifest source is required");
  const validated = validateResearchCandles(candles, { allowMissing: options.allowMissing }); const first = validated.candles[0]!; const last = validated.candles.at(-1)!; const contentSha256 = calculateCandleSha256(validated.candles);
  const createdAt = options.createdAt ?? DEFAULT_MANIFEST_CREATED_AT;
  assertManifestCreatedAt(createdAt, last.closeTime);
  return freeze({ schemaVersion: 1, datasetId: datasetId(options.source, validated.candles, contentSha256), source: options.source, market: first.market, interval: first.interval, candleCount: validated.candles.length, startOpenTime: first.openTime, endCloseTime: last.closeTime, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: options.allowMissing ? "ALLOW" : "REJECT", missingCandleCount: validated.missingCandleCount, createdAt, contentSha256, sourceRequest: options.sourceRequest, notes: options.notes });
}

export function verifyHistoricalDatasetManifest(manifest: HistoricalDatasetManifest, candles: readonly ResearchCandle[]): ResearchDatasetValidation {
  if (manifest.schemaVersion !== 1) throw new ResearchDatasetError("UNSUPPORTED_SCHEMA_VERSION", "manifest schemaVersion is unsupported");
  if (!manifest.source.trim()) throw new ResearchDatasetError("EMPTY_SOURCE", "manifest source is required");
  if (manifest.ordering !== "OPEN_TIME_ASC" || manifest.timezone !== "UTC") throw new ResearchDatasetError("INVALID_MANIFEST_ORDERING", "manifest ordering or timezone is unsupported");
  const validated = validateResearchCandles(candles, { allowMissing: manifest.missingCandlePolicy === "ALLOW" }); const first = validated.candles[0]!; const last = validated.candles.at(-1)!;
  assertManifestCreatedAt(manifest.createdAt, last.closeTime);
  if (manifest.market !== first.market || manifest.interval !== first.interval) throw new ResearchDatasetError("MANIFEST_METADATA_MISMATCH", "manifest market or interval does not match candles");
  if (manifest.candleCount !== validated.candles.length || manifest.startOpenTime !== first.openTime || manifest.endCloseTime !== last.closeTime) throw new ResearchDatasetError("MANIFEST_RANGE_MISMATCH", "manifest count or candle range does not match candles");
  if (manifest.missingCandleCount !== validated.missingCandleCount) throw new ResearchDatasetError("MANIFEST_MISSING_POLICY_MISMATCH", "manifest missing candle count does not match candles");
  const contentSha256 = calculateCandleSha256(validated.candles);
  if (manifest.contentSha256 !== contentSha256) throw new ResearchDatasetError("CHECKSUM_MISMATCH", "manifest checksum does not match candle content");
  if (manifest.datasetId !== datasetId(manifest.source, validated.candles, contentSha256)) throw new ResearchDatasetError("DATASET_ID_MISMATCH", "manifest datasetId does not match source and candle content");
  return validated;
}

export function candlesToBacktestPoints(candles: readonly ResearchCandle[]): readonly BacktestPoint[] {
  const validated = validateResearchCandles(candles, { allowMissing: true });
  return Object.freeze(validated.candles.map((candle) => freeze({ timestamp: candle.closeTime, close: candle.close })));
}

export function runWalkForwardExperiment(dataset: ResearchDataset, candidates: readonly WalkForwardCandidate[], config: WalkForwardConfig, options: { readonly generatedAt?: string } = {}): ResearchExperimentResult {
  const validated = verifyHistoricalDatasetManifest(dataset.manifest, dataset.candles); const walkForwardResult = runWalkForward(candlesToBacktestPoints(validated.candles), candidates, config);
  const warnings = [...validated.warnings, ...walkForwardResult.warnings];
  if (walkForwardResult.windows.some((window) => window.testResult.openPosition.status === "OPEN_POSITION") && !warnings.includes("OPEN_POSITION_MARKED_AT_WINDOW_END")) warnings.push("OPEN_POSITION_MARKED_AT_WINDOW_END");
  return freeze({ manifest: freeze({ ...dataset.manifest }), experimentConfig: freeze({ walkForward: freeze({ ...config }), candidates: Object.freeze(candidates.map((candidate) => freeze({ id: candidate.id, parameters: candidate.parameters == null ? undefined : freeze({ ...candidate.parameters }) }))), executionCosts: freeze({ ...(config.backtestConfig?.executionCosts ?? {}) }) }), walkForwardResult, generatedAt: options.generatedAt ?? "1970-01-01T00:00:00.000Z", warnings: Object.freeze(warnings) });
}
