import { createHash } from "node:crypto";

export type OrderbookImbalanceWalkForwardMode = "ROLLING" | "ANCHORED";

export interface OrderbookImbalanceWalkForwardCandidate {
  readonly candidateId: string;
  readonly parameterHash: string;
  readonly trainReturn: number;
  readonly trainSharpe: number;
  readonly trainMaxDrawdown: number;
  readonly oosReturn: number;
  readonly oosSharpe: number;
  readonly oosMaxDrawdown: number;
  readonly oosTradeCount: number;
}

export interface OrderbookImbalanceWalkForwardWindow {
  readonly windowId: string;
  readonly trainStart: string;
  readonly trainEnd: string;
  readonly testStart: string;
  readonly testEnd: string;
  readonly candidates: readonly OrderbookImbalanceWalkForwardCandidate[];
}

export interface OrderbookImbalanceWalkForwardPolicy {
  readonly engineVersion: number;
  readonly mode: OrderbookImbalanceWalkForwardMode;
  readonly minimumTrainSharpe: number;
  readonly maximumTrainDrawdown: number;
  readonly minimumOosTradeCount: number;
  readonly minimumPositiveWindowRatio: number;
  readonly minimumMeanOosSharpe: number;
  readonly maximumWorstOosDrawdown: number;
  readonly trainSharpeWeight: number;
  readonly trainReturnWeight: number;
  readonly trainDrawdownPenaltyWeight: number;
}

export interface OrderbookImbalanceWalkForwardWindowResult {
  readonly windowId: string;
  readonly selectedCandidateId: string;
  readonly selectedParameterHash: string;
  readonly trainScore: number;
  readonly trainReturn: number;
  readonly trainSharpe: number;
  readonly trainMaxDrawdown: number;
  readonly oosReturn: number;
  readonly oosSharpe: number;
  readonly oosMaxDrawdown: number;
  readonly oosTradeCount: number;
  readonly passedOosTradeGate: boolean;
}

