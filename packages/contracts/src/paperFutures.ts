/**
 * PAPER-only USD-M perpetual futures contract (design v1 §3, B1). A separate domain from Upbit spot: it shares no
 * mutable state, ledger or risk gate with it. Nothing here holds a credential, reaches an exchange or places an order.
 */
export type PaperFuturesSide = "LONG" | "SHORT";
export type PaperFuturesMarginMode = "ISOLATED";

export interface PaperFuturesCostProfile {
  /** Taker fee rate per side, e.g. 0.0005 (0.05%). */
  readonly takerFeeRate: number;
  /** Adverse slippage in basis points applied to every fill. */
  readonly slippageBps: number;
  /** Maintenance margin rate used for the liquidation price, e.g. 0.004. */
  readonly maintenanceMarginRate: number;
}

export interface PaperFuturesPosition {
  readonly symbol: string;
  readonly side: PaperFuturesSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly leverage: number;
  readonly marginMode: PaperFuturesMarginMode;
  /** Isolated margin in USDT, including funding paid or received since opening. */
  readonly isolatedMargin: number;
  readonly liquidationPrice: number;
  readonly openedAt: number;
}

export interface PaperFuturesAccount {
  /** USDT not committed to any isolated position. */
  readonly walletBalance: number;
  readonly positions: readonly PaperFuturesPosition[];
  readonly ledger: readonly PaperFuturesLedgerEntry[];
}

export type PaperFuturesLedgerEntry = Readonly<{
  readonly id: string;
  readonly at: number;
  readonly symbol: string;
  readonly kind: "OPEN" | "CLOSE" | "FUNDING" | "LIQUIDATION";
  readonly side: PaperFuturesSide;
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  /** Realized P&L in USDT for CLOSE/LIQUIDATION (after fees), the signed funding amount for FUNDING, 0 for OPEN. */
  readonly realizedPnl: number;
}>;

export interface PaperFuturesOrderIntent {
  /** Idempotency key: the same id is never applied twice. */
  readonly id: string;
  readonly symbol: string;
  readonly side: PaperFuturesSide;
  readonly quantity: number;
  readonly leverage: number;
  readonly marginMode: PaperFuturesMarginMode;
  /** true: may only shrink or close an existing position of the opposite exposure. */
  readonly reduceOnly: boolean;
}

/** Owner-accepted limits (2026-10-14, "all as recommended"). They may only be tightened. */
export interface PaperFuturesRiskLimits {
  readonly maxLeverage: number;
  readonly minLiquidationDistanceRatio: number;
  readonly maxConsecutiveLosses: number;
  readonly maxDailyLossRatio: number;
  readonly maxPositionMarginRatio: number;
}

export const PAPER_FUTURES_OWNER_LIMITS: PaperFuturesRiskLimits = Object.freeze({
  maxLeverage: 2,
  minLiquidationDistanceRatio: 0.25,
  maxConsecutiveLosses: 3,
  maxDailyLossRatio: 0.05,
  maxPositionMarginRatio: 0.2,
});

export const PAPER_FUTURES_AUTHORITY = Object.freeze({
  mode: "PAPER" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  credentials: "NONE" as const,
});
