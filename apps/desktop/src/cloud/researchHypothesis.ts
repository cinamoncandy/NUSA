import { createHash } from "node:crypto";
import type { HistoricalDatasetManifest } from "./researchDataset";

export type ResearchHypothesisDirection = "LONG" | "SHORT" | "NEUTRAL";

export interface ResearchHypothesis {
  readonly schemaVersion: 1;
  readonly hypothesisId: string;
  readonly familyId: string;
  readonly market: string;
  readonly interval: HistoricalDatasetManifest["interval"];
  readonly direction: ResearchHypothesisDirection;
  readonly thesis: string;
  readonly sourceDatasetId: string;
  readonly sourceObservationAsOf: number;
  readonly generatedAt: string;
}

export interface ResearchHypothesisDecision {
  readonly status: "VERIFIED" | "REJECTED";
  readonly reasons: readonly string[];
  readonly hypothesisHash: string;
}

export interface ResearchHypothesisBinding {
  readonly hypothesisId: string;
  readonly familyId: string;
  readonly market: string;
  readonly interval: HistoricalDatasetManifest["interval"];
  readonly sourceDatasetId: string;
  readonly evaluationGeneratedAt: string;
}

export class ResearchHypothesisError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchHypothesisError";
  }
}

const INTERVALS: readonly HistoricalDatasetManifest["interval"][] = [
  "1m", "3m", "5m", "10m", "15m", "30m", "60m", "240m", "1d",
];
const DIRECTIONS: readonly ResearchHypothesisDirection[] = ["LONG", "SHORT", "NEUTRAL"];
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTimestamp(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

function canonicalHypothesis(hypothesis: ResearchHypothesis): Record<string, unknown> {
  return {
    schemaVersion: hypothesis.schemaVersion,
    hypothesisId: hypothesis.hypothesisId.trim(),
    familyId: hypothesis.familyId.trim(),
    market: hypothesis.market.trim(),
    interval: hypothesis.interval,
    direction: hypothesis.direction,
    thesis: hypothesis.thesis.trim(),
    sourceDatasetId: hypothesis.sourceDatasetId.trim(),
    sourceObservationAsOf: hypothesis.sourceObservationAsOf,
    generatedAt: hypothesis.generatedAt,
  };
}

function hashHypothesis(hypothesis: ResearchHypothesis): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalHypothesis(hypothesis)), "utf8")
    .digest("hex");
}

function rejectionHash(reasons: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ invalidResearchHypothesis: true, reasons }), "utf8")
    .digest("hex");
}

export function validateResearchHypothesis(
  hypothesis: ResearchHypothesis,
  options: { readonly nowMs?: number } = {},
): ResearchHypothesisDecision {
  const reasons: string[] = [];
  if (hypothesis == null || typeof hypothesis !== "object") {
    return freeze({
      status: "REJECTED",
      reasons: Object.freeze(["INVALID_HYPOTHESIS"]),
      hypothesisHash: rejectionHash(["INVALID_HYPOTHESIS"]),
    });
  }
  if (hypothesis.schemaVersion !== 1) reasons.push("UNSUPPORTED_SCHEMA_VERSION");
  if (!nonEmpty(hypothesis.hypothesisId)) reasons.push("MISSING_HYPOTHESIS_ID");
  if (!nonEmpty(hypothesis.familyId)) reasons.push("MISSING_FAMILY_ID");
  if (!nonEmpty(hypothesis.market)) reasons.push("MISSING_MARKET");
  if (!INTERVALS.includes(hypothesis.interval)) reasons.push("INVALID_INTERVAL");
  if (!DIRECTIONS.includes(hypothesis.direction)) reasons.push("INVALID_DIRECTION");
  if (!nonEmpty(hypothesis.thesis)) reasons.push("MISSING_THESIS");
  if (!nonEmpty(hypothesis.sourceDatasetId)) reasons.push("MISSING_SOURCE_DATASET_ID");
  if (!Number.isSafeInteger(hypothesis.sourceObservationAsOf) || hypothesis.sourceObservationAsOf < 0) {
    reasons.push("INVALID_SOURCE_OBSERVATION_AS_OF");
  }

  const generatedAtMs = parseTimestamp(hypothesis.generatedAt);
  if (!Number.isFinite(generatedAtMs)) reasons.push("INVALID_GENERATED_AT");
  if (
    Number.isFinite(generatedAtMs)
    && Number.isSafeInteger(hypothesis.sourceObservationAsOf)
    && generatedAtMs <= hypothesis.sourceObservationAsOf
  ) {
    reasons.push("HYPOTHESIS_NOT_AFTER_SOURCE_OBSERVATION");
  }

  if (options.nowMs != null) {
    if (!Number.isFinite(options.nowMs) || options.nowMs < 0) reasons.push("INVALID_CURRENT_TIME");
    else if (Number.isFinite(generatedAtMs) && generatedAtMs > options.nowMs) reasons.push("FUTURE_HYPOTHESIS");
  }

  const normalizedReasons = Object.freeze([...new Set(reasons)].sort());
  let hypothesisHash: string;
  try {
    hypothesisHash = hashHypothesis(hypothesis);
  } catch {
    hypothesisHash = rejectionHash(normalizedReasons);
  }
  return freeze({
    status: normalizedReasons.length === 0 ? "VERIFIED" : "REJECTED",
    reasons: normalizedReasons,
    hypothesisHash,
  });
}

