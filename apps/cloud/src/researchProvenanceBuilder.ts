import { createHash } from "node:crypto";
import type { BacktestCandle } from "../../../packages/core/src/optimizer/aiBacktestEngine";
import { researchHardeningHash, validateResearchProvenance, validateResearchTemporalIntegrity, type ResearchProvenance } from "../../../packages/contracts/src/researchHardening";
import { canonicalResearchJson, type ResearchInputSnapshot } from "../../../packages/contracts/src/researchRuntime";
import { candleChecksum } from "./closedCandleAggregator";

/**
 * Builds a `ResearchProvenance` from real inputs only (see docs/DESIGN_RESEARCH_EXPERIMENT_PROVENANCE.md).
 * Every hash is recomputed here from the data it describes; nothing is copied from the caller and no field
 * is ever filled with a placeholder. Any problem throws `ResearchProvenanceError` with a stable code and no
 * provenance is produced.
 *
 * D2: `canonicalInputHash` is the SHA-256 of the experiment input WITHOUT its `provenance` key (see
 * `hashResearchInputCore`), which avoids the circular reference with the coordinator's whole-input hash.
 */
export class ResearchProvenanceError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchProvenanceError";
  }
}

export type ProvenanceRole = "TRAIN" | "VALIDATION" | "HOLDOUT";

export interface ProvenanceWindow {
  readonly windowId: string;
  /** Closed candles stamped at CLOSE time (closedCandleAggregator), oldest first. */
  readonly candles: readonly BacktestCandle[];
}

export interface ResearchProvenanceInput {
  readonly role: ProvenanceRole;
  readonly researchRunId: string;
  readonly sessionId: string;
  readonly experimentId: string;
  readonly evaluationId: string;
  readonly hypothesisId?: string;
  readonly market: string;
  readonly intervalMs: number;
  readonly windows: { readonly train: ProvenanceWindow; readonly validation: ProvenanceWindow; readonly holdout: ProvenanceWindow };
  readonly featurePipeline: { readonly version: string; readonly config: Readonly<Record<string, unknown>> };
  readonly strategy: { readonly id: string; readonly version: string; readonly artifact: unknown; readonly config: unknown };
  readonly evaluator: { readonly version: string; readonly modelVersion: string };
  readonly models: { readonly fill: string; readonly fee: string; readonly slippage: string };
  readonly sourceCommitSha: string;
  readonly split: { readonly identity: string; readonly definition: unknown };
  readonly walkForwardConfig: unknown;
  readonly experimentFamilyId: string;
  readonly attempt: number;
  readonly hypothesisLineage: string;
  /** True only while the holdout window has never been evaluated for this strategy configuration. */
  readonly finalHoldoutUntouched: boolean;
  /** Hash of the input without provenance, from `hashResearchInputCore`. */
  readonly canonicalInputHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const sha = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const fail = (code: string, message: string): never => { throw new ResearchProvenanceError(code, message); };

export function hashResearchInputCore(input: ResearchInputSnapshot): string {
  const { provenance: _provenance, ...core } = input as ResearchInputSnapshot & { provenance?: unknown };
  void _provenance;
  return sha(core);
}

function checkWindow(name: string, window: ProvenanceWindow, intervalMs: number): { readonly first: number; readonly last: number } {
  if (!text(window.windowId)) fail("INVALID_WINDOW_ID", `${name} window id is required`);
  if (!Array.isArray(window.candles) || window.candles.length === 0) fail("EMPTY_WINDOW", `${name} window has no candles`);
  let previous = 0;
  for (const candle of window.candles) {
    if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= 0 || candle.timestamp % intervalMs !== 0) fail("INVALID_CANDLE_TIME", `${name} window has a candle time that is not a positive multiple of the interval`);
    if (candle.timestamp <= previous) fail("NON_MONOTONIC_WINDOW", `${name} window candles are not strictly increasing`);
    previous = candle.timestamp;
  }
  return { first: window.candles[0]!.timestamp, last: previous };
}

