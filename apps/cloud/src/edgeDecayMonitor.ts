export type EdgeDecayStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";
export type EdgeDecayAction = "MAINTAIN" | "OBSERVE" | "REDUCE_CAPITAL" | "SUSPEND";

export interface EdgePerformanceWindow {
  readonly windowId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly sampleSize: number;
  readonly sharpe: number;
  readonly winRate: number;
  readonly expectedCalibrationError: number;
  readonly profitFactor: number;
  readonly maximumDrawdown: number;
  readonly averageSlippageBps: number;
  readonly capacityUsd: number;
}

export interface EdgeDecayPolicy {
  readonly policyVersion: string;
  readonly minimumRecentSamples: number;
  readonly yellowScore: number;
  readonly orangeScore: number;
  readonly redScore: number;
  readonly metricWeights: Readonly<{
    sharpe: number;
    winRate: number;
    calibration: number;
    profitFactor: number;
    drawdown: number;
    slippage: number;
    capacity: number;
  }>;
}

export interface EdgeDecayInput {
  readonly edgeId: string;
  readonly edgeVersion: string;
  readonly generatedAt: string;
  readonly baseline: EdgePerformanceWindow;
  readonly recent: EdgePerformanceWindow;
}

export interface EdgeDecayMetric {
  readonly metric: "SHARPE" | "WIN_RATE" | "CALIBRATION" | "PROFIT_FACTOR" | "DRAWDOWN" | "SLIPPAGE" | "CAPACITY";
  readonly baseline: number;
  readonly recent: number;
  readonly deterioration: number;
  readonly weightedContribution: number;
}

export interface EdgeDecayResult {
  readonly edgeId: string;
  readonly edgeVersion: string;
  readonly status: EdgeDecayStatus;
  readonly action: EdgeDecayAction;
  readonly decayScore: number;
  readonly confidence: number;
  readonly metrics: readonly EdgeDecayMetric[];
  readonly reasons: readonly string[];
  readonly policyVersion: string;
  readonly generatedAt: string;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const nonNegative = (value: number, label: string): void => {
  finite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
};

const validateWindow = (window: EdgePerformanceWindow, label: string): void => {
  if (!window.windowId.trim()) throw new Error(`${label}.windowId is required`);
  const start = parseTime(window.startAt, `${label}.startAt`);
  const end = parseTime(window.endAt, `${label}.endAt`);
  if (end <= start) throw new Error(`${label} endAt must be after startAt`);
  if (!Number.isInteger(window.sampleSize) || window.sampleSize < 1) throw new Error(`${label}.sampleSize must be a positive integer`);
  finite(window.sharpe, `${label}.sharpe`);
  if (window.winRate < 0 || window.winRate > 1) throw new Error(`${label}.winRate must be between 0 and 1`);
  if (window.expectedCalibrationError < 0 || window.expectedCalibrationError > 1) throw new Error(`${label}.expectedCalibrationError must be between 0 and 1`);
  nonNegative(window.profitFactor, `${label}.profitFactor`);
  if (window.maximumDrawdown < 0 || window.maximumDrawdown > 1) throw new Error(`${label}.maximumDrawdown must be between 0 and 1`);
  nonNegative(window.averageSlippageBps, `${label}.averageSlippageBps`);
  nonNegative(window.capacityUsd, `${label}.capacityUsd`);
};

const validatePolicy = (policy: EdgeDecayPolicy): void => {
  if (!policy.policyVersion.trim()) throw new Error("policyVersion is required");
  if (!Number.isInteger(policy.minimumRecentSamples) || policy.minimumRecentSamples < 1) throw new Error("minimumRecentSamples must be a positive integer");
  for (const [name, threshold] of [["yellowScore", policy.yellowScore], ["orangeScore", policy.orangeScore], ["redScore", policy.redScore]] as const) {
    if (threshold < 0 || threshold > 1) throw new Error(`${name} must be between 0 and 1`);
  }
  if (!(policy.yellowScore < policy.orangeScore && policy.orangeScore < policy.redScore)) throw new Error("decay thresholds must be strictly increasing");
  const weights = Object.values(policy.metricWeights);
  for (const weight of weights) nonNegative(weight, "metric weight");
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) throw new Error("metric weights must have a positive total");
};

const lowerIsWorse = (baseline: number, recent: number): number => {
  if (baseline <= 0) return recent < baseline ? 1 : 0;
  return clamp01((baseline - recent) / Math.abs(baseline));
};

