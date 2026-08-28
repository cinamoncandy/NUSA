import { createHash } from "node:crypto";
import type { PaperCanonicalBenchmarkEvidence } from "./paperRealizedPeriodProducer";
import type { PaperPublicMarketObservation } from "../../../packages/storage/src/paperMarketObservationRepository";
import { SqlitePaperMarketObservationRepository } from "../../../packages/storage/src/paperMarketObservationRepository";

const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("paper benchmark contains a non-finite value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("paper benchmark input is cyclic");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new Error("paper benchmark contains an unsupported value");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function normalizedMarket(value: string): string {
  const market = value.trim().toUpperCase();
  if (!MARKET.test(market)) throw new Error("paper benchmark market is invalid");
  return market;
}

function benchmarkInput(market: string, periodStartAt: number, periodEndAt: number, observations: readonly PaperPublicMarketObservation[]) {
  return {
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_TICKER",
    market,
    periodStartAt,
    periodEndAt,
    observations: observations.map((observation) => ({
      observationId: observation.observationId,
      observedAt: observation.observedAt,
      price: observation.price,
      evidenceFingerprintSha256: observation.evidenceFingerprintSha256,
    })),
  };
}

/**
 * Projects a benchmark from the durable public ticker observations already received by the
 * Cloud runtime. It requires observations on both sides of the requested window and carries
 * the complete input fingerprint forward; missing history remains unavailable rather than
 * becoming a synthetic zero return.
 */
export function readCanonicalPaperTickerBenchmark(
  repository: SqlitePaperMarketObservationRepository,
  market: string | undefined,
  periodStartAt: number,
  periodEndAt: number,
): PaperCanonicalBenchmarkEvidence | undefined {
  if (market == null) return undefined;
  const normalized = normalizedMarket(market);
  const observations = repository.readWindow(normalized, periodStartAt, periodEndAt);
  if (observations.length < 2) return undefined;
  const first = observations[0]!;
  const last = observations[observations.length - 1]!;
  if (first.observedAt < periodStartAt || last.observedAt > periodEndAt || first.observedAt >= last.observedAt) return undefined;
  const input = benchmarkInput(normalized, periodStartAt, periodEndAt, observations);
  const inputFingerprintSha256 = fingerprint(input);
  if (!SHA256.test(inputFingerprintSha256)) return undefined;
  const benchmarkReturn = last.price / first.price - 1;
  if (!Number.isFinite(benchmarkReturn)) return undefined;
  return Object.freeze({
    evidenceId: `paper-benchmark:${inputFingerprintSha256.slice(0, 24)}`,
    observedAt: last.observedAt,
    benchmarkReturn,
    market: normalized,
    source: "UPBIT_PUBLIC_TICKER" as const,
    startObservedAt: first.observedAt,
    endObservedAt: last.observedAt,
    startPrice: first.price,
    endPrice: last.price,
    inputFingerprintSha256,
  });
}
