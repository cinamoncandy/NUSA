import { createHash } from "node:crypto";

export interface LiquiditySweepLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface LiquiditySweepSnapshot {
  readonly snapshotId: string;
  readonly market: string;
  readonly capturedAt: string;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly bids: readonly LiquiditySweepLevel[];
  readonly asks: readonly LiquiditySweepLevel[];
  readonly lastTradePrice: number;
  readonly lastTradeQuantity: number;
  readonly aggressorSide: "BUY" | "SELL" | "UNKNOWN";
  readonly source: string;
}

export interface LiquiditySweepFeaturePolicy {
  readonly featureVersion: number;
  readonly depthLevels: number;
  readonly minimumSweepNotional: number;
  readonly minimumConsumedDepthRatio: number;
  readonly maximumSpreadRate: number;
  readonly staleAfterMs: number;
}

export interface LiquiditySweepFeature {
  readonly featureVersion: number;
  readonly snapshotId: string;
  readonly market: string;
  readonly generatedAt: string;
  readonly side: "UP_SWEEP" | "DOWN_SWEEP" | "NONE";
  readonly spreadRate: number;
  readonly visibleBidNotional: number;
  readonly visibleAskNotional: number;
  readonly sweepNotional: number;
  readonly consumedDepthRatio: number;
  readonly priceImpactRate: number;
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

const validateLevels = (levels: readonly LiquiditySweepLevel[], side: "bid" | "ask"): void => {
  if (levels.length === 0) throw new Error(`${side} levels are required`);
  let previous: number | null = null;
  levels.forEach((level, index) => {
    finite(level.price, `${side}[${index}].price`);
    finite(level.quantity, `${side}[${index}].quantity`);
    if (level.price <= 0 || level.quantity < 0) throw new Error(`${side} levels must have positive price and non-negative quantity`);
    if (previous !== null) {
      if (side === "bid" && level.price >= previous) throw new Error("bid levels must be strictly descending");
      if (side === "ask" && level.price <= previous) throw new Error("ask levels must be strictly ascending");
    }
    previous = level.price;
  });
};

export const computeLiquiditySweepFeature = (
  snapshot: LiquiditySweepSnapshot,
  generatedAt: string,
  policy: LiquiditySweepFeaturePolicy
): LiquiditySweepFeature => {
  if (!Number.isInteger(policy.featureVersion) || policy.featureVersion < 1) throw new Error("featureVersion must be positive");
  if (!Number.isInteger(policy.depthLevels) || policy.depthLevels < 1) throw new Error("depthLevels must be positive");
  for (const [label, value] of [
    ["minimumSweepNotional", policy.minimumSweepNotional],
    ["minimumConsumedDepthRatio", policy.minimumConsumedDepthRatio],
    ["maximumSpreadRate", policy.maximumSpreadRate]
  ] as const) finite(value, label);
  if (policy.minimumSweepNotional < 0) throw new Error("minimumSweepNotional must be non-negative");
  if (policy.minimumConsumedDepthRatio < 0 || policy.minimumConsumedDepthRatio > 1) throw new Error("minimumConsumedDepthRatio must be between 0 and 1");
  if (policy.maximumSpreadRate < 0 || policy.maximumSpreadRate >= 1) throw new Error("maximumSpreadRate must be between 0 and 1");
  if (!Number.isInteger(policy.staleAfterMs) || policy.staleAfterMs < 0) throw new Error("staleAfterMs must be non-negative");
  if (!snapshot.snapshotId.trim() || !snapshot.market.trim() || !snapshot.source.trim()) throw new Error("snapshotId, market, and source are required");

  const capturedAtMs = parseTime(snapshot.capturedAt, "capturedAt");
  const generatedAtMs = parseTime(generatedAt, "generatedAt");
  if (generatedAtMs < capturedAtMs) throw new Error("generatedAt cannot precede capturedAt");
  validateLevels(snapshot.bids, "bid");
  validateLevels(snapshot.asks, "ask");
  finite(snapshot.bestBid, "bestBid");
  finite(snapshot.bestAsk, "bestAsk");
  finite(snapshot.lastTradePrice, "lastTradePrice");
  finite(snapshot.lastTradeQuantity, "lastTradeQuantity");
  if (snapshot.bestBid <= 0 || snapshot.bestAsk <= 0 || snapshot.bestBid >= snapshot.bestAsk) throw new Error("best bid/ask must form an uncrossed book");
  if (snapshot.lastTradePrice <= 0 || snapshot.lastTradeQuantity < 0) throw new Error("last trade values are invalid");

  const depth = Math.min(policy.depthLevels, snapshot.bids.length, snapshot.asks.length);
  const bids = snapshot.bids.slice(0, depth);
  const asks = snapshot.asks.slice(0, depth);
  const visibleBidNotional = bids.reduce((sum, level) => sum + level.price * level.quantity, 0);
  const visibleAskNotional = asks.reduce((sum, level) => sum + level.price * level.quantity, 0);
  const sweepNotional = snapshot.lastTradePrice * snapshot.lastTradeQuantity;
  const referenceNotional = snapshot.aggressorSide === "BUY" ? visibleAskNotional : snapshot.aggressorSide === "SELL" ? visibleBidNotional : 0;
  const consumedDepthRatio = referenceNotional <= 0 ? 0 : Math.min(1, sweepNotional / referenceNotional);
  const mid = (snapshot.bestBid + snapshot.bestAsk) / 2;
  const spreadRate = (snapshot.bestAsk - snapshot.bestBid) / mid;
  const priceImpactRate = Math.abs(snapshot.lastTradePrice - mid) / mid;

  const side: LiquiditySweepFeature["side"] = snapshot.aggressorSide === "BUY" && snapshot.lastTradePrice >= snapshot.bestAsk
    ? "UP_SWEEP"
    : snapshot.aggressorSide === "SELL" && snapshot.lastTradePrice <= snapshot.bestBid
      ? "DOWN_SWEEP"
      : "NONE";

  const reasons: string[] = [];
  if (generatedAtMs - capturedAtMs > policy.staleAfterMs) reasons.push("SNAPSHOT_STALE");
  if (spreadRate > policy.maximumSpreadRate) reasons.push("SPREAD_TOO_WIDE");
  if (side === "NONE") reasons.push("NO_DIRECTIONAL_SWEEP");
  if (sweepNotional < policy.minimumSweepNotional) reasons.push("SWEEP_NOTIONAL_LOW");
  if (consumedDepthRatio < policy.minimumConsumedDepthRatio) reasons.push("CONSUMED_DEPTH_RATIO_LOW");
  if (reasons.length === 0) reasons.push("LIQUIDITY_SWEEP_ELIGIBLE");

  const payload = {
    featureVersion: policy.featureVersion,
    snapshotId: snapshot.snapshotId.trim(),
    market: snapshot.market.trim(),
    generatedAt,
    side,
    spreadRate: round(spreadRate),
    visibleBidNotional: round(visibleBidNotional),
    visibleAskNotional: round(visibleAskNotional),
    sweepNotional: round(sweepNotional),
    consumedDepthRatio: round(consumedDepthRatio),
    priceImpactRate: round(priceImpactRate),
    eligible: reasons.length === 1 && reasons[0] === "LIQUIDITY_SWEEP_ELIGIBLE",
    reasons: Object.freeze(reasons),
    provenance: Object.freeze([snapshot.snapshotId.trim(), snapshot.source.trim()])
  };
  const contentHash = hash(payload);
  if (!SHA256.test(contentHash)) throw new Error("content hash invariant violated");
  return Object.freeze({ ...payload, contentHash });
};
