import { createHash } from "node:crypto";

export interface ChartSignalNormalizationPolicy {
  readonly id: string;
  readonly version: number;
  readonly referenceMove: number;
  readonly deadZone: number;
  readonly maximumScore: number;
}

export const CHART_NORMALIZATION_V1: ChartSignalNormalizationPolicy = Object.freeze({
  id: "CHART_NORMALIZATION_V1",
  version: 1,
  referenceMove: 0.03,
  deadZone: 0.002,
  maximumScore: 1
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function validatePolicy(policy: ChartSignalNormalizationPolicy): void {
  if (!policy.id.trim()) throw new Error("chart normalization policy id is required");
  if (!Number.isSafeInteger(policy.version) || policy.version < 1) throw new Error("chart normalization policy version is invalid");
  if (!Number.isFinite(policy.referenceMove) || policy.referenceMove <= 0) throw new Error("chart normalization reference move must be positive");
  if (!Number.isFinite(policy.deadZone) || policy.deadZone < 0 || policy.deadZone >= policy.referenceMove) throw new Error("chart normalization dead zone is invalid");
  if (!Number.isFinite(policy.maximumScore) || policy.maximumScore <= 0 || policy.maximumScore > 1) throw new Error("chart normalization maximum score is invalid");
}

export function fingerprintChartSignalNormalizationPolicy(policy: ChartSignalNormalizationPolicy): string {
  validatePolicy(policy);
  return createHash("sha256").update(JSON.stringify({
    id: policy.id.trim(),
    version: policy.version,
    referenceMove: policy.referenceMove,
    deadZone: policy.deadZone,
    maximumScore: policy.maximumScore
  }), "utf8").digest("hex");
}

export const CHART_NORMALIZATION_V1_FINGERPRINT = fingerprintChartSignalNormalizationPolicy(CHART_NORMALIZATION_V1);

/**
 * Exchange-agnostic transformation from a raw signed return into the bounded CHART score
 * consumed by NUSA intelligence. Raw exchange facts remain outside this function so the same
 * deterministic policy can be reused by live-public data, PAPER, replay, and research.
 */
export function normalizeChartChangeRate(
  rawChangeRate: number,
  policy: ChartSignalNormalizationPolicy = CHART_NORMALIZATION_V1
): number {
  if (!Number.isFinite(rawChangeRate)) throw new Error("chart change rate must be finite");
  validatePolicy(policy);
  if (Math.abs(rawChangeRate) <= policy.deadZone) return 0;
  return round4(clamp(rawChangeRate / policy.referenceMove, -policy.maximumScore, policy.maximumScore));
}
