export type CarryInstrumentKind = "SPOT" | "PERPETUAL";

export interface ExchangeInstrumentMetadata {
  readonly venue: string;
  readonly symbol: string;
  readonly kind: CarryInstrumentKind;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly active: boolean;
  readonly contractMultiplier?: number;
  readonly quantityStep?: number;
  readonly minimumQuantity?: number;
}

export interface SpotPerpetualPair {
  readonly venue: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly spot: ExchangeInstrumentMetadata;
  readonly perpetual: ExchangeInstrumentMetadata;
}

export class ExchangeSymbolResolutionError extends Error {
  constructor(readonly code: "INVALID_METADATA" | "MISSING_PAIR" | "AMBIGUOUS_PAIR") {
    super(code);
    this.name = "ExchangeSymbolResolutionError";
  }
}

const text = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!normalized) throw new ExchangeSymbolResolutionError("INVALID_METADATA");
  return normalized;
};

const nonNegative = (value: number | undefined): void => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ExchangeSymbolResolutionError("INVALID_METADATA");
  }
};

const normalize = (item: ExchangeInstrumentMetadata): ExchangeInstrumentMetadata => {
  const venue = text(item.venue);
  const symbol = text(item.symbol);
  const baseAsset = text(item.baseAsset);
  const quoteAsset = text(item.quoteAsset);
  nonNegative(item.quantityStep);
  nonNegative(item.minimumQuantity);
  if (item.kind === "PERPETUAL" && (!Number.isFinite(item.contractMultiplier) || item.contractMultiplier! <= 0)) {
    throw new ExchangeSymbolResolutionError("INVALID_METADATA");
  }
  return Object.freeze({ ...item, venue, symbol, baseAsset, quoteAsset });
};

export function resolveSpotPerpetualPair(
  instruments: readonly ExchangeInstrumentMetadata[],
  requested: Readonly<{ venue: string; baseAsset: string; quoteAsset: string }>
): SpotPerpetualPair {
  const venue = text(requested.venue);
  const baseAsset = text(requested.baseAsset);
  const quoteAsset = text(requested.quoteAsset);
  const matches = instruments.map(normalize).filter((item) =>
    item.active && item.venue === venue && item.baseAsset === baseAsset && item.quoteAsset === quoteAsset
  );
  const spots = matches.filter((item) => item.kind === "SPOT").sort((a, b) => a.symbol.localeCompare(b.symbol));
  const perpetuals = matches.filter((item) => item.kind === "PERPETUAL").sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (spots.length === 0 || perpetuals.length === 0) throw new ExchangeSymbolResolutionError("MISSING_PAIR");
  if (spots.length !== 1 || perpetuals.length !== 1) throw new ExchangeSymbolResolutionError("AMBIGUOUS_PAIR");
  return Object.freeze({ venue, baseAsset, quoteAsset, spot: spots[0], perpetual: perpetuals[0] });
}
