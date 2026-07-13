import { createHash } from "node:crypto";
import type { FundingPersistenceBacktestCandle, FundingPersistenceBacktestMetrics } from "./FundingPersistenceBacktest";

export type FundingPersistenceWalkForwardMode = "ROLLING" | "ANCHORED";

export interface FundingPersistenceCandidateResult {
  readonly candidateId: string;
  readonly trainMetrics: FundingPersistenceBacktestMetrics;
  readonly testMetrics: FundingPersistenceBacktestMetrics;
}

export interface FundingPersistenceWalkForwardWindowInput {
  readonly windowId: string;
  readonly trainStartIndex: number;
  readonly trainEndIndexExclusive: number;
  readonly testStartIndex: number;
  readonly testEndIndexExclusive: number;
  readonly candidateResults: readonly FundingPersistenceCandidateResult[];
}

export interface FundingPersistenceWalkForwardPolicy {
  readonly engineVersion: number;
  readonly mode: FundingPersistenceWalkForwardMode;
  readonly minimumTrainCandles: number;
  readonly minimumTestCandles: number;
  readonly selectionMetric: "SHARPE" | "CALMAR" | "TOTAL_RETURN";
  readonly minimumOosSharpe: number;
  readonly maximumOosDrawdown: number;
  readonly minimumPositiveWindowRatio: number;
  readonly maximumCandidateSwitchRatio: number;
}

