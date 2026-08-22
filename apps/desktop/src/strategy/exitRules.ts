/**
 * Protective exit rules independent of the SMA crossover signal itself. Addresses the
 * investment-strategy audit's "exit logic is crossover-only... no protective stop, time
 * stop, trailing rule, volatility exit" finding.
 *
 * These are pure, generic risk-reduction checks -- they can only ever recommend exiting
 * a position sooner than the crossover signal alone would, never entering one. Both
 * operate on an operator-configured threshold rather than a value implied by any
 * backtest, so neither one asserts anything about expected profitability.
 *
 * Deliberately not wired into SmaCrossoverStrategy, StrategyEngine, or
 * RuntimeCommandService.automaticSignal() yet: doing so would change what SELL signals
 * the live automatic-trading path actually produces, which is a real behavior change to
 * the execution path deserving its own explicit review -- not something to fold in
 * silently alongside a generic utility, the same reasoning already applied to
 * calculateFixedFractionalQuantity, priceTick, and marketImpactBpsPerUnit earlier on
 * this PR.
 */

export interface StopLossInput {
  /** Average entry price of the current open position. */
  readonly entryPrice: number;
  /** Current market price. */
  readonly currentPrice: number;
  /** Fraction of entryPrice the position may lose before a stop triggers, in (0, 1). E.g. 0.05 = 5%. */
  readonly stopLossFraction: number;
}

export interface TimeStopInput {
  /** When the current position was opened, in epoch milliseconds. */
  readonly openedAt: number;
  /** Current time, in epoch milliseconds. */
  readonly now: number;
  /** Maximum holding duration before a time stop triggers, in milliseconds. */
  readonly maxHoldingMs: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

/**
 * True once currentPrice has fallen to or below entryPrice * (1 - stopLossFraction).
 * This desktop app's PaperBroker is spot/long-only (no short positions), so a stop loss
 * is always a downside protection check against a held long position.
 */
export function shouldStopLoss(input: StopLossInput): boolean {
  assertPositiveFinite(input.entryPrice, "entryPrice");
  assertPositiveFinite(input.currentPrice, "currentPrice");
  if (!Number.isFinite(input.stopLossFraction) || input.stopLossFraction <= 0 || input.stopLossFraction >= 1) {
    throw new Error("stopLossFraction must be in (0, 1)");
  }
  const stopPrice = input.entryPrice * (1 - input.stopLossFraction);
  return input.currentPrice <= stopPrice;
}

/** True once a position has been held for at least maxHoldingMs. */
export function shouldTimeStop(input: TimeStopInput): boolean {
  assertNonNegativeSafeInteger(input.openedAt, "openedAt");
  assertNonNegativeSafeInteger(input.now, "now");
  if (input.now < input.openedAt) throw new Error("now cannot be before openedAt");
  assertPositiveFinite(input.maxHoldingMs, "maxHoldingMs");
  return input.now - input.openedAt >= input.maxHoldingMs;
}
