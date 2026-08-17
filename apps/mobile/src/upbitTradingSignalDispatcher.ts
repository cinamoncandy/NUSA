import type { UpbitCredentialProvider } from "./upbitCredentialSession";
import type { UpbitOrderRequest } from "./upbitLiveClient";
import { UpbitTradingManager, type TradingDecision } from "./upbitTradingManager";

/**
 * Order dispatcher.
 *
 * Every order originates from a human. AiReadOnlyProjection carries analysis --
 * thesis, calibrated confidence, evidence, counter-evidence, uncertainty -- and
 * deliberately carries no trade direction, because AI holds no order authority
 * (ADR-0004). There is therefore no structured signal to derive a side from, and
 * deriving one from the thesis text would manufacture an authority the contract
 * withholds. `origin` records that boundary in the type.
 *
 * Safety boundaries:
 * - All orders go through UpbitTradingManager validation
 * - Daily loss limits, order caps, rate limiting, minimum intervals
 * - Fail-closed: reject if any guard fails
 */

export interface TradingSignalEvent {
  readonly signalId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly ordType: "LIMIT" | "MARKET" | "BEST";
  readonly price?: number;
  readonly volume: number;
  /** Only a human may originate an order. AI analysis never reaches this type. */
  readonly origin: "HUMAN";
  readonly timestamp: number;
}

export interface TradingExecutionResult {
  readonly success: boolean;
  readonly uuid?: string;
  readonly state?: string;
  readonly error?: string;
  readonly requiresConfirmation?: boolean;
}

export interface TradingSignalDispatcherConfig {
  readonly credentialProvider: UpbitCredentialProvider;
  readonly mode: "PAPER" | "LIVE";
  readonly baseUrl?: string;
}

/**
 * Evaluates a trading signal for execution.
 * Returns permit status and whether human confirmation is required.
 */
export function evaluateTradingSignal(
  signal: TradingSignalEvent,
  tradingManager: UpbitTradingManager
): TradingDecision & { readonly signalId: string } {
  const estimatedKRW =
    signal.ordType === "LIMIT" && signal.price
      ? signal.price * signal.volume
      : signal.ordType === "MARKET" || signal.ordType === "BEST"
        ? signal.volume * 50_000_000 // Rough estimate for MARKET orders
        : 0;

  const validation = tradingManager.validateOrderPlacement(estimatedKRW);
  return {
    ...validation,
    signalId: signal.signalId,
  };
}

/**
 * Executes a trading signal immediately.
 * For PAPER mode: executes directly
 * For LIVE mode: requires external human confirmation (handled by modal)
 */
export async function executeTradingSignal(
  signal: TradingSignalEvent,
  tradingManager: UpbitTradingManager
): Promise<TradingExecutionResult> {
  const validation = evaluateTradingSignal(signal, tradingManager);

  if (!validation.permitted) {
    return {
      success: false,
      error: validation.reason || "Trading signal rejected by safety guards",
      requiresConfirmation: false,
    };
  }

  // LIVE mode requires human confirmation (handled externally via modal)
  if (validation.requiresHumanConfirm) {
    return {
      success: false,
      error: "LIVE mode requires human confirmation",
      requiresConfirmation: true,
    };
  }

  // PAPER mode: auto-execute
  try {
    const order: UpbitOrderRequest = {
      market: signal.market,
      side: signal.side,
      ordType: signal.ordType,
      price: signal.price,
      volume: signal.volume,
      mode: tradingManager.getMode(),
    };

    const result = await tradingManager.executeOrder(order);
    return {
      success: true,
      uuid: result.uuid,
      state: result.state,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order execution failed",
    };
  }
}

/**
 * Confirms and executes a previously-validated trading signal in LIVE mode.
 * This is called after human approval of the confirmation modal.
 */
export async function confirmAndExecuteTradingSignal(
  signal: TradingSignalEvent,
  tradingManager: UpbitTradingManager
): Promise<TradingExecutionResult> {
  if (tradingManager.getMode() !== "LIVE") {
    return {
      success: false,
      error: "Confirmation execution only supported in LIVE mode",
    };
  }

  try {
    const order: UpbitOrderRequest = {
      market: signal.market,
      side: signal.side,
      ordType: signal.ordType,
      price: signal.price,
      volume: signal.volume,
      mode: "LIVE",
    };

    const result = await tradingManager.executeOrder(order);
    return {
      success: true,
      uuid: result.uuid,
      state: result.state,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Order execution failed",
    };
  }
}