const higherIsWorse = (baseline: number, recent: number): number => {
  const denominator = Math.max(Math.abs(baseline), 1e-9);
  return clamp01((recent - baseline) / denominator);
};

const freezeResult = (result: EdgeDecayResult): EdgeDecayResult => {
  for (const metric of result.metrics) Object.freeze(metric);
  Object.freeze(result.metrics);
  Object.freeze(result.reasons);
  return Object.freeze(result);
};

export const evaluateEdgeDecay = (input: EdgeDecayInput, policy: EdgeDecayPolicy): EdgeDecayResult => {
  if (!input.edgeId.trim()) throw new Error("edgeId is required");
  if (!input.edgeVersion.trim()) throw new Error("edgeVersion is required");
  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  validateWindow(input.baseline, "baseline");
  validateWindow(input.recent, "recent");
  validatePolicy(policy);
  if (parseTime(input.baseline.endAt, "baseline.endAt") > generatedAt || parseTime(input.recent.endAt, "recent.endAt") > generatedAt) {
    throw new Error("performance windows cannot end in the future");
  }
  if (input.baseline.windowId === input.recent.windowId) throw new Error("baseline and recent windows must be distinct");

  const rawMetrics = [
    ["SHARPE", input.baseline.sharpe, input.recent.sharpe, lowerIsWorse(input.baseline.sharpe, input.recent.sharpe), policy.metricWeights.sharpe],
    ["WIN_RATE", input.baseline.winRate, input.recent.winRate, lowerIsWorse(input.baseline.winRate, input.recent.winRate), policy.metricWeights.winRate],
    ["CALIBRATION", input.baseline.expectedCalibrationError, input.recent.expectedCalibrationError, higherIsWorse(input.baseline.expectedCalibrationError, input.recent.expectedCalibrationError), policy.metricWeights.calibration],
    ["PROFIT_FACTOR", input.baseline.profitFactor, input.recent.profitFactor, lowerIsWorse(input.baseline.profitFactor, input.recent.profitFactor), policy.metricWeights.profitFactor],
    ["DRAWDOWN", input.baseline.maximumDrawdown, input.recent.maximumDrawdown, higherIsWorse(input.baseline.maximumDrawdown, input.recent.maximumDrawdown), policy.metricWeights.drawdown],
    ["SLIPPAGE", input.baseline.averageSlippageBps, input.recent.averageSlippageBps, higherIsWorse(input.baseline.averageSlippageBps, input.recent.averageSlippageBps), policy.metricWeights.slippage],
    ["CAPACITY", input.baseline.capacityUsd, input.recent.capacityUsd, lowerIsWorse(input.baseline.capacityUsd, input.recent.capacityUsd), policy.metricWeights.capacity]
  ] as const;

  const totalWeight = Object.values(policy.metricWeights).reduce((sum, weight) => sum + weight, 0);
  const metrics: EdgeDecayMetric[] = rawMetrics.map(([metric, baseline, recent, deterioration, weight]) => ({
    metric,
    baseline: round(baseline),
    recent: round(recent),
    deterioration: round(deterioration),
    weightedContribution: round((deterioration * weight) / totalWeight)
  }));

  const decayScore = round(metrics.reduce((sum, metric) => sum + metric.weightedContribution, 0));
  const confidence = round(clamp01(input.recent.sampleSize / policy.minimumRecentSamples));

  const reasons: string[] = [];
  if (input.recent.sampleSize < policy.minimumRecentSamples) reasons.push("INSUFFICIENT_RECENT_SAMPLES");
  for (const metric of metrics) if (metric.deterioration >= 0.25) reasons.push(`${metric.metric}_DETERIORATED`);

  let status: EdgeDecayStatus = "GREEN";
  let action: EdgeDecayAction = "MAINTAIN";
  if (decayScore >= policy.redScore) { status = "RED"; action = "SUSPEND"; }
  else if (decayScore >= policy.orangeScore) { status = "ORANGE"; action = "REDUCE_CAPITAL"; }
  else if (decayScore >= policy.yellowScore || confidence < 1) { status = "YELLOW"; action = "OBSERVE"; }

  return freezeResult({
    edgeId: input.edgeId,
    edgeVersion: input.edgeVersion,
    status,
    action,
    decayScore,
    confidence,
    metrics: Object.freeze(metrics),
    reasons: Object.freeze(reasons),
    policyVersion: policy.policyVersion,
    generatedAt: input.generatedAt
  });
};
