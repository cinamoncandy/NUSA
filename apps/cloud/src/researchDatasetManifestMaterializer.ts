import { createHash } from "node:crypto";
import { calculateResearchDatasetIdV2, createResearchCandleHasher, type CanonicalResearchCandle, type HistoricalDatasetManifest, type ResearchDatasetProvenanceV2, type ResearchInterval } from "../../../packages/contracts/src/researchDatasetSemantics";
import { SqliteResearchDatasetManifestStore } from "../../../packages/storage/src/index";
import { SqliteResearchCandleStore, type ResearchDatasetMaterial, type StoredResearchCandle } from "../../../packages/storage/src/researchCandleStore";
import { ResearchDatasetManifestStoreError } from "../../../packages/storage/src/researchDatasetManifest";
import { UPBIT_CANDLE_SOURCE_FINGERPRINT } from "./researchCandleBackfill";
import { AggregatedResearchCandleSource, type ResearchCandleStorePort } from "./researchCandleAggregation";

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;

export type ResearchManifestPhase = "validate_and_gaps" | "read_source_candles" | "derive_and_hash" | "receipt_coverage" | "persist";

const intervalName = (intervalMs: number): ResearchInterval => {
  const names: Readonly<Record<number, ResearchInterval>> = { 60_000: "1m", 180_000: "3m", 300_000: "5m", 600_000: "10m", 900_000: "15m", 1_800_000: "30m", 3_600_000: "60m", 14_400_000: "240m", 86_400_000: "1d" };
  const interval = names[intervalMs];
  if (interval == null) throw new Error("unsupported canonical dataset interval");
  return interval;
};

export type ResearchManifestMaterializeInput = {
  readonly store: SqliteResearchDatasetManifestStore;
  readonly candleStore: SqliteResearchCandleStore;
  readonly market: string;
  readonly intervalMs: number;
  readonly candles: readonly StoredResearchCandle[];
  readonly source: string;
  readonly createdAt: string;
  readonly sourceCommitSha: string;
  // Optional, observation only: called once per phase with its duration. It never changes the manifest, the hashes or the stored rows.
  readonly onPhase?: (phase: ResearchManifestPhase, durationMs: number) => void;
};

// How many candles one uninterrupted step may handle. The build is written as a generator that yields between steps: driven to the end
// without waiting (materializeResearchDatasetManifest) it is the plain synchronous build; driven with an await between steps
// (materializeResearchDatasetManifestAsync) it lets the event loop run in between. Both run the very same code, so the manifest is the same.
const YIELD_EVERY = 4_000;
const RECEIPTS_PER_STEP = 20;

