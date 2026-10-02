import type { ResearchMarketPoint } from "../../../packages/contracts/src/researchRuntime";

/**
 * Bounded per-market buffer of recent price observations for building research inputs.
 * Rejects (never repairs) bad data: non-finite or non-positive prices, and points that are not strictly newer.
 */
export type MarketWindowPushResult = "ACCEPTED" | "INVALID" | "OUT_OF_ORDER";

export class ResearchMarketWindow {
  private readonly byMarket = new Map<string, ResearchMarketPoint[]>();

  public constructor(private readonly capacityPerMarket: number) {
    if (!Number.isSafeInteger(capacityPerMarket) || capacityPerMarket < 2 || capacityPerMarket > 10_000) throw new Error("research market window capacity is invalid");
  }

  public push(point: ResearchMarketPoint): MarketWindowPushResult {
    if (typeof point.market !== "string" || !/^KRW-[A-Z0-9-]+$/.test(point.market)) return "INVALID";
    if (!Number.isFinite(point.price) || point.price <= 0 || !Number.isSafeInteger(point.observedAt) || point.observedAt <= 0) return "INVALID";
    const points = this.byMarket.get(point.market) ?? [];
    const last = points[points.length - 1];
    if (last != null && point.observedAt <= last.observedAt) return "OUT_OF_ORDER";
    points.push(Object.freeze({ market: point.market, price: point.price, observedAt: point.observedAt }));
    if (points.length > this.capacityPerMarket) points.splice(0, points.length - this.capacityPerMarket);
    this.byMarket.set(point.market, points);
    return "ACCEPTED";
  }

  /** The newest `count` points for a market, oldest first. Empty when fewer than `count` are held (never a partial window). */
  public window(market: string, count: number): readonly ResearchMarketPoint[] {
    const points = this.byMarket.get(market) ?? [];
    if (!Number.isSafeInteger(count) || count < 1 || points.length < count) return Object.freeze([]);
    return Object.freeze(points.slice(points.length - count));
  }

  public size(market: string): number {
    return this.byMarket.get(market)?.length ?? 0;
  }
}