export function buildResearchHypothesis(input: {
  readonly hypothesisId: string;
  readonly familyId: string;
  readonly market: string;
  readonly interval: HistoricalDatasetManifest["interval"];
  readonly direction: ResearchHypothesisDirection;
  readonly thesis: string;
  readonly sourceDatasetId: string;
  readonly sourceObservationAsOf: number;
  readonly generatedAt: string;
}): ResearchHypothesis {
  const hypothesis: ResearchHypothesis = {
    schemaVersion: 1,
    hypothesisId: input.hypothesisId.trim(),
    familyId: input.familyId.trim(),
    market: input.market.trim(),
    interval: input.interval,
    direction: input.direction,
    thesis: input.thesis.trim(),
    sourceDatasetId: input.sourceDatasetId.trim(),
    sourceObservationAsOf: input.sourceObservationAsOf,
    generatedAt: input.generatedAt,
  };
  const decision = validateResearchHypothesis(hypothesis, { nowMs: parseTimestamp(hypothesis.generatedAt) });
  if (decision.status !== "VERIFIED") {
    throw new ResearchHypothesisError(
      decision.reasons[0] ?? "INVALID_HYPOTHESIS",
      `research hypothesis is invalid: ${decision.reasons.join(",")}`,
    );
  }
  return freeze(hypothesis);
}

export function validateResearchHypothesisBinding(
  hypothesis: ResearchHypothesis,
  expected: ResearchHypothesisBinding,
): ResearchHypothesisDecision {
  const evaluationGeneratedAtMs = parseTimestamp(expected.evaluationGeneratedAt);
  const base = validateResearchHypothesis(hypothesis, {
    nowMs: Number.isFinite(evaluationGeneratedAtMs) ? evaluationGeneratedAtMs : undefined,
  });
  const reasons = [...base.reasons];
  if (!nonEmpty(expected.hypothesisId)) reasons.push("MISSING_EXPECTED_HYPOTHESIS_ID");
  if (!nonEmpty(expected.familyId)) reasons.push("MISSING_EXPECTED_FAMILY_ID");
  if (!nonEmpty(expected.market)) reasons.push("MISSING_EXPECTED_MARKET");
  if (!INTERVALS.includes(expected.interval)) reasons.push("INVALID_EXPECTED_INTERVAL");
  if (!nonEmpty(expected.sourceDatasetId)) reasons.push("MISSING_EXPECTED_SOURCE_DATASET_ID");
  if (!Number.isFinite(evaluationGeneratedAtMs)) reasons.push("INVALID_EXPECTED_EVALUATION_GENERATED_AT");
  if (hypothesis.hypothesisId !== expected.hypothesisId) reasons.push("HYPOTHESIS_ID_MISMATCH");
  if (hypothesis.familyId !== expected.familyId) reasons.push("HYPOTHESIS_FAMILY_MISMATCH");
  if (hypothesis.market !== expected.market) reasons.push("HYPOTHESIS_MARKET_MISMATCH");
  if (hypothesis.interval !== expected.interval) reasons.push("HYPOTHESIS_INTERVAL_MISMATCH");
  if (hypothesis.sourceDatasetId !== expected.sourceDatasetId) reasons.push("HYPOTHESIS_DATASET_MISMATCH");

  const normalizedReasons = Object.freeze([...new Set(reasons)].sort());
  return freeze({
    status: normalizedReasons.length === 0 ? "VERIFIED" : "REJECTED",
    reasons: normalizedReasons,
    hypothesisHash: base.hypothesisHash,
  });
}
