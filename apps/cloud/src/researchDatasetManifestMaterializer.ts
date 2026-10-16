import { calculateResearchCandleSha256, calculateResearchDatasetId, type CanonicalResearchCandle, type HistoricalDatasetManifest, type ResearchInterval } from "../../../packages/contracts/src/researchDatasetSemantics";
import { SqliteResearchDatasetManifestStore } from "../../../packages/storage/src/index";
import type { StoredResearchCandle } from "../../../packages/storage/src/researchCandleStore";

const intervalName = (intervalMs: number): ResearchInterval => {
  const names: Readonly<Record<number, ResearchInterval>> = { 60_000: "1m", 180_000: "3m", 300_000: "5m", 600_000: "10m", 900_000: "15m", 1_800_000: "30m", 3_600_000: "60m", 14_400_000: "240m", 86_400_000: "1d" };
  const interval = names[intervalMs];
  if (interval == null) throw new Error("unsupported canonical dataset interval");
  return interval;
};

export function materializeResearchDatasetManifest(input: {
  readonly store: SqliteResearchDatasetManifestStore;
  readonly market: string;
  readonly intervalMs: number;
  readonly candles: readonly StoredResearchCandle[];
  readonly source: string;
  readonly createdAt: string;
}): HistoricalDatasetManifest {
  if (!input.source.trim()) throw new Error("canonical dataset source is required");
  if (!/^KRW-[A-Z0-9-]+$/.test(input.market)) throw new Error("canonical dataset market is invalid");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("canonical dataset createdAt is invalid");
  if (input.candles.length === 0 || input.candles.some((candle) => candle.volume == null)) throw new Error("canonical dataset requires explicit OHLCV candles");
  const interval = intervalName(input.intervalMs);
  const candles: readonly CanonicalResearchCandle[] = input.candles.map((candle) => ({ market: input.market, interval, openTime: candle.closeTimeMs - input.intervalMs, closeTime: candle.closeTimeMs, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume! }));
  for (let index = 1; index < candles.length; index += 1) if (candles[index]!.openTime !== candles[index - 1]!.closeTime) throw new Error("canonical dataset has missing intervals");
  const contentSha256 = calculateResearchCandleSha256(candles);
  const manifest: HistoricalDatasetManifest = { schemaVersion: 1, datasetId: calculateResearchDatasetId(input.source, candles, contentSha256), source: input.source, market: input.market, interval, candleCount: candles.length, startOpenTime: candles[0]!.openTime, endCloseTime: candles.at(-1)!.closeTime, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT", missingCandleCount: 0, createdAt: input.createdAt, contentSha256 };
  input.store.persistVerified(manifest, candles);
  return Object.freeze(manifest);
}