function* materializeSteps(input: ResearchManifestMaterializeInput): Generator<void, HistoricalDatasetManifest, void> {
  const phaseStarted = (): number => performance.now();
  const phaseDone = (phase: ResearchManifestPhase, started: number): void => {
    if (input.onPhase == null) return;
    try { input.onPhase(phase, Math.max(0, performance.now() - started)); } catch { /* observation must never affect the build */ }
  };
  if (!input.source.trim()) throw new Error("canonical dataset source is required");
  if (!/^KRW-[A-Z0-9-]+$/.test(input.market)) throw new Error("canonical dataset market is invalid");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("canonical dataset createdAt is invalid");
  if (input.candles.length === 0 || input.candles.some((candle) => candle.volume == null)) throw new Error("canonical dataset requires explicit OHLCV candles");
  const interval = intervalName(input.intervalMs);
  let started = phaseStarted();
  const candlesBuilt: CanonicalResearchCandle[] = [];
  for (let index = 0; index < input.candles.length; index += 1) {
    const candle = input.candles[index]!;
    candlesBuilt.push({ market: input.market, interval, openTime: candle.closeTimeMs - input.intervalMs, closeTime: candle.closeTimeMs, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume! });
    if ((index + 1) % YIELD_EVERY === 0) yield;
  }
  const candles: readonly CanonicalResearchCandle[] = candlesBuilt;
  // A gap is allowed only on the 1-minute series and only where the exchange itself proved there was no candle
  // (ResearchCandleAbsence, recorded from a fingerprinted Upbit page). Our own data loss is still rejected.
  const gapCloses: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    if (index % YIELD_EVERY === 0) yield;
    const previous = candles[index - 1]!.closeTime;
    if (candles[index]!.openTime === previous) continue;
    if (candles[index]!.openTime < previous) throw new Error("canonical dataset has overlapping intervals");
    for (let close = previous + input.intervalMs; close <= candles[index]!.openTime; close += input.intervalMs) gapCloses.push(close);
  }
  // A longer bar is derived only from complete 1-minute buckets (AggregatedResearchCandleSource drops a bucket that lacks any minute),
  // so a gap in a 15m or 60m series exists exactly where at least one of its 1-minute closes is missing. The same rule then applies
  // to those minutes: every missing 1-minute close in the dataset's range must lie inside a run the exchange itself proved empty.
  // Our own data loss is still rejected, and a longer series with no missing minute cannot have a gap at all.
  let absences: readonly { readonly firstAbsentCloseMs: number; readonly lastAbsentCloseMs: number; readonly evidenceFingerprintSha256: string }[] = [];
  let gapMinuteCount = gapCloses.length;
  if (gapCloses.length > 0 && input.intervalMs === 60_000) {
    absences = input.candleStore.listAbsence(input.market, 60_000, gapCloses[0]!, gapCloses.at(-1)!);
    if (gapCloses.some((close) => !absences.some((run) => close >= run.firstAbsentCloseMs && close <= run.lastAbsentCloseMs))) throw new Error("canonical dataset has missing intervals");
  } else if (gapCloses.length > 0 && (input.intervalMs === 900_000 || input.intervalMs === 3_600_000)) {
    const firstMinuteClose = candles[0]!.openTime + 60_000;
    const lastMinuteClose = candles.at(-1)!.closeTime;
    const present = new Set(input.candleStore.read(input.market, 60_000, firstMinuteClose, lastMinuteClose).map((row) => row.closeTimeMs));
    const missingMinutes: number[] = [];
    for (let close = firstMinuteClose; close <= lastMinuteClose; close += 60_000) if (!present.has(close)) missingMinutes.push(close);
    if (missingMinutes.length === 0) throw new Error("canonical dataset has missing intervals");
    absences = input.candleStore.listAbsence(input.market, 60_000, missingMinutes[0]!, missingMinutes.at(-1)!);
    if (missingMinutes.some((close) => !absences.some((run) => close >= run.firstAbsentCloseMs && close <= run.lastAbsentCloseMs))) throw new Error("canonical dataset has missing intervals");
    gapMinuteCount = missingMinutes.length;
  }
  phaseDone("validate_and_gaps", started);
  started = phaseStarted();
  const contentHasher = createResearchCandleHasher();
  for (let at = 0; at < candles.length; at += YIELD_EVERY) {
    contentHasher.update(candles.slice(at, at + YIELD_EVERY));
    yield;
  }
  const contentSha256 = contentHasher.digest();
  if (!SHA1.test(input.sourceCommitSha)) throw Object.assign(new Error("dataset replay runtime source commit is unavailable"), { code: "MANIFEST_PROVENANCE_REQUIRED" });
  const sourceIntervalMs = 60_000;
  const firstBaseClose = candles[0]!.openTime + sourceIntervalMs;
  const lastBaseClose = candles.at(-1)!.closeTime;
  const baseCandles = yield* readInSlices((from, to) => input.candleStore.read(input.market, sourceIntervalMs, from, to), firstBaseClose, lastBaseClose, YIELD_EVERY * sourceIntervalMs);
  phaseDone("read_source_candles", started);
  started = phaseStarted();
  const expectedBaseCount = (lastBaseClose - firstBaseClose) / sourceIntervalMs + 1 - gapMinuteCount;
  if (!Number.isSafeInteger(expectedBaseCount) || baseCandles.length !== expectedBaseCount || baseCandles.some((candle) => candle.volume == null)) throw Object.assign(new Error("dataset source candle coverage is incomplete"), { code: "MANIFEST_PROVENANCE_REQUIRED" });
  // The verification below asks the store for exactly the rows read a moment ago (same market, base interval and closes). Hand it
  // those rows instead of reading them again: the result is identical for identical arguments, and the collector's thread is blocked
  // for one full read less. Any other request still goes to the store.
  const sameWindowPort: ResearchCandleStorePort = {
    read: (market, intervalMs, fromCloseMs, toCloseMs) => (market === input.market && intervalMs === sourceIntervalMs && fromCloseMs === firstBaseClose && toCloseMs === lastBaseClose ? baseCandles : input.candleStore.read(market, intervalMs, fromCloseMs, toCloseMs)),
    latestCloseTime: (market, intervalMs) => input.candleStore.latestCloseTime(market, intervalMs),
    earliestCloseTime: (market, intervalMs) => input.candleStore.earliestCloseTime(market, intervalMs),
    count: (market, intervalMs) => input.candleStore.count(market, intervalMs),
  };
  const derived = new AggregatedResearchCandleSource(sameWindowPort, sourceIntervalMs).read(input.market, input.intervalMs, candles[0]!.openTime + input.intervalMs, candles.at(-1)!.closeTime);
  const toCanonical = (candle: (typeof derived)[number]): CanonicalResearchCandle => ({ market: input.market, interval, openTime: candle.closeTimeMs - input.intervalMs, closeTime: candle.closeTimeMs, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume! });
  const derivedHasher = createResearchCandleHasher();
  for (let at = 0; at < derived.length; at += YIELD_EVERY) {
    derivedHasher.update(derived.slice(at, at + YIELD_EVERY).map(toCanonical));
    yield;
  }
  if (derivedHasher.digest() !== contentSha256) throw Object.assign(new Error("dataset material does not match the verified source candles"), { code: "MANIFEST_CONTENT_MISMATCH" });
  // Each receipt is verified against the stored candles (re-read and re-hashed) exactly as listMaterial does it; here one receipt at a time,
  // with a step boundary after every few, so this verification no longer holds the thread for the whole history.
  const materials: ResearchDatasetMaterial[] = [];
  for (const ref of input.candleStore.listMaterialRefs(input.market, sourceIntervalMs, firstBaseClose, lastBaseClose)) {
    materials.push(input.candleStore.readMaterial(input.market, sourceIntervalMs, ref.firstCloseTimeMs, ref.lastCloseTimeMs, ref.storeContentSha256));
    if (materials.length % RECEIPTS_PER_STEP === 0) yield;
  }
  if (materials.length === 0 || materials.some((material) => material.source !== "UPBIT_PUBLIC_CANDLES" || material.sourceFingerprint !== UPBIT_CANDLE_SOURCE_FINGERPRINT || material.evidenceFingerprintSha256 == null || !SHA256.test(material.evidenceFingerprintSha256))) throw Object.assign(new Error("complete canonical raw-source receipts are required"), { code: "MANIFEST_PROVENANCE_REQUIRED" });
  if (materials.some((material) => material.rejectedObservations !== 0)) throw Object.assign(new Error("malformed raw-source observations cannot produce a canonical manifest"), { code: "MANIFEST_SOURCE_MALFORMED" });
  phaseDone("derive_and_hash", started);
  started = phaseStarted();
  // A stored candle is covered when its close lies inside the (inclusive) close range of some receipt. Every candle of `baseCandles` is a
  // stored candle, so this is the same test as reading each receipt's range back from the store and collecting the closes, without the reads.
  const receiptRanges = materials.map((material) => [material.firstCloseTimeMs, material.lastCloseTimeMs] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const mergedRanges: Array<[number, number]> = [];
  for (const [from, to] of receiptRanges) {
    const last = mergedRanges.at(-1);
    if (last != null && from <= last[1]) last[1] = Math.max(last[1], to);
    else mergedRanges.push([from, to]);
  }
  const receiptCovers = (close: number): boolean => {
    let low = 0;
    let high = mergedRanges.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [from, to] = mergedRanges[mid]!;
      if (close < from) high = mid - 1;
      else if (close > to) low = mid + 1;
      else return true;
    }
    return false;
  };
  let uncovered = false;
  for (let index = 0; index < baseCandles.length && !uncovered; index += 1) {
    if (!receiptCovers(baseCandles[index]!.closeTimeMs)) uncovered = true;
    if ((index + 1) % YIELD_EVERY === 0) yield;
  }
  if (uncovered) throw Object.assign(new Error("raw-source receipts do not cover the complete dataset"), { code: "MANIFEST_PROVENANCE_REQUIRED" });
  phaseDone("receipt_coverage", started);
  const provenance: ResearchDatasetProvenanceV2 = {
    rawSourceIdentitySha256s: [...new Set([...materials.map((material) => material.evidenceFingerprintSha256!), ...absences.map((run) => run.evidenceFingerprintSha256)])],
    transformationGraphSha256: hash(["UPBIT_PUBLIC_CANDLES", "parseUpbitMinuteCandles", "CanonicalResearchCandle", "AggregatedResearchCandleSource", "v1"]),
    // Unchanged for gap-free datasets, so their identities stay exactly as before.
    transformationConfigSha256: hash(gapCloses.length === 0
      ? { sourceIntervalMs, targetIntervalMs: input.intervalMs, ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT" }
      : { sourceIntervalMs, targetIntervalMs: input.intervalMs, ordering: "OPEN_TIME_ASC", missingCandlePolicy: "EXCHANGE_CONFIRMED_ABSENCE_ONLY", confirmedAbsentRuns: absences.map((run) => [run.firstAbsentCloseMs, run.lastAbsentCloseMs, run.evidenceFingerprintSha256]) }),
    schemaContractSha256: hash(["CanonicalResearchCandle", "market", "interval", "openTime", "closeTime", "open", "high", "low", "close", "volume"]),
    // A gapped dataset must not claim contiguity; gap-free datasets keep the original label and identity.
    qualitySuiteSha256: hash(gapCloses.length === 0
      ? ["explicit OHLCV", "contiguous source closes", "complete source receipts", "verified source aggregation", "v1"]
      : ["explicit OHLCV", "contiguous source closes except exchange-confirmed absences", "complete source receipts", "verified source aggregation", "v1"]),
    qualityResultsSha256: hash({ sourceCandles: baseCandles.length, outputCandles: candles.length, sourceReceipts: materials.length, missingBuckets: materials.reduce((sum, material) => sum + material.missingBuckets, 0), incompleteBuckets: materials.reduce((sum, material) => sum + material.incompleteBuckets, 0), rejectedObservations: materials.reduce((sum, material) => sum + material.rejectedObservations, 0), ...(gapCloses.length === 0 ? {} : { confirmedAbsentCloses: gapCloses.length, confirmedAbsentRuns: absences.length }) }),
    derivedFeatureLineageSha256: hash({ derivedFeatures: [] }),
    replayRuntimeSha256: hash({ sourceCommitSha: input.sourceCommitSha, nodeVersion: process.version, materializer: "research-dataset-v2-v1" }),
  };
  const manifest: HistoricalDatasetManifest = { schemaVersion: 2, datasetId: calculateResearchDatasetIdV2(input.source, candles, contentSha256, provenance), source: input.source, market: input.market, interval, candleCount: candles.length, startOpenTime: candles[0]!.openTime, endCloseTime: candles.at(-1)!.closeTime, timezone: "UTC", ordering: "OPEN_TIME_ASC", missingCandlePolicy: gapCloses.length === 0 ? "REJECT" : "ALLOW", missingCandleCount: gapCloses.length, ...(gapCloses.length === 0 ? {} : { notes: `exchange-confirmed absent closes: ${gapCloses.length}` }), createdAt: input.createdAt, contentSha256, provenance };
  try {
    const existing = input.store.read(manifest.datasetId);
    const existingWithCurrentCreatedAt = { ...existing, createdAt: manifest.createdAt };
    if (JSON.stringify(existingWithCurrentCreatedAt) !== JSON.stringify(manifest)) {
      throw new ResearchDatasetManifestStoreError("MANIFEST_CONFLICT", "an existing dataset identity has different canonical manifest content");
    }
    // Replays of unchanged, immutable source material keep the original creation timestamp and are no-ops.
    return existing;
  } catch (error) {
    if (!(error instanceof ResearchDatasetManifestStoreError) || error.code !== "MANIFEST_NOT_FOUND") throw error;
  }
  started = phaseStarted();
  input.store.persistVerified(manifest, candles);
  phaseDone("persist", started);
  return Object.freeze(manifest);
}

