import { createHash } from "node:crypto";
import type { OrderbookImbalanceFeature } from "./OrderbookImbalanceFeature";

export type OrderbookImbalancePosition = "FLAT" | "LONG" | "SHORT";
export type OrderbookImbalanceAction = "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "HOLD" | "ABSTAIN";

export interface OrderbookImbalanceStrategyPolicy {
  readonly strategyVersion: number;
  readonly minimumBookImbalance: number;
  readonly minimumQueueImbalance: number;
  readonly minimumMicropriceDeviationRate: number;
  readonly maximumEntrySpreadRate: number;
  readonly exitImbalanceAbsolute: number;
  readonly stopMicropriceDeviationRate: number;
  readonly maximumHoldingSnapshots: number;
  readonly cooldownSnapshots: number;
  readonly maximumConsecutiveLosses: number;
}

export interface OrderbookImbalanceStrategyState {
  readonly position: OrderbookImbalancePosition;
  readonly holdingSnapshots: number;
  readonly cooldownRemaining: number;
  readonly consecutiveLosses: number;
}

export interface OrderbookImbalanceStrategyDecision {
  readonly decisionId: string;
  readonly strategyId: "ORDERBOOK_IMBALANCE";
  readonly strategyVersion: number;
  readonly market: string;
  readonly generatedAt: string;
  readonly action: OrderbookImbalanceAction;
  readonly targetPosition: OrderbookImbalancePosition;
  readonly confidence: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly featureVersion: number;
  readonly featureHash: string;
  readonly featureSnapshotId: string;
  readonly nextState: OrderbookImbalanceStrategyState;
  readonly contentHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};

const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const validatePolicy = (policy: OrderbookImbalanceStrategyPolicy): void => {
  if (!Number.isInteger(policy.strategyVersion) || policy.strategyVersion < 1) throw new Error("strategyVersion must be a positive integer");
  for (const [label, value] of [
    ["minimumBookImbalance", policy.minimumBookImbalance],
    ["minimumQueueImbalance", policy.minimumQueueImbalance],
    ["minimumMicropriceDeviationRate", policy.minimumMicropriceDeviationRate],
    ["maximumEntrySpreadRate", policy.maximumEntrySpreadRate],
    ["exitImbalanceAbsolute", policy.exitImbalanceAbsolute],
    ["stopMicropriceDeviationRate", policy.stopMicropriceDeviationRate]
  ] as const) finite(value, label);
  if (policy.minimumBookImbalance < 0 || policy.minimumBookImbalance > 1) throw new Error("minimumBookImbalance must be between 0 and 1");
  if (policy.minimumQueueImbalance < 0 || policy.minimumQueueImbalance > 1) throw new Error("minimumQueueImbalance must be between 0 and 1");
  if (policy.minimumMicropriceDeviationRate < 0) throw new Error("minimumMicropriceDeviationRate must be non-negative");
  if (policy.maximumEntrySpreadRate < 0 || policy.maximumEntrySpreadRate >= 1) throw new Error("maximumEntrySpreadRate must be between 0 and 1");
  if (policy.exitImbalanceAbsolute < 0 || policy.exitImbalanceAbsolute > 1) throw new Error("exitImbalanceAbsolute must be between 0 and 1");
  if (policy.stopMicropriceDeviationRate < 0) throw new Error("stopMicropriceDeviationRate must be non-negative");
  if (!Number.isInteger(policy.maximumHoldingSnapshots) || policy.maximumHoldingSnapshots < 1) throw new Error("maximumHoldingSnapshots must be positive");
  if (!Number.isInteger(policy.cooldownSnapshots) || policy.cooldownSnapshots < 0) throw new Error("cooldownSnapshots must be non-negative");
  if (!Number.isInteger(policy.maximumConsecutiveLosses) || policy.maximumConsecutiveLosses < 1) throw new Error("maximumConsecutiveLosses must be positive");
};