export interface FundingPersistenceWalkForwardWindowResult {
  readonly windowId: string;
  readonly selectedCandidateId: string;
  readonly trainMetrics: FundingPersistenceBacktestMetrics;
  readonly testMetrics: FundingPersistenceBacktestMetrics;
  readonly trainStartAt: string;
  readonly trainEndAt: string;
  readonly testStartAt: string;
  readonly testEndAt: string;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

export interface FundingPersistenceWalkForwardResult {
  readonly engineVersion: number;
  readonly mode: FundingPersistenceWalkForwardMode;
  readonly market: string;
  readonly generatedAt: string;
  readonly windows: readonly FundingPersistenceWalkForwardWindowResult[];
  readonly aggregate: {
    readonly positiveWindowRatio: number;
    readonly candidateSwitchRatio: number;
    readonly meanOosSharpe: number;
    readonly meanOosReturn: number;
    readonly worstOosDrawdown: number;
    readonly stabilityScore: number;
    readonly passed: boolean;
    readonly reasons: readonly string[];
  };
  readonly resultHash: string;
}

const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return parsed;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const average = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const score = (metrics: FundingPersistenceBacktestMetrics, metric: FundingPersistenceWalkForwardPolicy["selectionMetric"]): number => {
  if (metric === "SHARPE") return metrics.sharpe;
  if (metric === "CALMAR") return metrics.calmar;
  return metrics.totalReturn;
};

const validatePolicy = (policy: FundingPersistenceWalkForwardPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  if (!new Set(["ROLLING", "ANCHORED"]).has(policy.mode)) throw new Error("invalid mode");
  if (!Number.isInteger(policy.minimumTrainCandles) || policy.minimumTrainCandles < 2) throw new Error("minimumTrainCandles must be at least 2");
  if (!Number.isInteger(policy.minimumTestCandles) || policy.minimumTestCandles < 1) throw new Error("minimumTestCandles must be positive");
  if (!new Set(["SHARPE", "CALMAR", "TOTAL_RETURN"]).has(policy.selectionMetric)) throw new Error("invalid selectionMetric");
  if (!Number.isFinite(policy.minimumOosSharpe)) throw new Error("minimumOosSharpe must be finite");
  if (!Number.isFinite(policy.maximumOosDrawdown) || policy.maximumOosDrawdown < 0 || policy.maximumOosDrawdown > 1) throw new Error("maximumOosDrawdown must be between 0 and 1");
  if (!Number.isFinite(policy.minimumPositiveWindowRatio) || policy.minimumPositiveWindowRatio < 0 || policy.minimumPositiveWindowRatio > 1) throw new Error("minimumPositiveWindowRatio must be between 0 and 1");
  if (!Number.isFinite(policy.maximumCandidateSwitchRatio) || policy.maximumCandidateSwitchRatio < 0 || policy.maximumCandidateSwitchRatio > 1) throw new Error("maximumCandidateSwitchRatio must be between 0 and 1");
};

const validateCandles = (candles: readonly FundingPersistenceBacktestCandle[]): string => {
  if (candles.length < 3) throw new Error("at least three candles are required");
  const ids = new Set<string>();
  const market = candles[0]?.market ?? "";
  if (!market.trim()) throw new Error("market is required");
  let previousClose = -Infinity;
  for (const candle of candles) {
    if (ids.has(candle.candleId)) throw new Error(`duplicate candle ${candle.candleId}`);
    ids.add(candle.candleId);
    if (candle.market !== market) throw new Error("candles must have one market");
    const open = parseTime(candle.openTime, `${candle.candleId}.openTime`);
    const close = parseTime(candle.closeTime, `${candle.candleId}.closeTime`);
    if (close <= open) throw new Error("candle closeTime must follow openTime");
    if (open < previousClose) throw new Error("candles must be chronological and non-overlapping");
    previousClose = close;
  }
  return market;
};

const validateWindow = (
  window: FundingPersistenceWalkForwardWindowInput,
  candles: readonly FundingPersistenceBacktestCandle[],
  policy: FundingPersistenceWalkForwardPolicy
): void => {
  if (!window.windowId.trim()) throw new Error("windowId is required");
  for (const [label, value] of Object.entries({
    trainStartIndex: window.trainStartIndex,
    trainEndIndexExclusive: window.trainEndIndexExclusive,
    testStartIndex: window.testStartIndex,
    testEndIndexExclusive: window.testEndIndexExclusive
  })) if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  if (window.trainStartIndex >= window.trainEndIndexExclusive) throw new Error("train range must be non-empty");
  if (window.testStartIndex >= window.testEndIndexExclusive) throw new Error("test range must be non-empty");
  if (window.trainEndIndexExclusive > window.testStartIndex) throw new Error("train and test ranges must not overlap");
  if (window.testEndIndexExclusive > candles.length) throw new Error("window exceeds candle range");
  if (window.trainEndIndexExclusive - window.trainStartIndex < policy.minimumTrainCandles) throw new Error("train window too small");
  if (window.testEndIndexExclusive - window.testStartIndex < policy.minimumTestCandles) throw new Error("test window too small");
  if (window.candidateResults.length === 0) throw new Error("candidateResults cannot be empty");
  const ids = new Set<string>();
  for (const candidate of window.candidateResults) {
    if (!candidate.candidateId.trim()) throw new Error("candidateId is required");
    if (ids.has(candidate.candidateId)) throw new Error(`duplicate candidate ${candidate.candidateId}`);
    ids.add(candidate.candidateId);
  }
};

export const runFundingPersistenceWalkForward = (
  candles: readonly FundingPersistenceBacktestCandle[],
  windows: readonly FundingPersistenceWalkForwardWindowInput[],
  generatedAt: string,
  policy: FundingPersistenceWalkForwardPolicy
): FundingPersistenceWalkForwardResult => {
  validatePolicy(policy);
  parseTime(generatedAt, "generatedAt");
  const market = validateCandles(candles);
  if (windows.length === 0) throw new Error("at least one window is required");
  const windowIds = new Set<string>();
  let previousTrainStart = -1;
  let previousTestEnd = -1;
  const results: FundingPersistenceWalkForwardWindowResult[] = [];

  for (const window of windows) {
    if (windowIds.has(window.windowId)) throw new Error(`duplicate window ${window.windowId}`);
    windowIds.add(window.windowId);
    validateWindow(window, candles, policy);
    if (policy.mode === "ROLLING" && previousTrainStart >= 0 && window.trainStartIndex <= previousTrainStart) throw new Error("rolling trainStartIndex must advance");
    if (policy.mode === "ANCHORED" && previousTrainStart >= 0 && window.trainStartIndex !== previousTrainStart) throw new Error("anchored trainStartIndex must remain fixed");
    if (previousTestEnd >= 0 && window.testStartIndex < previousTestEnd) throw new Error("test windows must not overlap");
    previousTrainStart = window.trainStartIndex;
    previousTestEnd = window.testEndIndexExclusive;

    const selected = [...window.candidateResults].sort((a, b) => score(b.trainMetrics, policy.selectionMetric) - score(a.trainMetrics, policy.selectionMetric) || a.candidateId.localeCompare(b.candidateId))[0];
    if (!selected) throw new Error("candidate selection invariant violated");
    const reasons: string[] = [];
    if (selected.testMetrics.totalReturn <= 0) reasons.push("OOS_RETURN_NON_POSITIVE");
    if (selected.testMetrics.sharpe < policy.minimumOosSharpe) reasons.push("OOS_SHARPE_BELOW_MINIMUM");
    if (selected.testMetrics.maximumDrawdown > policy.maximumOosDrawdown) reasons.push("OOS_DRAWDOWN_ABOVE_MAXIMUM");

    const trainStart = candles[window.trainStartIndex];
    const trainEnd = candles[window.trainEndIndexExclusive - 1];
    const testStart = candles[window.testStartIndex];
    const testEnd = candles[window.testEndIndexExclusive - 1];
    if (!trainStart || !trainEnd || !testStart || !testEnd) throw new Error("window candle invariant violated");

    results.push(Object.freeze({
      windowId: window.windowId,
      selectedCandidateId: selected.candidateId,
      trainMetrics: selected.trainMetrics,
      testMetrics: selected.testMetrics,
      trainStartAt: trainStart.openTime,
      trainEndAt: trainEnd.closeTime,
      testStartAt: testStart.openTime,
      testEndAt: testEnd.closeTime,
      passed: reasons.length === 0,
      reasons: Object.freeze(reasons)
    }));
  }

  const positiveWindowRatio = results.filter((r) => r.testMetrics.totalReturn > 0).length / results.length;
  let switches = 0;
  for (let i = 1; i < results.length; i += 1) if (results[i]?.selectedCandidateId !== results[i - 1]?.selectedCandidateId) switches += 1;
  const candidateSwitchRatio = results.length <= 1 ? 0 : switches / (results.length - 1);
  const meanOosSharpe = average(results.map((r) => r.testMetrics.sharpe));
  const meanOosReturn = average(results.map((r) => r.testMetrics.totalReturn));
  const worstOosDrawdown = Math.max(...results.map((r) => r.testMetrics.maximumDrawdown));
  const stabilityScore = Math.max(0, Math.min(1,
    0.4 * positiveWindowRatio
    + 0.3 * (1 - candidateSwitchRatio)
    + 0.2 * Math.max(0, Math.min(1, (meanOosSharpe + 1) / 3))
    + 0.1 * Math.max(0, 1 - worstOosDrawdown / Math.max(policy.maximumOosDrawdown, 1e-9))
  ));

  const aggregateReasons: string[] = [];
  if (positiveWindowRatio < policy.minimumPositiveWindowRatio) aggregateReasons.push("POSITIVE_WINDOW_RATIO_BELOW_MINIMUM");
  if (candidateSwitchRatio > policy.maximumCandidateSwitchRatio) aggregateReasons.push("CANDIDATE_SWITCH_RATIO_ABOVE_MAXIMUM");
  if (meanOosSharpe < policy.minimumOosSharpe) aggregateReasons.push("MEAN_OOS_SHARPE_BELOW_MINIMUM");
  if (worstOosDrawdown > policy.maximumOosDrawdown) aggregateReasons.push("WORST_OOS_DRAWDOWN_ABOVE_MAXIMUM");
  if (results.some((r) => !r.passed)) aggregateReasons.push("ONE_OR_MORE_WINDOWS_FAILED");

  const frozenWindows = Object.freeze(results);
  const aggregate = Object.freeze({
    positiveWindowRatio: round(positiveWindowRatio),
    candidateSwitchRatio: round(candidateSwitchRatio),
    meanOosSharpe: round(meanOosSharpe),
    meanOosReturn: round(meanOosReturn),
    worstOosDrawdown: round(worstOosDrawdown),
    stabilityScore: round(stabilityScore),
    passed: aggregateReasons.length === 0,
    reasons: Object.freeze(aggregateReasons)
  });
  const payload = { engineVersion: policy.engineVersion, mode: policy.mode, market, generatedAt, windows: frozenWindows, aggregate };
  return Object.freeze({ ...payload, resultHash: hash(payload) });
};