import { createHash } from "node:crypto";

export interface OrderbookLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface OrderbookSnapshot {
  readonly snapshotId: string;
  readonly market: string;
  readonly capturedAt: string;
  readonly bids: readonly OrderbookLevel[];
  readonly asks: readonly OrderbookLevel[];
  readonly sequence: number | null;
  readonly source: string;
}

export interface OrderbookImbalanceFeaturePolicy {
  readonly featureVersion: number;
  readonly depthLevels: number;
  readonly minimumTotalQuantity: number;
  readonly maximumSpreadRate: number;
  readonly staleAfterMs: number;
}

export interface OrderbookImbalanceFeature {
  readonly featureVersion: number;
  readonly snapshotId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly midPrice: number;
  readonly spread: number;
  readonly spreadRate: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
  readonly bookImbalance: number;
  readonly queueImbalance: number;
  readonly microprice: number;
  readonly micropriceDeviationRate: number;
  readonly depthLevelsUsed: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly provenance: readonly string[];
  readonly contentHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return parsed;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const validatePolicy = (policy: OrderbookImbalanceFeaturePolicy): void => {
  if (!Number.isInteger(policy.featureVersion) || policy.featureVersion < 1) throw new Error("featureVersion must be a positive integer");
  if (!Number.isInteger(policy.depthLevels) || policy.depthLevels < 1) throw new Error("depthLevels must be a positive integer");
  finite(policy.minimumTotalQuantity, "minimumTotalQuantity");
  if (policy.minimumTotalQuantity < 0) throw new Error("minimumTotalQuantity must be non-negative");
  finite(policy.maximumSpreadRate, "maximumSpreadRate");
  if (policy.maximumSpreadRate < 0 || policy.maximumSpreadRate >= 1) throw new Error("maximumSpreadRate must be between 0 and 1");
  if (!Number.isInteger(policy.staleAfterMs) || policy.staleAfterMs < 0) throw new Error("staleAfterMs must be a non-negative integer");
};

const validateLevels = (levels: readonly OrderbookLevel[], side: "bid" | "ask"): void => {
  if (levels.length === 0) throw new Error(`${side} levels are required`);
  let previousPrice: number | null = null;
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (!level) throw new Error(`${side} level missing`);
    finite(level.price, `${side}[${index}].price`);
    finite(level.quantity, `${side}[${index}].quantity`);
    if (level.price <= 0 || level.quantity < 0) throw new Error(`${side} price must be positive and quantity non-negative`);
    if (previousPrice !== null) {
      if (side === "bid" && level.price >= previousPrice) throw new Error("bid levels must be strictly descending");
      if (side === "ask" && level.price <= previousPrice) throw new Error("ask levels must be strictly ascending");
    }
    previousPrice = level.price;
  }
};

export const computeOrderbookImbalanceFeature = (
  snapshot: OrderbookSnapshot,
  generatedAt: string,
  policy: OrderbookImbalanceFeaturePolicy
): OrderbookImbalanceFeature => {
  validatePolicy(policy);
  if (!snapshot.snapshotId.trim() || !snapshot.market.trim() || !snapshot.source.trim()) throw new Error("snapshotId, market, and source are required");
  const capturedAtMs = parseTime(snapshot.capturedAt, "capturedAt");
  const generatedAtMs = parseTime(generatedAt, "generatedAt");
  if (generatedAtMs < capturedAtMs) throw new Error("generatedAt cannot precede capturedAt");
  if (snapshot.sequence !== null && (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0)) throw new Error("sequence must be null or a non-negative integer");
  validateLevels(snapshot.bids, "bid");
  validateLevels(snapshot.asks, "ask");

  const depth = Math.min(policy.depthLevels, snapshot.bids.length, snapshot.asks.length);
  const bids = snapshot.bids.slice(0, depth);
  const asks = snapshot.asks.slice(0, depth);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  if (bestBid >= bestAsk) throw new Error("crossed or locked orderbook is not supported");

  const bidQuantity = bids.reduce((sum, level) => sum + level.quantity, 0);
  const askQuantity = asks.reduce((sum, level) => sum + level.quantity, 0);
  const totalQuantity = bidQuantity + askQuantity;
  const topBidQuantity = bids[0]?.quantity ?? 0;
  const topAskQuantity = asks[0]?.quantity ?? 0;
  const topTotal = topBidQuantity + topAskQuantity;
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  const spreadRate = spread / midPrice;
  const bookImbalance = totalQuantity === 0 ? 0 : (bidQuantity - askQuantity) / totalQuantity;
  const queueImbalance = topTotal === 0 ? 0 : (topBidQuantity - topAskQuantity) / topTotal;
  const microprice = topTotal === 0
    ? midPrice
    : (bestAsk * topBidQuantity + bestBid * topAskQuantity) / topTotal;
  const micropriceDeviationRate = (microprice - midPrice) / midPrice;

  const reasons: string[] = [];
  if (generatedAtMs - capturedAtMs > policy.staleAfterMs) reasons.push("SNAPSHOT_STALE");
  if (totalQuantity < policy.minimumTotalQuantity) reasons.push("INSUFFICIENT_DEPTH_QUANTITY");
  if (spreadRate > policy.maximumSpreadRate) reasons.push("SPREAD_TOO_WIDE");
  if (reasons.length === 0) reasons.push("FEATURE_ELIGIBLE");

  const payload = {
    featureVersion: policy.featureVersion,
    snapshotId: snapshot.snapshotId.trim(),
    market: snapshot.market.trim(),
    generatedAt,
    bestBid: round(bestBid),
    bestAsk: round(bestAsk),
    midPrice: round(midPrice),
    spread: round(spread),
    spreadRate: round(spreadRate),
    bidQuantity: round(bidQuantity),
    askQuantity: round(askQuantity),
    bookImbalance: round(bookImbalance),
    queueImbalance: round(queueImbalance),
    microprice: round(microprice),
    micropriceDeviationRate: round(micropriceDeviationRate),
    depthLevelsUsed: depth,
    eligible: reasons.length === 1 && reasons[0] === "FEATURE_ELIGIBLE",
    reasons: Object.freeze(reasons),
    provenance: Object.freeze([snapshot.snapshotId.trim(), snapshot.source.trim()])
  };
  const contentHash = hash(payload);
  if (!SHA256.test(contentHash)) throw new Error("content hash invariant violated");
  return Object.freeze({ ...payload, contentHash });
};