export function buildResearchProvenance(input: ResearchProvenanceInput): ResearchProvenance {
  if (!MARKET.test(input.market)) fail("INVALID_MARKET", "market must be a KRW market");
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1_000 || input.intervalMs > 86_400_000) fail("INVALID_INTERVAL", "interval is invalid");
  if (typeof input.sourceCommitSha !== "string" || !SHA1.test(input.sourceCommitSha)) fail("INVALID_SOURCE_COMMIT", "source commit must be a 40-character lowercase hex SHA");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) fail("INVALID_ATTEMPT", "attempt must be a positive integer");
  if (!SHA256.test(input.canonicalInputHash)) fail("INVALID_CANONICAL_INPUT_HASH", "canonical input hash must be a SHA-256");
  for (const [name, value] of Object.entries({
    researchRunId: input.researchRunId, sessionId: input.sessionId, experimentId: input.experimentId, evaluationId: input.evaluationId,
    featurePipelineVersion: input.featurePipeline.version, strategyId: input.strategy.id, strategyVersion: input.strategy.version,
    evaluatorVersion: input.evaluator.version, modelVersion: input.evaluator.modelVersion,
    fillModelVersion: input.models.fill, feeModelVersion: input.models.fee, slippageModelVersion: input.models.slippage,
    splitIdentity: input.split.identity, experimentFamilyId: input.experimentFamilyId, hypothesisLineage: input.hypothesisLineage,
  })) if (!text(value)) fail("MISSING_FIELD", `${name} is required`);
  if (input.strategy.artifact == null || input.strategy.config == null || input.split.definition == null || input.walkForwardConfig == null) fail("MISSING_FIELD", "strategy artifact/config and split/walk-forward definitions are required");

  const train = checkWindow("TRAIN", input.windows.train, input.intervalMs);
  const validation = checkWindow("VALIDATION", input.windows.validation, input.intervalMs);
  const holdout = checkWindow("HOLDOUT", input.windows.holdout, input.intervalMs);
  if (!(train.last < validation.first && validation.last < holdout.first)) fail("WINDOWS_NOT_ORDERED", "train, validation and holdout windows must be disjoint and in time order");
  if (input.role === "HOLDOUT" && input.finalHoldoutUntouched !== true) fail("HOLDOUT_CONTAMINATED", "the holdout window was already used for this strategy configuration");

  const roleWindow = input.role === "TRAIN" ? input.windows.train : input.role === "VALIDATION" ? input.windows.validation : input.windows.holdout;
  const range = input.role === "TRAIN" ? train : input.role === "VALIDATION" ? validation : holdout;
  const allCandles = [...input.windows.train.candles, ...input.windows.validation.candles, ...input.windows.holdout.candles];

  const provenance: ResearchProvenance = Object.freeze({
    researchRunId: input.researchRunId,
    sessionId: input.sessionId,
    experimentId: input.experimentId,
    evaluationId: input.evaluationId,
    ...(input.hypothesisId == null ? {} : { hypothesisId: input.hypothesisId }),
    datasetId: `upbit-1m-closed:${input.market}:${input.intervalMs}`,
    datasetContentSha256: candleChecksum(allCandles),
    datasetManifestSchemaVersion: 1,
    market: input.market,
    interval: `${input.intervalMs / 60_000}m`,
    startEventTime: range.first,
    endEventTime: range.last,
    featurePipelineVersion: input.featurePipeline.version,
    featurePipelineHash: sha({ version: input.featurePipeline.version, config: input.featurePipeline.config }),
    strategyId: input.strategy.id,
    strategyVersion: input.strategy.version,
    strategyArtifactHash: sha(input.strategy.artifact),
    strategyConfigHash: sha(input.strategy.config),
    sourceCommitSha: input.sourceCommitSha,
    evaluatorVersion: input.evaluator.version,
    modelVersion: input.evaluator.modelVersion,
    fillModelVersion: input.models.fill,
    feeModelVersion: input.models.fee,
    slippageModelVersion: input.models.slippage,
    randomSeed: researchHardeningHash({ evaluationId: input.evaluationId }),
    splitIdentity: input.split.identity,
    splitHash: sha(input.split.definition),
    walkForwardConfigHash: sha(input.walkForwardConfig),
    experimentFamilyId: input.experimentFamilyId,
    attempt: input.attempt,
    hypothesisLineage: input.hypothesisLineage,
    trainingWindowHash: candleChecksum(input.windows.train.candles),
    validationWindowHash: candleChecksum(input.windows.validation.candles),
    finalHoldoutWindowHash: candleChecksum(input.windows.holdout.candles),
    canonicalInputHash: input.canonicalInputHash,
    finalHoldoutUntouched: input.finalHoldoutUntouched,
    windowId: roleWindow.windowId,
    windowRole: input.role,
  });

  const errors = validateResearchProvenance(provenance);
  if (errors.length > 0) fail("PROVENANCE_INVALID", `provenance failed validation: ${errors.join(",")}`);
  const temporal = validateResearchTemporalIntegrity([
    { ...provenance, windowRole: "TRAIN", startEventTime: train.first, endEventTime: train.last },
    { ...provenance, windowRole: "VALIDATION", startEventTime: validation.first, endEventTime: validation.last },
    { ...provenance, windowRole: "HOLDOUT", startEventTime: holdout.first, endEventTime: holdout.last },
  ]);
  if (temporal.length > 0) fail("TEMPORAL_INTEGRITY", `temporal integrity failed: ${temporal.join(",")}`);
  return provenance;
}
