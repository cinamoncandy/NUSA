import { createHash } from "node:crypto";
import type { UpbitOrderBook } from "../../../packages/core/src/upbitWebSocket";

const UPBIT_ORDERBOOK_URL = "https://api.upbit.com/v1/orderbook";
const MARKET = /^KRW-[A-Z0-9-]+$/;
const MAX_SNAPSHOT_AGE_MS = 30_000;
/** How often a live connection re-acquires the REST snapshot; must stay well inside MAX_SNAPSHOT_AGE_MS. */
export const ORDERBOOK_SNAPSHOT_REFRESH_INTERVAL_MS = 10_000;
export const ORDERBOOK_SNAPSHOT_MAX_AGE_MS = MAX_SNAPSHOT_AGE_MS;

export type OrderBookReconciliationState = "UNRECONCILED" | "SNAPSHOT_READY" | "RECONCILED";

export interface UpbitOrderBookSnapshotEvidence {
  readonly provider: "UPBIT";
  readonly market: string;
  readonly sourceTimestamp: number;
  readonly receivedAt: number;
  readonly sourceFingerprint: string;
}

export interface ReconciledUpbitOrderBook {
  readonly state: "RECONCILED";
  readonly reconciliationId: string;
  readonly snapshot: UpbitOrderBookSnapshotEvidence;
  readonly streamReceivedAt: number;
  readonly orderBook: UpbitOrderBook;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizeMarket(value: unknown): string {
  if (typeof value !== "string") throw new Error("orderbook snapshot market is invalid");
  const market = value.trim().toUpperCase();
  if (!MARKET.test(market)) throw new Error("orderbook snapshot market is invalid");
  return market;
}

function safeTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(field + " is invalid");
  return Number(value);
}

export async function fetchUpbitOrderBookSnapshot(
  market: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<UpbitOrderBookSnapshotEvidence> {
  const normalized = normalizeMarket(market);
  const url = new URL(UPBIT_ORDERBOOK_URL);
  url.searchParams.set("markets", normalized);
  const response = await fetchImpl(url.toString(), { method: "GET", redirect: "error" });
  if (!response.ok) throw new Error("orderbook snapshot upstream status " + response.status);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0] == null || typeof payload[0] !== "object") throw new Error("orderbook snapshot payload is invalid");
  const row = payload[0] as Record<string, unknown>;
  if (normalizeMarket(row.market) !== normalized) throw new Error("orderbook snapshot market mismatch");
  const sourceTimestamp = safeTimestamp(row.timestamp, "orderbook snapshot timestamp");
  const receivedAt = safeTimestamp(now(), "orderbook snapshot receivedAt");
  if (sourceTimestamp > receivedAt + 5_000 || receivedAt - sourceTimestamp > MAX_SNAPSHOT_AGE_MS) throw new Error("orderbook snapshot is stale or future-dated");
  return Object.freeze({ provider: "UPBIT", market: normalized, sourceTimestamp, receivedAt, sourceFingerprint: digest(row) });
}

export class UpbitOrderBookReconciler {
  private readonly snapshots = new Map<string, UpbitOrderBookSnapshotEvidence>();

  reset(): void { this.snapshots.clear(); }
  installSnapshot(snapshot: UpbitOrderBookSnapshotEvidence): void { this.snapshots.set(snapshot.market, snapshot); }
  state(market: string): OrderBookReconciliationState { return this.snapshots.has(normalizeMarket(market)) ? "SNAPSHOT_READY" : "UNRECONCILED"; }

  reconcile(orderBook: UpbitOrderBook, streamReceivedAt: number): ReconciledUpbitOrderBook | null {
    const market = normalizeMarket(orderBook.code);
    const snapshot = this.snapshots.get(market);
    if (snapshot == null) return null;
    if (!Number.isSafeInteger(streamReceivedAt) || streamReceivedAt < snapshot.receivedAt || streamReceivedAt - snapshot.receivedAt > MAX_SNAPSHOT_AGE_MS) return null;
    const reconciliationId = "upbit-orderbook:" + market + ":" + snapshot.sourceFingerprint.slice(0, 24) + ":" + streamReceivedAt;
    return Object.freeze({ state: "RECONCILED", reconciliationId, snapshot, streamReceivedAt, orderBook });
  }
}
