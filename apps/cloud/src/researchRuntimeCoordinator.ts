import { createHash } from "node:crypto";
import {
  canonicalResearchJson,
  type ResearchComparisonEvidence,
  type ResearchComparisonResult,
  type ResearchEvaluation,
  type ResearchEvaluationContext,
  type ResearchEvaluationLedger,
  type ResearchInputSnapshot,
  type ResearchEvaluatorAuthority
} from "../../../packages/contracts/src/researchRuntime";
import { validateResearchProvenance, type ResearchCostEvidence } from "../../../packages/contracts/src/researchHardening";
import { validateResearchCostEvidence } from "./researchCostEvidence";

export interface ChampionResearchEvaluator {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly authority: "PAPER_ONLY";
  readonly evaluatorVersion: string;
  evaluate(context: ResearchEvaluationContext): ResearchEvaluation;
}

export interface ChallengerResearchEvaluator {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly authority: "ZERO_AUTHORITY";
  readonly evaluatorVersion: string;
  evaluate(context: ResearchEvaluationContext): ResearchEvaluation;
}

export interface ResearchRuntimeMarketDataTick {
  readonly market: string;
  readonly price: number;
  readonly observedAt: number;
  readonly now: number;
}

export interface ResearchRuntimeCoordinatorOptions {
  readonly champion: ChampionResearchEvaluator;
  readonly challenger: ChallengerResearchEvaluator;
  readonly ledger?: ResearchEvaluationLedger;
}

export class ResearchRuntimeError extends Error {
  public constructor(readonly code: "INVALID_INPUT" | "LEDGER_PERSISTENCE_FAILED", message: string) {
    super(message);
    this.name = "ResearchRuntimeError";
  }
}

const supportedStates = new Set(["RESEARCHING", "VALIDATED", "PAPER_CANDIDATE", "PAPER_ACTIVE", "CHAMPION", "CHALLENGER"]);
const freeze = <T>(value: T): T => Object.freeze(value);
const clonePoint = (point: unknown): ResearchInputSnapshot["marketData"][number] => {
  if (point !== null && typeof point === "object" && !Array.isArray(point)) {
    return freeze({ ...(point as ResearchInputSnapshot["marketData"][number]) });
  }
  return freeze({ market: "", price: 0, observedAt: 0 });
};
const reason = (reasons: readonly string[]): string => [...new Set(reasons)].sort().join(",");
const invalidInputHash = createHash("sha256").update("NUSA_RESEARCH_INPUT_CANONICALIZATION_FAILED_V1", "utf8").digest("hex");

interface CanonicalHashResult {
  readonly hash: string;
  readonly valid: boolean;
}

