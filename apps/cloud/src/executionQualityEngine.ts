export type ExecutionSide = "BUY" | "SELL";
export type ExecutionQuality = "GOOD" | "ACCEPTABLE" | "POOR";

export interface ExecutionQualityInput {
  readonly symbol: string;
  readonly side: ExecutionSide;
  readonly expectedPrice: number;
  readonly actualPrice: number;
  readonly quantity: number;
  readonly feePaid: number;
  readonly submittedAt: number;
  readonly filledAt: number;
  readonly acceptableSlippageBps: number;
  readonly poorSlippageBps: number;
  readonly acceptableLatencyMs: number;
  readonly poorLatencyMs: number;
}

export interface ExecutionQualityResult {
  readonly symbol: string;
  readonly side: ExecutionSide;
  readonly notional: number;
  readonly slippageBps: number;
  readonly latencyMs: number;
  readonly feeRateBps: number;
  readonly totalCostBps: number;
  readonly quality: ExecutionQuality;
  readonly warnings: readonly string[];
}

const positive = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
};
const nonNegative = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
};
const safeTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function evaluateExecutionQuality(input: ExecutionQualityInput): ExecutionQualityResult {
  if (!input.symbol.trim()) throw new Error("symbol is required");
  positive(input.expectedPrice, "expectedPrice");
  positive(input.actualPrice, "actualPrice");
  positive(input.quantity, "quantity");
  nonNegative(input.feePaid, "feePaid");
  safeTime(input.submittedAt, "submittedAt");
  safeTime(input.filledAt, "filledAt");
  if (input.filledAt < input.submittedAt) throw new Error("filledAt cannot precede submittedAt");
  nonNegative(input.acceptableSlippageBps, "acceptableSlippageBps");
  nonNegative(input.poorSlippageBps, "poorSlippageBps");
  nonNegative(input.acceptableLatencyMs, "acceptableLatencyMs");
  nonNegative(input.poorLatencyMs, "poorLatencyMs");
  if (input.acceptableSlippageBps > input.poorSlippageBps) throw new Error("acceptableSlippageBps cannot exceed poorSlippageBps");
  if (input.acceptableLatencyMs > input.poorLatencyMs) throw new Error("acceptableLatencyMs cannot exceed poorLatencyMs");

  const notional = input.actualPrice * input.quantity;
  const signedMove = input.side === "BUY"
    ? (input.actualPrice - input.expectedPrice) / input.expectedPrice
    : (input.expectedPrice - input.actualPrice) / input.expectedPrice;
  const slippageBps = round4(signedMove * 10_000);
  const latencyMs = input.filledAt - input.submittedAt;
  const feeRateBps = round4((input.feePaid / notional) * 10_000);
  const totalCostBps = round4(Math.max(0, slippageBps) + feeRateBps);
  const warnings: string[] = [];

  if (slippageBps > input.acceptableSlippageBps) warnings.push("SLIPPAGE_ABOVE_TARGET");
  if (latencyMs > input.acceptableLatencyMs) warnings.push("LATENCY_ABOVE_TARGET");
  if (slippageBps >= input.poorSlippageBps) warnings.push("SLIPPAGE_POOR");
  if (latencyMs >= input.poorLatencyMs) warnings.push("LATENCY_POOR");

  const quality: ExecutionQuality = slippageBps >= input.poorSlippageBps || latencyMs >= input.poorLatencyMs
    ? "POOR"
    : slippageBps > input.acceptableSlippageBps || latencyMs > input.acceptableLatencyMs
      ? "ACCEPTABLE"
      : "GOOD";

  return Object.freeze({
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    notional: round4(notional),
    slippageBps,
    latencyMs,
    feeRateBps,
    totalCostBps,
    quality,
    warnings: Object.freeze(warnings)
  });
}
