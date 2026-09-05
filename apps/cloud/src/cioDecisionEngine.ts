export type CioAction = "BUY" | "SELL" | "HOLD" | "REDUCE" | "EXIT" | "WAIT";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SignalSource = "MACRO" | "NEWS" | "CHART" | "ONCHAIN" | "ETF" | "FUNDING" | "OI" | "RISK";
import { normalizePaperCandidateStrategy, type PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";

/**
 * Fail-closed transport form of the research-side PAPER candidate binding receipt.
 *
 * This remains BOUND_UNVERIFIED. Carrying it on a CIO decision proves only that an
 * upstream governance receipt was supplied at a valid point in time. It does not
 * grant LIVE authority and does not by itself make a PAPER fill promotable evidence.
 */
export interface PaperCandidateExecutionBinding {
  readonly schemaVersion: 1;
  readonly status: "BOUND_UNVERIFIED";
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly advisoryGeneratedAt: number;
  readonly periodStartAt: number;
  readonly advisoryFingerprintSha256: string;
  readonly bindingFingerprintSha256: string;
  readonly candidateStrategy?: PaperCandidateStrategySpec;
}

export interface PaperCandidateStrategyDecision {
  readonly action: "BUY" | "SELL" | "HOLD" | "WAIT";
  readonly score: number;
  readonly confidence: number;
  readonly reason: string;
  readonly observedAt: number;
}

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
  readonly paperCandidateBinding?: PaperCandidateExecutionBinding;
  /** Decision produced by the bound immutable PAPER candidate strategy, when active. */
  readonly paperCandidateStrategyDecision?: PaperCandidateStrategyDecision;
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
  readonly paperCandidateBinding?: PaperCandidateExecutionBinding;
  readonly paperCandidateStrategyDecision?: PaperCandidateStrategyDecision;
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

const SHA256 = /^[a-f0-9]{64}$/;

const assertUnit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const assertScore = (value: number): void => {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error("signal.score must be between -1 and 1");
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function validatePaperCandidateExecutionBinding(
  binding: PaperCandidateExecutionBinding,
  decisionAt: number,
): PaperCandidateExecutionBinding {
  if (binding.schemaVersion !== 1 || binding.status !== "BOUND_UNVERIFIED" || binding.authority !== "PAPER_RESEARCH_ONLY") {
    throw new Error("paper candidate binding contract is invalid");
  }
  if (binding.liveAuthority !== "NONE" || binding.productionMutationAllowed !== false) {
    throw new Error("paper candidate binding authority must remain fail-closed");
  }
  const candidateId = binding.candidateId.trim();
  const datasetId = binding.datasetId.trim();
  if (!candidateId || candidateId === "CIO_PAPER") throw new Error("paper candidate binding candidateId is invalid");
  if (!datasetId) throw new Error("paper candidate binding datasetId is required");
  if (!SHA256.test(binding.datasetContentSha256) || !SHA256.test(binding.advisoryFingerprintSha256) || !SHA256.test(binding.bindingFingerprintSha256)) {
    throw new Error("paper candidate binding fingerprint is invalid");
  }
  for (const [name, value] of [["advisoryGeneratedAt", binding.advisoryGeneratedAt], ["periodStartAt", binding.periodStartAt], ["decisionAt", decisionAt]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  }
  if (binding.advisoryGeneratedAt >= binding.periodStartAt) throw new Error("paper candidate binding contains lookahead advisory provenance");
  if (binding.periodStartAt > decisionAt) throw new Error("paper candidate binding period starts after decision time");
  return Object.freeze({ ...binding, candidateId, datasetId, ...(binding.candidateStrategy == null ? {} : { candidateStrategy: normalizePaperCandidateStrategy(binding.candidateStrategy, candidateId) }) });
}

function validateCandidateStrategyDecision(value: PaperCandidateStrategyDecision, now: number): PaperCandidateStrategyDecision {
  if (value == null || !["BUY", "SELL", "HOLD", "WAIT"].includes(value.action)) throw new Error("paper candidate strategy decision action is invalid");
  if (!Number.isFinite(value.score) || value.score < -1 || value.score > 1) throw new Error("paper candidate strategy decision score is invalid");
  assertUnit(value.confidence, "paper candidate strategy decision confidence");
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || value.observedAt > now || !value.reason.trim()) throw new Error("paper candidate strategy decision evidence is invalid");
  return Object.freeze({ action: value.action, score: round4(value.score), confidence: round4(value.confidence), reason: value.reason.trim(), observedAt: value.observedAt });
}

export function decideCio(input: CioDecisionInput): CioDecision {
  if (!input.symbol.trim()) throw new Error("symbol is required");
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  assertUnit(input.currentAllocation, "currentAllocation");
  assertUnit(input.maxAllocation, "maxAllocation");
  if (input.currentAllocation > input.maxAllocation) throw new Error("currentAllocation exceeds maxAllocation");
  if (!Number.isInteger(input.maxLeverage) || input.maxLeverage < 1 || input.maxLeverage > 20) throw new Error("maxLeverage must be an integer between 1 and 20");
  if (input.signals.length === 0) throw new Error("at least one signal is required");

  const candidateBinding = input.paperCandidateBinding == null
    ? undefined
    : validatePaperCandidateExecutionBinding(input.paperCandidateBinding, input.now);
  const candidateStrategyDecision = input.paperCandidateStrategyDecision == null
    ? undefined
    : validateCandidateStrategyDecision(input.paperCandidateStrategyDecision, input.now);
  if (candidateStrategyDecision != null && candidateBinding?.candidateStrategy == null) throw new Error("paper candidate strategy decision requires an immutable candidate strategy binding");
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

  const score = candidateStrategyDecision?.score ?? round4(weightedScore / Math.max(confidenceWeight, Number.EPSILON));
  const confidence = candidateStrategyDecision?.confidence ?? round4(clamp(confidenceWeight / totalWeight, 0, 1));
  if (candidateStrategyDecision != null) reasons.unshift(`PAPER_CANDIDATE:${candidateBinding!.candidateStrategy!.familyId}:${candidateStrategyDecision.reason}`);

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
  } else if (candidateStrategyDecision != null) {
    const strategyAction = candidateStrategyDecision.action;
    if (strategyAction === "BUY" && input.currentAllocation === 0) {
      action = "BUY";
      allocation = round4(clamp(input.currentAllocation + (input.maxAllocation - input.currentAllocation) * confidence, 0, input.maxAllocation));
      leverage = input.risk === "LOW" ? Math.min(2, input.maxLeverage) : 1;
    } else if (strategyAction === "SELL" && input.currentAllocation > 0) {
      action = "SELL";
      allocation = 0;
    } else if (strategyAction === "HOLD" && input.currentAllocation > 0) {
      action = "HOLD";
    } else {
      action = "WAIT";
    }
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
    decidedAt: input.now,
    ...(candidateBinding == null ? {} : { paperCandidateBinding: candidateBinding }),
    ...(candidateStrategyDecision == null ? {} : { paperCandidateStrategyDecision: candidateStrategyDecision })
  });
}
