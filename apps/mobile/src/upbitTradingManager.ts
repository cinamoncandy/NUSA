import type { UpbitCredentialProvider } from "./upbitCredentialSession";
import type { UpbitOrderRequest } from "./upbitLiveClient";
import { placeUpbitOrder, cancelUpbitOrder } from "./upbitLiveClient";

/**
 * Stage 2/3: PAPER and LIVE trading manager with multi-stage safety guards.
 *
 * Safety boundaries:
 * - PAPER mode: AI can auto-execute orders for learning
 * - LIVE mode: Always requires human confirmation before execution
 * - All modes: Daily loss limit, order amount cap, rate limiting
 */

export interface TradingSafetyConfig {
  readonly dailyLossLimitKRW: number;        // Kill switch: stop LIVE orders if daily loss exceeds this
  readonly maxOrderAmountKRW: number;        // Maximum KRW per single order
  readonly rateLimitOrdersPerSecond: number; // Maximum orders per 5 seconds
  readonly minOrderIntervalMs: number;       // Minimum milliseconds between orders
}

export interface TradingSessionState {
  readonly mode: "PAPER" | "LIVE";
  readonly dailyLossKRW: number;
  readonly orderCountLast5Sec: number;
  readonly lastOrderTimeMs: number;
  readonly totalExecutedKRW: number;
}

export interface TradingDecision {
  readonly permitted: boolean;
  readonly reason?: string;
  readonly requiresHumanConfirm: boolean;
}

const DEFAULT_SAFETY_CONFIG: TradingSafetyConfig = {
  dailyLossLimitKRW: 500_000,           // ₩500k daily loss limit
  maxOrderAmountKRW: 5_000_000,          // ₩5M max per order
  rateLimitOrdersPerSecond: 1,           // 1 order per 5 seconds
  minOrderIntervalMs: 5_000,             // 5 second minimum between orders
};

export class UpbitTradingManager {
  private state: TradingSessionState;
  private safetyConfig: TradingSafetyConfig;
  private orderTimestamps: number[] = [];
  private credentialProvider: UpbitCredentialProvider;
  private baseUrl: string;

  public constructor(
    credentialProvider: UpbitCredentialProvider,
    mode: "PAPER" | "LIVE" = "PAPER",
    config: Partial<TradingSafetyConfig> = {},
    baseUrl: string = "https://nusa-api.duckdns.org"
  ) {
    this.credentialProvider = credentialProvider;
    this.baseUrl = baseUrl;
    this.safetyConfig = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.state = {
      mode,
      dailyLossKRW: 0,
      orderCountLast5Sec: 0,
      lastOrderTimeMs: 0,
      totalExecutedKRW: 0,
    };
  }

  public getMode(): "PAPER" | "LIVE" {
    return this.state.mode;
  }

  public setMode(mode: "PAPER" | "LIVE"): void {
    this.state = { ...this.state, mode };
  }

  public recordDailyLoss(lossKRW: number): void {
    this.state = { ...this.state, dailyLossKRW: this.state.dailyLossKRW + lossKRW };
  }

  public resetDailyLoss(): void {
    this.state = { ...this.state, dailyLossKRW: 0 };
  }