export interface OrderbookImbalanceWalkForwardAggregate {
  readonly windowCount: number;
  readonly positiveWindowRatio: number;
  readonly meanOosReturn: number;
  readonly meanOosSharpe: number;
  readonly worstOosDrawdown: number;
  readonly candidateSwitchRatio: number;
  readonly parameterDriftRatio: number;
  readonly stabilityScore: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

export interface OrderbookImbalanceWalkForwardResult {
  readonly engineVersion: number;
  readonly mode: OrderbookImbalanceWalkForwardMode;
  readonly generatedAt: string;
  readonly windows: readonly OrderbookImbalanceWalkForwardWindowResult[];
  readonly aggregate: OrderbookImbalanceWalkForwardAggregate;
  readonly resultHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => { if (!Number.isFinite(value)) throw new Error(`${label} must be finite`); };
const parseTime = (value: string, label: string): number => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`); return parsed; };
const average = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const validatePolicy = (policy: OrderbookImbalanceWalkForwardPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  if (policy.mode !== "ROLLING" && policy.mode !== "ANCHORED") throw new Error("mode must be ROLLING or ANCHORED");
  for (const [label, value] of Object.entries(policy)) if (typeof value === "number") finite(value, label);
  if (policy.maximumTrainDrawdown < 0 || policy.maximumTrainDrawdown > 1) throw new Error("maximumTrainDrawdown must be between 0 and 1");
  if (!Number.isInteger(policy.minimumOosTradeCount) || policy.minimumOosTradeCount < 0) throw new Error("minimumOosTradeCount must be non-negative");
  if (policy.minimumPositiveWindowRatio < 0 || policy.minimumPositiveWindowRatio > 1) throw new Error("minimumPositiveWindowRatio must be between 0 and 1");
  if (policy.maximumWorstOosDrawdown < 0 || policy.maximumWorstOosDrawdown > 1) throw new Error("maximumWorstOosDrawdown must be between 0 and 1");
  if (policy.trainSharpeWeight < 0 || policy.trainReturnWeight < 0 || policy.trainDrawdownPenaltyWeight < 0) throw new Error("selection weights must be non-negative");
  if (policy.trainSharpeWeight + policy.trainReturnWeight + policy.trainDrawdownPenaltyWeight <= 0) throw new Error("at least one selection weight must be positive");
};

const validateWindows = (windows: readonly OrderbookImbalanceWalkForwardWindow[], mode: OrderbookImbalanceWalkForwardMode): void => {
  if (windows.length === 0) throw new Error("at least one window is required");
  const ids = new Set<string>();
  let anchoredTrainStart: number | null = null;
  let previousTestEnd = -Infinity;
  let previousTrainStart = -Infinity;
  for (const window of windows) {
    if (!window.windowId.trim()) throw new Error("windowId is required");
    if (ids.has(window.windowId)) throw new Error(`duplicate window ${window.windowId}`);
    ids.add(window.windowId);
    const trainStart = parseTime(window.trainStart, `${window.windowId}.trainStart`);
    const trainEnd = parseTime(window.trainEnd, `${window.windowId}.trainEnd`);
    const testStart = parseTime(window.testStart, `${window.windowId}.testStart`);
    const testEnd = parseTime(window.testEnd, `${window.windowId}.testEnd`);
    if (!(trainStart < trainEnd && trainEnd < testStart && testStart < testEnd)) throw new Error("train and test ranges must be ordered and non-overlapping");
    if (testStart < previousTestEnd) throw new Error("OOS windows must not overlap");
    if (mode === "ANCHORED") {
      anchoredTrainStart ??= trainStart;
      if (trainStart !== anchoredTrainStart) throw new Error("ANCHORED windows must share trainStart");
    } else if (trainStart <= previousTrainStart) {
      throw new Error("ROLLING trainStart must advance");
    }
    previousTrainStart = trainStart;
    previousTestEnd = testEnd;
    if (window.candidates.length === 0) throw new Error(`window ${window.windowId} requires candidates`);
    const candidateIds = new Set<string>();
    for (const candidate of window.candidates) {
      if (!candidate.candidateId.trim()) throw new Error("candidateId is required");
      if (candidateIds.has(candidate.candidateId)) throw new Error(`duplicate candidate ${candidate.candidateId}`);
      candidateIds.add(candidate.candidateId);
      if (!SHA256.test(candidate.parameterHash)) throw new Error("parameterHash must be SHA-256");
      for (const [label, value] of Object.entries(candidate)) if (typeof value === "number") finite(value, `${window.windowId}.${candidate.candidateId}.${label}`);
      if (candidate.trainMaxDrawdown < 0 || candidate.trainMaxDrawdown > 1 || candidate.oosMaxDrawdown < 0 || candidate.oosMaxDrawdown > 1) throw new Error("drawdowns must be between 0 and 1");
      if (!Number.isInteger(candidate.oosTradeCount) || candidate.oosTradeCount < 0) throw new Error("oosTradeCount must be non-negative");
    }
  }
};

export const runOrderbookImbalanceWalkForward = (
  windows: readonly OrderbookImbalanceWalkForwardWindow[],
  generatedAt: string,
  policy: OrderbookImbalanceWalkForwardPolicy
): OrderbookImbalanceWalkForwardResult => {
  validatePolicy(policy);
  validateWindows(windows, policy.mode);
  parseTime(generatedAt, "generatedAt");

  const results: OrderbookImbalanceWalkForwardWindowResult[] = windows.map((window) => {
    const eligible = window.candidates.filter((candidate) => candidate.trainSharpe >= policy.minimumTrainSharpe && candidate.trainMaxDrawdown <= policy.maximumTrainDrawdown);
    if (eligible.length === 0) throw new Error(`window ${window.windowId} has no train-eligible candidate`);
    const ranked = eligible.map((candidate) => ({
      candidate,
      score: candidate.trainSharpe * policy.trainSharpeWeight + candidate.trainReturn * policy.trainReturnWeight - candidate.trainMaxDrawdown * policy.trainDrawdownPenaltyWeight
    })).sort((left, right) => right.score - left.score || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
    const selected = ranked[0];
    if (!selected) throw new Error("selected candidate missing");
    const candidate = selected.candidate;
    return Object.freeze({
      windowId: window.windowId,
      selectedCandidateId: candidate.candidateId,
      selectedParameterHash: candidate.parameterHash,
      trainScore: round(selected.score),
      trainReturn: round(candidate.trainReturn),
      trainSharpe: round(candidate.trainSharpe),
      trainMaxDrawdown: round(candidate.trainMaxDrawdown),
      oosReturn: round(candidate.oosReturn),
      oosSharpe: round(candidate.oosSharpe),
      oosMaxDrawdown: round(candidate.oosMaxDrawdown),
      oosTradeCount: candidate.oosTradeCount,
      passedOosTradeGate: candidate.oosTradeCount >= policy.minimumOosTradeCount
    });
  });

  const positiveWindowRatio = results.filter((item) => item.oosReturn > 0 && item.passedOosTradeGate).length / results.length;
  const meanOosReturn = average(results.map((item) => item.oosReturn));
  const meanOosSharpe = average(results.map((item) => item.oosSharpe));
  const worstOosDrawdown = Math.max(...results.map((item) => item.oosMaxDrawdown));
  let candidateSwitches = 0;
  let parameterDrifts = 0;
  for (let index = 1; index < results.length; index += 1) {
    if (results[index]?.selectedCandidateId !== results[index - 1]?.selectedCandidateId) candidateSwitches += 1;
    if (results[index]?.selectedParameterHash !== results[index - 1]?.selectedParameterHash) parameterDrifts += 1;
  }
  const transitions = Math.max(1, results.length - 1);
  const candidateSwitchRatio = results.length < 2 ? 0 : candidateSwitches / transitions;
  const parameterDriftRatio = results.length < 2 ? 0 : parameterDrifts / transitions;
  const stabilityScore = Math.max(0, Math.min(1, positiveWindowRatio * 0.5 + (1 - candidateSwitchRatio) * 0.25 + (1 - parameterDriftRatio) * 0.25));
  const reasons: string[] = [];
  if (positiveWindowRatio < policy.minimumPositiveWindowRatio) reasons.push("POSITIVE_WINDOW_RATIO_LOW");
  if (meanOosSharpe < policy.minimumMeanOosSharpe) reasons.push("MEAN_OOS_SHARPE_LOW");
  if (worstOosDrawdown > policy.maximumWorstOosDrawdown) reasons.push("WORST_OOS_DRAWDOWN_HIGH");
  if (results.some((item) => !item.passedOosTradeGate)) reasons.push("OOS_TRADE_COUNT_LOW");
  if (reasons.length === 0) reasons.push("WALK_FORWARD_POLICY_PASSED");
  const aggregate: OrderbookImbalanceWalkForwardAggregate = Object.freeze({
    windowCount: results.length,
    positiveWindowRatio: round(positiveWindowRatio),
    meanOosReturn: round(meanOosReturn),
    meanOosSharpe: round(meanOosSharpe),
    worstOosDrawdown: round(worstOosDrawdown),
    candidateSwitchRatio: round(candidateSwitchRatio),
    parameterDriftRatio: round(parameterDriftRatio),
    stabilityScore: round(stabilityScore),
    passed: reasons.length === 1 && reasons[0] === "WALK_FORWARD_POLICY_PASSED",
    reasons: Object.freeze(reasons)
  });
  const payload = { engineVersion: policy.engineVersion, mode: policy.mode, generatedAt, windows: Object.freeze(results), aggregate };
  return Object.freeze({ ...payload, resultHash: hash(payload) });
};
