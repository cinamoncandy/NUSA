import { createHash } from "node:crypto";
import type { SqliteDatabase } from "./index";

const TABLE = "paper_public_market_observations";
const MARKET = /^KRW-[A-Z0-9-]+$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export interface PaperPublicMarketObservationInput {
  readonly market: string;
  readonly observedAt: number;
  readonly price: number;
  readonly signedChangeRate?: number;
  readonly accumulatedVolume?: number;
  readonly accumulatedPrice?: number;
}

export interface PaperPublicMarketObservation {
  readonly schemaVersion: 1;
  readonly source: "UPBIT_PUBLIC_TICKER";
  readonly observationId: string;
  readonly market: string;
  readonly observedAt: number;
  readonly price: number;
  readonly signedChangeRate?: number;
  readonly accumulatedVolume?: number;
  readonly accumulatedPrice?: number;
  readonly evidenceFingerprintSha256: string;
}

export class PaperMarketObservationStoreError extends Error {
  public constructor(readonly code: string, message: string, readonly observationId?: string) {
    super(message);
    this.name = "PaperMarketObservationStoreError";
  }
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperMarketObservationStoreError("NON_FINITE_OBSERVATION", "public market observation contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  if (typeof value === "object") {
    if (seen.has(value)) throw new PaperMarketObservationStoreError("CYCLIC_OBSERVATION", "public market observation is cyclic");
    seen.add(value);
    const result = `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new PaperMarketObservationStoreError("UNSUPPORTED_OBSERVATION_VALUE", "public market observation contains an unsupported value");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function normalizeMarket(value: unknown): string {
  if (typeof value !== "string") throw new PaperMarketObservationStoreError("INVALID_MARKET", "public market observation market is invalid");
  const market = value.trim().toUpperCase();
  if (!MARKET.test(market)) throw new PaperMarketObservationStoreError("INVALID_MARKET", "public market observation market is invalid");
  return market;
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new PaperMarketObservationStoreError("INVALID_TIMESTAMP", "public market observation timestamp is invalid");
  return Number(value);
}

function positivePrice(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new PaperMarketObservationStoreError("INVALID_PRICE", "public market observation price is invalid");
  return value;
}

function optionalFinite(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PaperMarketObservationStoreError("INVALID_VALUE", `${name} is invalid`);
  return value;
}

function optionalNonNegative(value: unknown, name: string): number | undefined {
  const normalized = optionalFinite(value, name);
  if (normalized !== undefined && normalized < 0) throw new PaperMarketObservationStoreError("INVALID_VALUE", `${name} is invalid`);
  return normalized;
}

function payload(input: PaperPublicMarketObservationInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_TICKER",
    market: normalizeMarket(input.market),
    observedAt: safeTimestamp(input.observedAt),
    price: positivePrice(input.price),
    signedChangeRate: optionalFinite(input.signedChangeRate, "signedChangeRate") ?? null,
    accumulatedVolume: optionalNonNegative(input.accumulatedVolume, "accumulatedVolume") ?? null,
    accumulatedPrice: optionalNonNegative(input.accumulatedPrice, "accumulatedPrice") ?? null,
  };
}

export function normalizePaperPublicMarketObservation(input: PaperPublicMarketObservationInput): PaperPublicMarketObservation {
  const normalized = payload(input);
  const market = String(normalized.market);
  const observedAt = Number(normalized.observedAt);
  const fingerprint = digest(normalized);
  return freeze({
    schemaVersion: 1,
    source: "UPBIT_PUBLIC_TICKER",
    observationId: `paper-market:${market}:${observedAt}`,
    market,
    observedAt,
    price: Number(normalized.price),
    ...(normalized.signedChangeRate === null ? {} : { signedChangeRate: Number(normalized.signedChangeRate) }),
    ...(normalized.accumulatedVolume === null ? {} : { accumulatedVolume: Number(normalized.accumulatedVolume) }),
    ...(normalized.accumulatedPrice === null ? {} : { accumulatedPrice: Number(normalized.accumulatedPrice) }),
    evidenceFingerprintSha256: fingerprint,
  });
}

function payloadFromObservation(observation: PaperPublicMarketObservation): Record<string, unknown> {
  return payload(observation);
}

function decodeRow(row: Record<string, unknown>): PaperPublicMarketObservation {
  const observationId = String(row.observation_id ?? "");
  try {
    const parsed = JSON.parse(String(row.payload_json ?? "")) as Record<string, unknown>;
    const observation = normalizePaperPublicMarketObservation({
      market: parsed.market as string,
      observedAt: parsed.observedAt as number,
      price: parsed.price as number,
      signedChangeRate: parsed.signedChangeRate == null ? undefined : parsed.signedChangeRate as number,
      accumulatedVolume: parsed.accumulatedVolume == null ? undefined : parsed.accumulatedVolume as number,
      accumulatedPrice: parsed.accumulatedPrice == null ? undefined : parsed.accumulatedPrice as number,
    });
    if (observation.observationId !== observationId || canonical(payloadFromObservation(observation)) !== String(row.payload_json) || observation.evidenceFingerprintSha256 !== String(row.evidence_fingerprint_sha256 ?? "")) {
      throw new PaperMarketObservationStoreError("OBSERVATION_CHECKSUM_MISMATCH", "persisted public market observation checksum mismatch", observationId);
    }
    if (String(row.market ?? "") !== observation.market || Number(row.observed_at_ms) !== observation.observedAt) {
      throw new PaperMarketObservationStoreError("OBSERVATION_IDENTITY_MISMATCH", "persisted public market observation identity mismatch", observationId);
    }
    return observation;
  } catch (error) {
    if (error instanceof PaperMarketObservationStoreError) throw error;
    throw new PaperMarketObservationStoreError("MALFORMED_OBSERVATION", "persisted public market observation is malformed", observationId);
  }
}

export class SqlitePaperMarketObservationRepository {
  private readonly maximumRows: number;

  public constructor(private readonly db: SqliteDatabase, maximumRows = 50_000) {
    if (!Number.isSafeInteger(maximumRows) || maximumRows < 2 || maximumRows > 1_000_000) throw new PaperMarketObservationStoreError("INVALID_RETENTION", "public market observation retention is invalid");
    this.maximumRows = maximumRows;
  }

  public append(input: PaperPublicMarketObservationInput): "RECORDED" | "DUPLICATE" {
    const observation = normalizePaperPublicMarketObservation(input);
    const payloadJson = canonical(payloadFromObservation(observation));
    return this.db.transaction(() => {
      const existing = this.db.connection.prepare(`SELECT payload_json, evidence_fingerprint_sha256 FROM ${TABLE} WHERE observation_id = ?`).get(observation.observationId) as Record<string, unknown> | undefined;
      if (existing != null) {
        if (String(existing.payload_json) !== payloadJson || String(existing.evidence_fingerprint_sha256) !== observation.evidenceFingerprintSha256) throw new PaperMarketObservationStoreError("OBSERVATION_ID_CONFLICT", "public market observation identity was reused with different evidence", observation.observationId);
        return "DUPLICATE";
      }
      try {
        this.db.connection.prepare(`INSERT INTO ${TABLE} (observation_id, market, observed_at_ms, payload_json, evidence_fingerprint_sha256) VALUES (?, ?, ?, ?, ?)`).run(observation.observationId, observation.market, observation.observedAt, payloadJson, observation.evidenceFingerprintSha256);
      } catch (error) {
        throw new PaperMarketObservationStoreError("OBSERVATION_PERSISTENCE_FAILED", error instanceof Error ? error.message : "public market observation persistence failed", observation.observationId);
      }
      this.pruneWithinTransaction();
      return "RECORDED";
    });
  }

  public readWindow(market: string, startAt: number, endAt: number): readonly PaperPublicMarketObservation[] {
    const normalizedMarket = normalizeMarket(market);
    const start = safeTimestamp(startAt);
    const end = safeTimestamp(endAt);
    if (end < start) throw new PaperMarketObservationStoreError("INVALID_WINDOW", "public market observation window is invalid");
    const rows = this.db.connection.prepare(`SELECT observation_id, market, observed_at_ms, payload_json, evidence_fingerprint_sha256 FROM ${TABLE} WHERE market = ? AND observed_at_ms >= ? AND observed_at_ms <= ? ORDER BY observed_at_ms ASC, observation_id ASC`).all(normalizedMarket, start, end) as Array<Record<string, unknown>>;
    return freeze(rows.map(decodeRow));
  }

  public list(): readonly PaperPublicMarketObservation[] {
    const rows = this.db.connection.prepare(`SELECT observation_id, market, observed_at_ms, payload_json, evidence_fingerprint_sha256 FROM ${TABLE} ORDER BY observed_at_ms ASC, market ASC, observation_id ASC`).all() as Array<Record<string, unknown>>;
    return freeze(rows.map(decodeRow));
  }

  public count(): number {
    const row = this.db.connection.prepare(`SELECT COUNT(*) AS count FROM ${TABLE}`).get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  private pruneWithinTransaction(): void {
    this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE observation_id IN (SELECT observation_id FROM ${TABLE} ORDER BY observed_at_ms DESC, market DESC, observation_id DESC LIMIT -1 OFFSET ?)`).run(this.maximumRows);
  }
}
