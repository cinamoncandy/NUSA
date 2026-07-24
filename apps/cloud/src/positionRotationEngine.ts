import type { ProbabilityEdgeResult } from "./probabilityEdgeEngine";

export type RotationAction = "INCREASE_LONG" | "INCREASE_SHORT" | "REDUCE" | "HOLD" | "FLAT";

export interface PositionRotationInput {
  readonly now: number;
  readonly edge: ProbabilityEdgeResult;
  readonly currentNetExposure: number;
  readonly maxAbsoluteExposure: number;
  readonly maxStep: number;
  readonly minimumStep: number;
  readonly lastRotationAt?: number;
  readonly cooldownMs: number;
  readonly reversalsInWindow: number;
  readonly maxReversalsInWindow: number;
}

export interface PositionRotationPlan {
  readonly symbol: string;
  readonly action: RotationAction;
  readonly currentNetExposure: number;
  readonly targetNetExposure: number;
  readonly delta: number;
  readonly blockedReason?: "STALE_EDGE" | "COOLDOWN" | "REVERSAL_LIMIT" | "NO_EDGE";
  readonly decidedAt: number;
}

const bounded = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error(`${field} must be between -1 and 1`);
};
const positiveUnit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`${field} must be greater than 0 and at most 1`);
};
const safeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function planPositionRotation(input: PositionRotationInput): PositionRotationPlan {
  safeInteger(input.now, "now");
  bounded(input.currentNetExposure, "currentNetExposure");
  positiveUnit(input.maxAbsoluteExposure, "maxAbsoluteExposure");
  positiveUnit(input.maxStep, "maxStep");
  positiveUnit(input.minimumStep, "minimumStep");
  if (input.minimumStep > input.maxStep) throw new Error("minimumStep cannot exceed maxStep");
  safeInteger(input.cooldownMs, "cooldownMs");
  safeInteger(input.reversalsInWindow, "reversalsInWindow");
  safeInteger(input.maxReversalsInWindow, "maxReversalsInWindow");
  if (input.lastRotationAt !== undefined) {
    safeInteger(input.lastRotationAt, "lastRotationAt");
    if (input.lastRotationAt > input.now) throw new Error("lastRotationAt cannot be in the future");
  }

  const base = {
    symbol: input.edge.symbol,
    currentNetExposure: input.currentNetExposure,
    decidedAt: input.now
  } as const;

  const blocked = (reason: PositionRotationPlan["blockedReason"]): PositionRotationPlan => Object.freeze({
    ...base,
    action: input.currentNetExposure === 0 ? "FLAT" : "HOLD",
    targetNetExposure: input.currentNetExposure,
    delta: 0,
    blockedReason: reason
  });

  if (input.edge.stale) return blocked("STALE_EDGE");
  if (input.edge.direction === "NO_EDGE") {
    const reduction = Math.min(Math.abs(input.currentNetExposure), input.maxStep);
    const target = round6(input.currentNetExposure > 0 ? input.currentNetExposure - reduction : input.currentNetExposure < 0 ? input.currentNetExposure + reduction : 0);
    return Object.freeze({
      ...base,
      action: input.currentNetExposure === 0 ? "FLAT" : "REDUCE",
      targetNetExposure: target,
      delta: round6(target - input.currentNetExposure),
      blockedReason: "NO_EDGE"
    });
  }
  if (input.lastRotationAt !== undefined && input.now - input.lastRotationAt < input.cooldownMs) return blocked("COOLDOWN");

  const desiredSign = input.edge.direction === "LONG" ? 1 : -1;
  const reversing = input.currentNetExposure !== 0 && Math.sign(input.currentNetExposure) !== desiredSign;
  if (reversing && input.reversalsInWindow >= input.maxReversalsInWindow) return blocked("REVERSAL_LIMIT");

  const requestedStep = clamp(input.edge.netEdge, input.minimumStep, input.maxStep);
  let target = input.currentNetExposure + desiredSign * requestedStep;
  if (reversing) {
    target = Math.abs(input.currentNetExposure) <= requestedStep ? 0 : input.currentNetExposure + desiredSign * requestedStep;
  }
  target = round6(clamp(target, -input.maxAbsoluteExposure, input.maxAbsoluteExposure));
  const delta = round6(target - input.currentNetExposure);
  const action: RotationAction = delta === 0
    ? (target === 0 ? "FLAT" : "HOLD")
    : reversing || Math.abs(target) < Math.abs(input.currentNetExposure)
      ? "REDUCE"
      : desiredSign > 0 ? "INCREASE_LONG" : "INCREASE_SHORT";

  return Object.freeze({ ...base, action, targetNetExposure: target, delta });
}