/** The same rows as one read of [fromCloseMs, toCloseMs], fetched in consecutive, non-overlapping slices with a step boundary after each. */
function* readInSlices<T>(read: (fromCloseMs: number, toCloseMs: number) => readonly T[], fromCloseMs: number, toCloseMs: number, sliceMs: number): Generator<void, readonly T[], void> {
  const rows: T[] = [];
  for (let cursor = fromCloseMs; cursor <= toCloseMs; cursor += sliceMs) {
    for (const row of read(cursor, Math.min(toCloseMs, cursor + sliceMs - 1))) rows.push(row);
    yield;
  }
  return rows;
}

function drive<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export function materializeResearchDatasetManifest(input: ResearchManifestMaterializeInput): HistoricalDatasetManifest {
  return drive(materializeSteps(input));
}

/**
 * Builds the identical manifest, but awaits `yieldControl` between bounded steps (at most YIELD_EVERY candles each), so the thread that
 * runs it is never held for the whole build. Persisting the finished manifest is one step.
 */
export async function materializeResearchDatasetManifestAsync(input: ResearchManifestMaterializeInput & { readonly yieldControl: () => Promise<void> }): Promise<HistoricalDatasetManifest> {
  const steps = materializeSteps(input);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await input.yieldControl();
  }
}

/**
 * Reads research bars of one interval in slices that end on interval boundaries (so every longer bar lies wholly inside one slice) and
 * awaits `yieldControl` after each. The rows are the same as one read of the whole window.
 */
export async function readResearchBarsInSlices(source: ResearchCandleStorePort, market: string, intervalMs: number, baseIntervalMs: number, fromCloseMs: number, toCloseMs: number, yieldControl: () => Promise<void>, barsPerSlice = YIELD_EVERY): Promise<readonly StoredResearchCandle[]> {
  const ratio = Math.max(1, Math.round(intervalMs / baseIntervalMs));
  const sliceMs = Math.max(1, Math.floor(barsPerSlice / ratio)) * intervalMs;
  const rows: StoredResearchCandle[] = [];
  for (let cursor = fromCloseMs; cursor <= toCloseMs;) {
    const end = Math.min(toCloseMs, Math.floor(cursor / intervalMs) * intervalMs + sliceMs);
    for (const row of source.read(market, intervalMs, cursor, end)) rows.push(row as StoredResearchCandle);
    cursor = end + 1;
    await yieldControl();
  }
  return rows;
}