  /**
   * Evaluate whether an order can be placed.
   * Returns permit status and whether human confirmation is required.
   */
  public validateOrderPlacement(orderKRW: number): TradingDecision {
    const now = Date.now();

    // Safety check 1: Daily loss limit (Kill Switch)
    if (this.state.mode === "LIVE" && this.state.dailyLossKRW >= this.safetyConfig.dailyLossLimitKRW) {
      return {
        permitted: false,
        reason: `Daily loss limit exceeded (₩${this.state.dailyLossKRW.toLocaleString("ko-KR")} / ₩${this.safetyConfig.dailyLossLimitKRW.toLocaleString("ko-KR")}). LIVE mode disabled.`,
        requiresHumanConfirm: false,
      };
    }

    // Safety check 2: Order amount cap
    if (orderKRW > this.safetyConfig.maxOrderAmountKRW) {
      return {
        permitted: false,
        reason: `Order amount exceeds limit: ₩${orderKRW.toLocaleString("ko-KR")} > ₩${this.safetyConfig.maxOrderAmountKRW.toLocaleString("ko-KR")}`,
        requiresHumanConfirm: false,
      };
    }

    // Safety check 3: Rate limiting (prevent rapid-fire orders)
    const recentOrders = this.orderTimestamps.filter((t) => now - t < 5_000).length;
    if (recentOrders >= this.safetyConfig.rateLimitOrdersPerSecond) {
      return {
        permitted: false,
        reason: `Rate limit: ${recentOrders} orders in last 5 seconds. Maximum is ${this.safetyConfig.rateLimitOrdersPerSecond} order per 5 seconds.`,
        requiresHumanConfirm: false,
      };
    }

    // Safety check 4: Minimum order interval
    if (now - this.state.lastOrderTimeMs < this.safetyConfig.minOrderIntervalMs) {
      return {
        permitted: false,
        reason: `Minimum order interval not met. Wait ${Math.ceil((this.safetyConfig.minOrderIntervalMs - (now - this.state.lastOrderTimeMs)) / 1_000)}s.`,
        requiresHumanConfirm: false,
      };
    }

    // Determine if human confirmation is required
    const requiresHumanConfirm = this.state.mode === "LIVE";

    if (requiresHumanConfirm) {
      return {
        permitted: true,
        reason: "LIVE mode: Requires explicit human confirmation",
        requiresHumanConfirm: true,
      };
    }

    return {
      permitted: true,
      reason: "PAPER mode: Auto-execution permitted",
      requiresHumanConfirm: false,
    };
  }

  /**
   * Execute an order. In LIVE mode, human confirmation must be obtained separately.
   */
  public async executeOrder(order: UpbitOrderRequest): Promise<{ uuid: string; state: string }> {
    const validation = this.validateOrderPlacement(this.estimateOrderKRW(order));
    if (!validation.permitted) {
      throw new Error(`Order rejected: ${validation.reason}`);
    }

    try {
      const result = await placeUpbitOrder({
        credentialProvider: this.credentialProvider,
        order: { ...order, mode: this.state.mode },
        baseUrl: this.baseUrl,
      });

      // Record successful execution
      this.orderTimestamps.push(Date.now());
      this.state = {
        ...this.state,
        lastOrderTimeMs: Date.now(),
        totalExecutedKRW: this.state.totalExecutedKRW + this.estimateOrderKRW(order),
      };

      // Cleanup old timestamps (older than 5 seconds)
      const cutoff = Date.now() - 5_000;
      this.orderTimestamps = this.orderTimestamps.filter((t) => t > cutoff);

      return { uuid: result.uuid, state: result.state };
    } catch (error) {
      throw new Error(`Order execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Cancel an order.
   */
  public async cancelOrder(uuid: string): Promise<{ state: string }> {
    try {
      const result = await cancelUpbitOrder({
        credentialProvider: this.credentialProvider,
        uuid,
        mode: this.state.mode,
        baseUrl: this.baseUrl,
      });
      return { state: result.state };
    } catch (error) {
      throw new Error(`Order cancellation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Estimate KRW amount for an order (price * volume).
   * For MARKET orders, uses estimated current price.
   */
  private estimateOrderKRW(order: UpbitOrderRequest): number {
    if (order.ordType === "LIMIT" && order.price) {
      return order.price * order.volume;
    }
    if (order.ordType === "MARKET" || order.ordType === "BEST") {
      // For MARKET orders, assume 1M+ per BTC (rough estimate)
      // Actual price lookup would require live ticker integration
      return order.volume * 50_000_000; // Assume ₩50M per unit
    }
    return 0;
  }
}
