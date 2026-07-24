export type CioAction = "BUY" | "SELL" | "HOLD" | "REDUCE" | "EXIT" | "WAIT";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SignalSource = "MACRO" | "NEWS" | "CHART" | "ONCHAIN" | "ETF" | "FUNDING" | "OI" | "RISK";

export interface CioSignal {
  readonly source: SignalSource;
  readonly score: number;
  readonly confidence: number;
  readonly observedAt: number;
  readonly reason: string;
}

export interface CioDecisionInput {
  readonly symbol: string;
  readonly now: number;
  readonly signals: readonly CioSignal[];
  readonly currentAllocation: number;
  readonly maxAllocation: number;
  readonly maxLeverage: number;
  readonly risk: RiskLevel;
  readonly tradingEnabled: boolean;
}

export interface CioDecision {
  readonly symbol: string;
  readonly action: CioAction;
  readonly confidence: number;
  readonly risk: RiskLevel;
  readonly allocation: number;
  readonly leverage: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly decidedAt: number;
}

const WEIGHTS: Readonly<Record<SignalSource, number>> = Object.freeze({
  MACRO: 1.2,
  NEWS: 1,
  CHART: 1.1,
  ONCHAIN: 0.9,
  ETF: 1.1,
  FUNDING: 0.8,
  OI: 0.8,
  RISK: 1.4
});

const assertUnit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const assertScore = (value: number): void => {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error("signal.score must be between -1 and 1");
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function decideCio(input: CioDecisionInput): CioDecision {
  if (!input.symbol.trim()) throw new Error("symbol is required");
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  assertUnit(input.currentAllocation, "currentAllocation");
  assertUnit(input.maxAllocation, "maxAllocation");
  if (input.currentAllocation > input.maxAllocation) throw new Error("currentAllocation exceeds maxAllocation");
  if (!Number.isInteger(input.maxLeverage) || input.maxLeverage < 1 || input.maxLeverage > 20) throw new Error("maxLeverage must be an integer between 1 and 20");
  if (input.signals.length === 0) throw new Error("at least one signal is required");

  const seen = new Set<SignalSource>();
  let weightedScore = 0;
  let totalWeight = 0;
  let confidenceWeight = 0;
  const reasons: string[] = [];

  const ordered = [...input.signals].sort((a, b) => a.source.localeCompare(b.source));
  for (const signal of ordered) {
    if (seen.has(signal.source)) throw new Error(`duplicate signal source: ${signal.source}`);
    seen.add(signal.source);
    assertScore(signal.score);
    assertUnit(signal.confidence, "signal.confidence");
    if (!Number.isSafeInteger(signal.observedAt) || signal.observedAt < 0 || signal.observedAt > input.now) throw new Error("signal.observedAt is invalid");
    if (!signal.reason.trim()) throw new Error("signal.reason is required");
    const weight = WEIGHTS[signal.source] * signal.confidence;
    weightedScore += signal.score * weight;
    confidenceWeight += signal.confidence * WEIGHTS[signal.source];
    totalWeight += WEIGHTS[signal.source];
    reasons.push(`${signal.source}: ${signal.reason.trim()}`);
  }

  const score = round4(weightedScore / Math.max(confidenceWeight, Number.EPSILON));
  const confidence = round4(clamp(confidenceWeight / totalWeight, 0, 1));

  let action: CioAction;
  let allocation = input.currentAllocation;
  let leverage = 1;

  if (!input.tradingEnabled) {
    action = "WAIT";
  } else if (input.risk === "CRITICAL") {
    action = input.currentAllocation > 0 ? "EXIT" : "WAIT";
    allocation = 0;
  } else if (input.risk === "HIGH") {
    action = input.currentAllocation > 0 ? "REDUCE" : "WAIT";
    allocation = round4(input.currentAllocation * 0.5);
  } else if (score >= 0.35 && confidence >= 0.55) {
    action = input.currentAllocation === 0 ? "BUY" : "HOLD";
    allocation = round4(clamp(input.currentAllocation + (input.maxAllocation - input.currentAllocation) * confidence, 0, input.maxAllocation));
    leverage = input.risk === "LOW" ? Math.min(2, input.maxLeverage) : 1;
  } else if (score <= -0.35 && confidence >= 0.55) {
    action = input.currentAllocation > 0 ? "SELL" : "WAIT";
    allocation = 0;
  } else {
    action = input.currentAllocation > 0 ? "HOLD" : "WAIT";
  }

  return Object.freeze({
    symbol: input.symbol.trim().toUpperCase(),
    action,
    confidence,
    risk: input.risk,
    allocation,
    leverage,
    score,
    reasons: Object.freeze(reasons),
    decidedAt: input.now
  });
}
