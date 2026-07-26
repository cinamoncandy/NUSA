/** Mirrors apps/server's real response shapes (see apps/server/src/apiRouter.ts,
 * apps/server/src/paperRuntime.ts, apps/desktop/src/controlPlane.ts) -- not invented, every
 * field here is one this app actually reads from a real running server. */

export interface MarketSnapshot {
  readonly status: "CONNECTED" | "CONNECTING" | "ERROR";
  readonly price?: number;
  readonly lastError?: string;
}

export interface Position {
  readonly market: string;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly realizedPnl: number;
}

export interface Order {
  readonly id: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: string;
  readonly requestedQuantity: number;
  readonly quotedPrice: number;
  readonly spreadCost: number;
  readonly slippageCost: number;
  readonly marketImpactCost: number;
}

export interface Account {
  readonly cash: number;
  readonly equity: number;
  readonly unrealizedPnl: number;
  readonly position: Position;
  readonly orders: readonly Order[];
}

export interface ControlEvent {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly timestamp: string;
}

export interface ControlSnapshot {
  readonly status: "STOPPED" | "RUNNING";
  readonly strategyId: string;
  readonly autoTradeEnabled: boolean;
  readonly orderQuantity: number;
  readonly events: readonly ControlEvent[];
  readonly activeStrategyId?: string;
}

export interface ApiErrorBody {
  readonly error: string;
}
