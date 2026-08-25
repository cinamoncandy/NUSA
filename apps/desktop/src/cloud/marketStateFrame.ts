import type { HistoricalDatasetManifest, ResearchCandle } from "./researchDataset";
import { verifyHistoricalDatasetManifest } from "./researchDataset";

export interface MarketStateInput {
  readonly manifest: HistoricalDatasetManifest;
  readonly candles: readonly ResearchCandle[];
}

export interface MarketStateObservation {
  readonly market: string;
  readonly interval: HistoricalDatasetManifest["interval"];
  readonly datasetId: string;
  readonly asOf: number;
  readonly lastClose: number;
  readonly onePeriodReturn: number;
  readonly lookbackReturn: number;
  readonly realizedVolatility: number;
  readonly maxDrawdown: number;
  readonly averageVolume: number;
  readonly averageQuoteVolume?: number;
}

export interface MarketStateFrame {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly lookbackPeriods: number;
  readonly markets: readonly MarketStateObservation[];
  readonly aggregate: Readonly<{
    marketCount: number;
    positiveBreadth: number;
    medianLookbackReturn: number;
    medianRealizedVolatility: number;
    crossSectionalDispersion: number;
  }>;
  readonly sourceDatasetIds: readonly string[];
}

export class MarketStateFrameError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MarketStateFrameError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new MarketStateFrameError(code, message);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function maxDrawdown(closes: readonly number[]): number {
  let peak = closes[0]!;
  let worst = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    worst = Math.min(worst, close / peak - 1);
  }
  return worst;
}

function buildObservation(input: MarketStateInput, lookbackPeriods: number): MarketStateObservation {
  const validated = verifyHistoricalDatasetManifest(input.manifest, input.candles);
  if (validated.candles.length < lookbackPeriods + 1) {
    throw new MarketStateFrameError(
      "INSUFFICIENT_LOOKBACK",
      `${input.manifest.datasetId} requires at least ${lookbackPeriods + 1} candles`,
    );
  }

  const window = validated.candles.slice(-(lookbackPeriods + 1));
  const closes = window.map((candle) => candle.close);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]!));
  const last = window.at(-1)!;
  const prior = window.at(-2)!;
  const quoteVolumes = window
    .slice(1)
    .map((candle) => candle.quoteVolume)
    .filter((value): value is number => value != null);

  const observation: MarketStateObservation = {
    market: input.manifest.market,
    interval: input.manifest.interval,
    datasetId: input.manifest.datasetId,
    asOf: last.closeTime,
    lastClose: last.close,
    onePeriodReturn: last.close / prior.close - 1,
    lookbackReturn: last.close / window[0]!.close - 1,
    realizedVolatility: standardDeviation(returns),
    maxDrawdown: maxDrawdown(closes),
    averageVolume: mean(window.slice(1).map((candle) => candle.volume)),
    averageQuoteVolume: quoteVolumes.length === lookbackPeriods ? mean(quoteVolumes) : undefined,
  };

  for (const [name, value] of Object.entries(observation)) {
    if (typeof value === "number") assertFinite(value, "NON_FINITE_METRIC", `${input.manifest.datasetId} produced non-finite ${name}`);
  }

  return freeze(observation) as MarketStateObservation;
}

export function buildMarketStateFrame(
  inputs: readonly MarketStateInput[],
  options: { readonly lookbackPeriods?: number; readonly generatedAt?: string } = {},
): MarketStateFrame {
  if (inputs.length === 0) throw new MarketStateFrameError("EMPTY_INPUT", "market state frame requires at least one dataset");

  const lookbackPeriods = options.lookbackPeriods ?? 20;
  if (!Number.isInteger(lookbackPeriods) || lookbackPeriods < 2) {
    throw new MarketStateFrameError("INVALID_LOOKBACK", "lookbackPeriods must be an integer >= 2");
  }

  const generatedAt = options.generatedAt ?? "1970-01-01T00:00:00.000Z";
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new MarketStateFrameError("INVALID_GENERATED_AT", "generatedAt must be a valid timestamp");
  }

  const seen = new Set<string>();
  const markets = inputs
    .map((input) => {
      const identity = `${input.manifest.market}::${input.manifest.interval}`;
      if (seen.has(identity)) throw new MarketStateFrameError("DUPLICATE_MARKET_INTERVAL", `duplicate market/interval ${identity}`);
      seen.add(identity);
      return buildObservation(input, lookbackPeriods);
    })
    .sort((a, b) => a.market.localeCompare(b.market) || a.interval.localeCompare(b.interval));

  const lookbackReturns = markets.map((market) => market.lookbackReturn);
  const volatilities = markets.map((market) => market.realizedVolatility);
  const averageReturn = mean(lookbackReturns);
  const crossSectionalDispersion = Math.sqrt(
    mean(lookbackReturns.map((value) => (value - averageReturn) ** 2)),
  );

  const frame: MarketStateFrame = {
    schemaVersion: 1,
    generatedAt,
    lookbackPeriods,
    markets: Object.freeze(markets),
    aggregate: freeze({
      marketCount: markets.length,
      positiveBreadth: markets.filter((market) => market.lookbackReturn > 0).length / markets.length,
      medianLookbackReturn: median(lookbackReturns),
      medianRealizedVolatility: median(volatilities),
      crossSectionalDispersion,
    }),
    sourceDatasetIds: Object.freeze(markets.map((market) => market.datasetId)),
  };

  return freeze(frame) as MarketStateFrame;
}