const validateState = (state: OrderbookImbalanceStrategyState): void => {
  if (!new Set<OrderbookImbalancePosition>(["FLAT", "LONG", "SHORT"]).has(state.position)) throw new Error("invalid position");
  for (const [label, value] of [
    ["holdingSnapshots", state.holdingSnapshots],
    ["cooldownRemaining", state.cooldownRemaining],
    ["consecutiveLosses", state.consecutiveLosses]
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  }
  if (state.position === "FLAT" && state.holdingSnapshots !== 0) throw new Error("flat state cannot have holdingSnapshots");
};

const nextFlatState = (state: OrderbookImbalanceStrategyState, cooldown: number): OrderbookImbalanceStrategyState => Object.freeze({
  position: "FLAT",
  holdingSnapshots: 0,
  cooldownRemaining: cooldown,
  consecutiveLosses: state.consecutiveLosses
});

export const createInitialOrderbookImbalanceStrategyState = (): OrderbookImbalanceStrategyState => Object.freeze({
  position: "FLAT",
  holdingSnapshots: 0,
  cooldownRemaining: 0,
  consecutiveLosses: 0
});

export const evaluateOrderbookImbalanceStrategy = (
  decisionId: string,
  feature: OrderbookImbalanceFeature,
  state: OrderbookImbalanceStrategyState,
  policy: OrderbookImbalanceStrategyPolicy
): OrderbookImbalanceStrategyDecision => {
  validatePolicy(policy);
  validateState(state);
  if (!decisionId.trim()) throw new Error("decisionId is required");
  if (!SHA256.test(feature.contentHash)) throw new Error("feature contentHash is invalid");

  let action: OrderbookImbalanceAction = "HOLD";
  let targetPosition: OrderbookImbalancePosition = state.position;
  let confidence = 0;
  const reasons: string[] = [];
  let nextState: OrderbookImbalanceStrategyState;

  if (!feature.eligible) {
    action = state.position === "FLAT" ? "ABSTAIN" : "EXIT";
    targetPosition = "FLAT";
    reasons.push(state.position === "FLAT" ? "FEATURE_INELIGIBLE" : "LIQUIDITY_GUARD_EXIT");
    nextState = nextFlatState(state, state.position === "FLAT" ? Math.max(0, state.cooldownRemaining - 1) : policy.cooldownSnapshots);
  } else if (state.position === "FLAT") {
    const cooldownRemaining = Math.max(0, state.cooldownRemaining - 1);
    if (state.consecutiveLosses >= policy.maximumConsecutiveLosses) {
      action = "ABSTAIN";
      reasons.push("CONSECUTIVE_LOSS_GUARD");
      nextState = Object.freeze({ ...state, cooldownRemaining, holdingSnapshots: 0 });
    } else if (state.cooldownRemaining > 0) {
      action = "ABSTAIN";
      reasons.push("COOLDOWN_ACTIVE");
      nextState = Object.freeze({ ...state, cooldownRemaining, holdingSnapshots: 0 });
    } else {
      const longSignal = feature.bookImbalance >= policy.minimumBookImbalance
        && feature.queueImbalance >= policy.minimumQueueImbalance
        && feature.micropriceDeviationRate >= policy.minimumMicropriceDeviationRate;
      const shortSignal = feature.bookImbalance <= -policy.minimumBookImbalance
        && feature.queueImbalance <= -policy.minimumQueueImbalance
        && feature.micropriceDeviationRate <= -policy.minimumMicropriceDeviationRate;
      const spreadOk = feature.spreadRate <= policy.maximumEntrySpreadRate;
      if (!spreadOk) {
        action = "ABSTAIN";
        reasons.push("ENTRY_SPREAD_TOO_WIDE");
        nextState = Object.freeze({ ...state, cooldownRemaining: 0, holdingSnapshots: 0 });
      } else if (longSignal || shortSignal) {
        action = longSignal ? "ENTER_LONG" : "ENTER_SHORT";
        targetPosition = longSignal ? "LONG" : "SHORT";
        reasons.push(longSignal ? "BULLISH_ORDERBOOK_IMBALANCE" : "BEARISH_ORDERBOOK_IMBALANCE");
        confidence = clamp01((Math.abs(feature.bookImbalance) + Math.abs(feature.queueImbalance) + Math.min(1, Math.abs(feature.micropriceDeviationRate) / Math.max(policy.minimumMicropriceDeviationRate, 1e-12))) / 3);
        nextState = Object.freeze({ position: targetPosition, holdingSnapshots: 1, cooldownRemaining: 0, consecutiveLosses: state.consecutiveLosses });
      } else {
        action = "ABSTAIN";
        reasons.push("ENTRY_THRESHOLDS_NOT_MET");
        nextState = Object.freeze({ ...state, cooldownRemaining: 0, holdingSnapshots: 0 });
      }
    }
  } else {
    const isLong = state.position === "LONG";
    const adverseMicroprice = isLong
      ? feature.micropriceDeviationRate <= -policy.stopMicropriceDeviationRate
      : feature.micropriceDeviationRate >= policy.stopMicropriceDeviationRate;
    const meanReverted = Math.abs(feature.bookImbalance) <= policy.exitImbalanceAbsolute;
    const timeStop = state.holdingSnapshots >= policy.maximumHoldingSnapshots;
    const spreadExit = feature.spreadRate > policy.maximumEntrySpreadRate;
    if (adverseMicroprice || meanReverted || timeStop || spreadExit) {
      action = "EXIT";
      targetPosition = "FLAT";
      if (adverseMicroprice) reasons.push("ADVERSE_MICROPRICE_STOP");
      if (meanReverted) reasons.push("IMBALANCE_MEAN_REVERTED");
      if (timeStop) reasons.push("MAXIMUM_HOLDING_REACHED");
      if (spreadExit) reasons.push("SPREAD_EXPANSION_EXIT");
      nextState = nextFlatState(state, policy.cooldownSnapshots);
    } else {
      action = "HOLD";
      reasons.push("POSITION_HELD");
      confidence = clamp01((Math.abs(feature.bookImbalance) + Math.abs(feature.queueImbalance)) / 2);
      nextState = Object.freeze({ ...state, holdingSnapshots: state.holdingSnapshots + 1 });
    }
  }

  const payload = {
    decisionId: decisionId.trim(),
    strategyId: "ORDERBOOK_IMBALANCE" as const,
    strategyVersion: policy.strategyVersion,
    market: feature.market,
    generatedAt: feature.generatedAt,
    action,
    targetPosition,
    confidence: round(confidence),
    eligible: action !== "ABSTAIN",
    reasons: Object.freeze(reasons),
    featureVersion: feature.featureVersion,
    featureHash: feature.contentHash,
    featureSnapshotId: feature.snapshotId,
    nextState
  };
  const contentHash = hash(payload);
  if (!SHA256.test(contentHash)) throw new Error("decision content hash invariant violated");
  return Object.freeze({ ...payload, contentHash });
};

export const recordOrderbookImbalanceTradeOutcome = (
  state: OrderbookImbalanceStrategyState,
  profitable: boolean
): OrderbookImbalanceStrategyState => {
  validateState(state);
  if (state.position !== "FLAT") throw new Error("trade outcome can only be recorded while flat");
  return Object.freeze({
    ...state,
    consecutiveLosses: profitable ? 0 : state.consecutiveLosses + 1
  });
};