function canonicalHash(value: unknown): CanonicalHashResult {
  try { return { hash: createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex"), valid: true }; }
  catch { return { hash: invalidInputHash, valid: false }; }
}

function projectCostEvidence(value: unknown): ResearchCostEvidence | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const projected = {
    schemaVersion: candidate.schemaVersion,
    evaluationId: candidate.evaluationId,
    datasetId: candidate.datasetId,
    datasetContentSha256: candidate.datasetContentSha256,
    feeRate: candidate.feeRate,
    spreadRate: candidate.spreadRate,
    slippageRate: candidate.slippageRate,
    turnoverRate: candidate.turnoverRate,
    grossReturn: candidate.grossReturn,
    netReturn: candidate.netReturn,
    costModelVersion: candidate.costModelVersion,
    observedAt: candidate.observedAt
  };
  try {
    canonicalResearchJson(projected);
    return freeze(projected) as ResearchCostEvidence;
  } catch {
    return undefined;
  }
}

function snapshot(input: ResearchInputSnapshot): ResearchInputSnapshot {
  const candidate = input as unknown as Record<string, unknown> | null;
  const marketData = candidate != null && Array.isArray(candidate.marketData) ? candidate.marketData : undefined;
  const hasCostEvidence = candidate != null && typeof candidate === "object" && Object.prototype.hasOwnProperty.call(candidate, "costEvidence");
  const costEvidence = hasCostEvidence ? projectCostEvidence(candidate.costEvidence) : undefined;
  return freeze({
    ...(candidate != null && typeof candidate === "object" ? candidate : {}),
    ...(hasCostEvidence ? { costEvidence: costEvidence ?? null } : {}),
    marketData: marketData === undefined ? undefined : freeze(marketData.map(clonePoint))
  }) as unknown as ResearchInputSnapshot;
}

function invalidReasons(input: ResearchInputSnapshot, canonicalInputValid: boolean): readonly string[] {
  const reasons: string[] = [];
  if (!canonicalInputValid) reasons.push("NON_CANONICAL_INPUT");
  for (const [field, value] of Object.entries({
    researchRunId: input.researchRunId,
    evaluationId: input.evaluationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    modelVersion: input.modelVersion,
    fillModelVersion: input.fillModelVersion,
    feeModelVersion: input.feeModelVersion,
    slippageModelVersion: input.slippageModelVersion
  })) if (typeof value !== "string" || value.trim() === "") reasons.push(`MISSING_${field.toUpperCase()}`);
  if (!Number.isSafeInteger(input.marketDataTimestamp) || !Number.isSafeInteger(input.evaluationTimestamp) || input.marketDataTimestamp > input.evaluationTimestamp) reasons.push("INVALID_TIMESTAMP");
  if (!Number.isSafeInteger(input.staleWindowMs) || input.staleWindowMs <= 0) reasons.push("INVALID_STALE_WINDOW");
  if (!Number.isFinite(input.startingCash) || input.startingCash < 0 || !Number.isFinite(input.startingPositionQuantity) || input.startingPositionQuantity < 0) reasons.push("INVALID_STARTING_STATE");
  if (!supportedStates.has(input.strategyState)) reasons.push("UNSUPPORTED_STRATEGY_STATE");
  if (!Array.isArray(input.marketData)) reasons.push("INVALID_MARKET_DATA");
  else if (input.marketData.length === 0) reasons.push("MISSING_DATA");
  const ids = new Set<string>();
  if (Array.isArray(input.marketData)) for (const point of input.marketData) {
    const market = typeof point?.market === "string" ? point.market : "";
    const observedAt = point?.observedAt;
    if (!market.trim() || !Number.isFinite(point?.price) || point.price <= 0 || !Number.isSafeInteger(observedAt) || (Number.isSafeInteger(input.evaluationTimestamp) && observedAt > input.evaluationTimestamp)) reasons.push("INVALID_MARKET_DATA");
    if (Number.isSafeInteger(input.evaluationTimestamp) && Number.isSafeInteger(observedAt) && Number.isSafeInteger(input.staleWindowMs) && input.evaluationTimestamp - observedAt >= input.staleWindowMs) reasons.push("STALE_MARKET_DATA");
    const key = `${market}|${Number.isSafeInteger(observedAt) ? observedAt : "INVALID"}`;
    if (ids.has(key)) reasons.push("DUPLICATE_MARKET_DATA");
    ids.add(key);
  }
  if (input.provenance != null) reasons.push(...validateResearchProvenance(input.provenance));
  if (Object.prototype.hasOwnProperty.call(input as object, "costEvidence")) {
    const costEvidence = (input as ResearchInputSnapshot & { readonly costEvidence?: unknown }).costEvidence;
    if (costEvidence == null || typeof costEvidence !== "object" || Array.isArray(costEvidence)) {
      reasons.push("INVALID_COST_EVIDENCE");
    } else {
      const decision = validateResearchCostEvidence(costEvidence as ResearchCostEvidence, input.evaluationTimestamp);
      reasons.push(...decision.reasons.map((item) => `COST_EVIDENCE_${item}`));
      if ((costEvidence as ResearchCostEvidence).evaluationId !== input.evaluationId) reasons.push("COST_EVIDENCE_EVALUATION_MISMATCH");
      if (input.provenance != null && (
        (costEvidence as ResearchCostEvidence).datasetId !== input.provenance.datasetId
        || (costEvidence as ResearchCostEvidence).datasetContentSha256 !== input.provenance.datasetContentSha256
      )) reasons.push("COST_EVIDENCE_PROVENANCE_MISMATCH");
    }
  }
  return Object.freeze([...new Set(reasons)].sort());
}

function validateEvaluation(value: ResearchEvaluation, evaluator: { strategyId: string; strategyVersion: string; authority: ResearchEvaluatorAuthority; evaluatorVersion: string }, context: ResearchEvaluationContext): string | undefined {
  if (value.strategyId !== evaluator.strategyId || value.strategyVersion !== evaluator.strategyVersion) return "EVALUATOR_IDENTITY_MISMATCH";
  if (value.authority !== evaluator.authority || value.evaluatorVersion !== evaluator.evaluatorVersion) return "EVALUATOR_AUTHORITY_MISMATCH";
  if (value.canonicalInputHash !== context.canonicalInputHash) return "EVALUATOR_CONTEXT_MISMATCH";
  if (value.signal !== "BUY" && value.signal !== "SELL" && value.signal !== "HOLD") return "INVALID_SIGNAL";
  if (typeof value.metrics.netReturn !== "number" || !Number.isFinite(value.metrics.netReturn) || Object.values(value.metrics).some((metric) => !Number.isFinite(metric))) return "INVALID_METRICS";
  return undefined;
}

function evidence(input: ResearchInputSnapshot, hash: string, result: ResearchComparisonResult, reasonText: string, champion: ResearchEvaluation | null, challenger: ResearchEvaluation | null): ResearchComparisonEvidence {
  const costEvidence = projectCostEvidence(input.costEvidence);
  return freeze({
    schemaVersion: 1,
    researchRunId: input.researchRunId,
    evaluationId: input.evaluationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    marketDataTimestamp: input.marketDataTimestamp,
    evaluationTimestamp: input.evaluationTimestamp,
    canonicalInputHash: hash,
    modelVersion: input.modelVersion,
    fillModelVersion: input.fillModelVersion,
    feeModelVersion: input.feeModelVersion,
    slippageModelVersion: input.slippageModelVersion,
    ...(input.provenance == null ? {} : { provenance: input.provenance }),
    ...(costEvidence == null ? {} : { costEvidence }),
    champion,
    challenger,
    result,
    reason: reasonText,
    productionMutationAllowed: false,
    promotionAllowed: false
  });
}

export class InMemoryResearchEvaluationLedger implements ResearchEvaluationLedger {
  private readonly records: ResearchComparisonEvidence[] = [];
  public append(record: ResearchComparisonEvidence): void {
    const existing = this.records.find((item) => item.evaluationId === record.evaluationId);
    if (existing) { if (canonicalResearchJson(existing) !== canonicalResearchJson(record)) throw new Error("research evaluation id conflict"); return; }
    this.records.push(record);
  }
  public list(): readonly ResearchComparisonEvidence[] { return freeze([...this.records]); }
}

export class ResearchRuntimeCoordinator {
  private readonly ledger: ResearchEvaluationLedger;
  public constructor(private readonly options: ResearchRuntimeCoordinatorOptions) { this.ledger = options.ledger ?? new InMemoryResearchEvaluationLedger(); }

  public evaluate(rawInput: ResearchInputSnapshot): ResearchComparisonEvidence {
    const input = snapshot(rawInput);
    const inputHashResult = canonicalHash(input);
    const invalid = invalidReasons(input, inputHashResult.valid);
    if (invalid.length > 0) {
      const record = evidence(input, inputHashResult.hash, "INCONCLUSIVE", reason(invalid), null, null);
      this.persist(record);
      return record;
    }
    const canonicalInputHash = inputHashResult.hash;
    const context = freeze({ input, canonicalInputHash, fillModelVersion: input.fillModelVersion, feeModelVersion: input.feeModelVersion, slippageModelVersion: input.slippageModelVersion });
    let champion: ResearchEvaluation;
    let challenger: ResearchEvaluation;
    try {
      champion = freeze(this.options.champion.evaluate(context));
      challenger = freeze(this.options.challenger.evaluate(context));
    } catch {
      const record = evidence(input, canonicalInputHash, "INCONCLUSIVE", "EVALUATOR_EXCEPTION", null, null);
      this.persist(record);
      return record;
    }
    const validationReason = validateEvaluation(champion, this.options.champion, context) ?? validateEvaluation(challenger, this.options.challenger, context);
    if (validationReason) {
      const record = evidence(input, canonicalInputHash, "INCONCLUSIVE", validationReason, champion, challenger);
      this.persist(record);
      return record;
    }
    const requiredMetrics = ["costAdjustedReturn", "maximumDrawdown", "sharpeRatio", "executionQuality"];
    const hardenedMetrics = input.provenance != null;
    if (hardenedMetrics && requiredMetrics.some((key) => typeof champion.metrics[key] !== "number" || typeof challenger.metrics[key] !== "number")) {
      const record = evidence(input, canonicalInputHash, "INCONCLUSIVE", "INCOMPLETE_COMPARISON_METRICS", champion, challenger);
      this.persist(record);
      return record;
    }
    const championReturn = champion.metrics.netReturn;
    const challengerReturn = challenger.metrics.netReturn;
    const challengerBetter = hardenedMetrics
      ? challengerReturn > championReturn && challenger.metrics.costAdjustedReturn >= champion.metrics.costAdjustedReturn && challenger.metrics.maximumDrawdown <= champion.metrics.maximumDrawdown && challenger.metrics.sharpeRatio >= champion.metrics.sharpeRatio && challenger.metrics.executionQuality >= champion.metrics.executionQuality
      : challengerReturn > championReturn;
    const championBetter = hardenedMetrics
      ? championReturn > challengerReturn && champion.metrics.costAdjustedReturn >= challenger.metrics.costAdjustedReturn && champion.metrics.maximumDrawdown <= challenger.metrics.maximumDrawdown && champion.metrics.sharpeRatio >= challenger.metrics.sharpeRatio && champion.metrics.executionQuality >= challenger.metrics.executionQuality
      : championReturn > challengerReturn;
    const result: ResearchComparisonResult = challengerBetter ? "CHALLENGER_BETTER" : championBetter ? "CHAMPION_BETTER" : "INCONCLUSIVE";
    const record = evidence(input, canonicalInputHash, result, hardenedMetrics ? "MULTI_METRIC_COMPARISON" : "NET_RETURN_COMPARISON", champion, challenger);
    this.persist(record);
    return record;
  }

  public ledgerRecords(): readonly ResearchComparisonEvidence[] { return this.ledger.list(); }
  private persist(record: ResearchComparisonEvidence): void { try { this.ledger.append(record); } catch (error) { throw new ResearchRuntimeError("LEDGER_PERSISTENCE_FAILED", error instanceof Error ? error.message : "research ledger persistence failed"); } }
}

export interface CloudResearchRuntimeOptions {
  readonly coordinator: ResearchRuntimeCoordinator;
  readonly buildInput: (tick: ResearchRuntimeMarketDataTick) => ResearchInputSnapshot;
}

export class CloudResearchRuntime {
  public constructor(private readonly options: CloudResearchRuntimeOptions) {}
  public onMarketData(tick: ResearchRuntimeMarketDataTick): ResearchComparisonEvidence { return this.options.coordinator.evaluate(this.options.buildInput(tick)); }
}
