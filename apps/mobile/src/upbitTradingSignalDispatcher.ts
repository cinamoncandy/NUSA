import type { UpbitCredentialProvider } from "./upbitCredentialSession";
import type { UpbitOrderRequest } from "./upbitLiveClient";
import { UpbitTradingManager, type TradingDecision } from "./upbitTradingManager";

/**
 * Stage 3: AI auto-execution signal dispatcher
 *
 * Coordinates between AI trading signals and the UpbitTradingManager.
 * Handles mode-specific execution paths:
 * - PAPER: Auto-execute immediately (AI learns via simulation)
 * - LIVE: Require human confirmation before execution (human guard)
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
  readonly confidence: number; // 0.0 - 1.0
  readonly reasoning: string;
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

/**
 * Creates a trading signal from AI prediction data.
 * Validates that the signal meets minimum confidence and market conditions.
 */
export function createTradingSignal(options: {
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly ordType: "LIMIT" | "MARKET" | "BEST";
  readonly price?: number;
  readonly volume: number;
  readonly confidence: number;
  readonly reasoning: string;
}): TradingSignalEvent | null {
  // Minimum confidence threshold for executing signals
  const MIN_CONFIDENCE = 0.65;

  if (options.confidence < MIN_CONFIDENCE) {
    return null; // Signal confidence below threshold
  }

  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(options.market)) {
    return null; // Invalid market format
  }

  if (options.volume <= 0 || !Number.isFinite(options.volume)) {
    return null; // Invalid volume
  }

  if (
    options.ordType === "LIMIT" &&
    (!options.price || options.price <= 0 || !Number.isFinite(options.price))
  ) {
    return null; // LIMIT orders require valid price
  }

  return {
    signalId: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    market: options.market,
    side: options.side,
    ordType: options.ordType,
    price: options.price,
    volume: options.volume,
    confidence: options.confidence,
    reasoning: options.reasoning,
    timestamp: Date.now(),
  };
}

/**
 * Extracts trading intent from AI thesis.
 * Parses natural language AI observation to detect trading signals.
 *
 * Pattern matching for common trading signals:
 * - "매수" / "BUY" / "LONG"
 * - "매도" / "SELL" / "SHORT"
 * - Market mentions (KRW-BTC, BTC/KRW, etc.)
 * - Confidence indicators (확실, 강함, 가능성 높음)
 */
export function extractTradingSignalFromThesis(
  thesis: string | null
): {
  side: "BUY" | "SELL" | null;
  confidence: number;
  reasoning: string;
} {
  if (!thesis) {
    return { side: null, confidence: 0, reasoning: "No AI thesis available" };
  }

  const lower = thesis.toLowerCase();

  // Detect direction
  let side: "BUY" | "SELL" | null = null;
  let confidence = 0.5; // Base confidence

  const buyPatterns =
    /매수|buy|long|상승|상승세|매수신호|매수신호 강함|강한 상승/i;
  const sellPatterns =
    /매도|sell|short|하락|하락세|매도신호|매도신호 강함|강한 하락/i;

  if (buyPatterns.test(lower)) {
    side = "BUY";
    confidence += 0.15;
  } else if (sellPatterns.test(lower)) {
    side = "SELL";
    confidence += 0.15;
  }

  // Adjust confidence based on confidence keywords
  if (
    /확실|강함|강력|가능성 높음|매우 높음|강세/i.test(lower)
  ) {
    confidence = Math.min(0.85, confidence + 0.2);
  } else if (
    /약함|약세|주의|가능성 낮음|낮음/i.test(lower)
  ) {
    confidence = Math.max(0.4, confidence - 0.15);
  }

  // Clamp confidence to valid range
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    side,
    confidence,
    reasoning: thesis.substring(0, 200),
  };
}
