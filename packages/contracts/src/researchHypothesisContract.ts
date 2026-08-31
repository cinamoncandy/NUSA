/**
 * Research hypothesis contract (NUSA governing charter / Research Factory section 13).
 *
 * "결과를 본 뒤 hypothesis를 재작성하여 과거부터 존재했던 것처럼 만들지 않는다." Every hypothesis
 * this type represents is immutable once created (id, candidateId, family/lineage, rationale,
 * mechanism, target market, expected regime, invalidation condition, holding period, capacity
 * assumptions, transaction cost sensitivity, provenance, and a creation timestamp) precisely so it
 * cannot be quietly rewritten after an outcome is known. The existing AI hypothesis drafting path
 * (researchHypothesisAgent.ts / researchMemoryV2.ts) produces a much thinner DRAFT record; this
 * contract is what a draft must be completed into before it can enter the research pipeline
 * (candidate specification -> point-in-time dataset -> ... -> Strategy League) the charter
 * describes -- it does not replace or duplicate researchMemoryV2's storage/lifecycle machinery.
 */

export type ResearchHypothesisFamily =
  | "MOMENTUM"
  | "MEAN_REVERSION"
  | "CARRY"
  | "VOLATILITY"
  | "LIQUIDITY"
  | "MICROSTRUCTURE"
  | "SENTIMENT"
  | "MACRO"
  | "CROSS_ASSET"
  | "OTHER";

export const RESEARCH_HYPOTHESIS_FAMILIES: readonly ResearchHypothesisFamily[] = Object.freeze([
  "MOMENTUM",
  "MEAN_REVERSION",
  "CARRY",
  "VOLATILITY",
  "LIQUIDITY",
  "MICROSTRUCTURE",
  "SENTIMENT",
  "MACRO",
  "CROSS_ASSET",
  "OTHER",
]);

export interface ResearchHypothesisProvenance {
  readonly author: string;
  readonly modelVersionId?: string;
  readonly promptArtifactDigest?: string;
  readonly sourceReferences: readonly string[];
}

export interface ResearchHypothesisCapacityAssumptions {
  /** Maximum notional this hypothesis is assumed to remain valid at, in quote-currency units. */
  readonly maxNotional: number;
  /** Assumed maximum participation rate of average daily volume, 0..1. */
  readonly maxParticipationRate: number;
}

export interface ResearchHypothesis {
  readonly schemaVersion: 1;
  /** Immutable once created; never reused for a rewritten hypothesis. */
  readonly hypothesisId: string;
  readonly candidateId: string;
  readonly family: ResearchHypothesisFamily;
  /** Lineage: hypothesisId of the prior hypothesis this one was derived from, if any. */
  readonly parentHypothesisId?: string;
  readonly rationale: string;
  /** The economic or behavioral mechanism this hypothesis claims to exploit, stated explicitly
   * rather than left implicit in the rationale -- "why would this edge exist at all". */
  readonly mechanism: string;
  readonly targetMarket: string;
  readonly expectedRegime: string;
  readonly invalidationCondition: string;
  readonly holdingPeriodMs: number;
  readonly capacityAssumptions: ResearchHypothesisCapacityAssumptions;
  /** 0..1 subjective prior sensitivity to transaction costs; 1 = the edge is assumed to disappear
   * entirely under realistic costs, 0 = assumed cost-insensitive. Not a promotion signal by
   * itself -- Backtest Integrity (section 15) still requires actual realized cost evidence. */
  readonly transactionCostSensitivity: number;
  readonly provenance: ResearchHypothesisProvenance;
  /** Immutable creation timestamp; a later revision must be a new hypothesisId with
   * parentHypothesisId set, never a mutation of this field. */
  readonly createdAt: string;
}

export interface ResearchHypothesisValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export class ResearchHypothesisContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchHypothesisContractError";
  }
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const nonEmptyText = (value: unknown, maxLength = 4_000): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
const unitInterval = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Validates a ResearchHypothesis. Fails closed on any missing, malformed, or out-of-range field.
 * Does not and cannot detect post-hoc rewriting on its own -- that guarantee comes from treating
 * hypothesisId as an immutable, append-only key in whatever store persists these (Research Memory),
 * not from anything this pure function can check.
 */
export function validateResearchHypothesis(value: unknown): ResearchHypothesisValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["HYPOTHESIS_INVALID"] };
  }
  const hypothesis = value as Record<string, unknown>;

  if (hypothesis.schemaVersion !== 1) errors.push("SCHEMA_VERSION_INVALID");
  if (typeof hypothesis.hypothesisId !== "string" || !ID.test(hypothesis.hypothesisId)) errors.push("HYPOTHESIS_ID_INVALID");
  if (typeof hypothesis.candidateId !== "string" || !ID.test(hypothesis.candidateId)) errors.push("CANDIDATE_ID_INVALID");
  if (typeof hypothesis.family !== "string" || !RESEARCH_HYPOTHESIS_FAMILIES.includes(hypothesis.family as ResearchHypothesisFamily)) {
    errors.push("FAMILY_INVALID");
  }
  if (hypothesis.parentHypothesisId !== undefined && (typeof hypothesis.parentHypothesisId !== "string" || !ID.test(hypothesis.parentHypothesisId))) {
    errors.push("PARENT_HYPOTHESIS_ID_INVALID");
  }
  if (hypothesis.parentHypothesisId !== undefined && hypothesis.parentHypothesisId === hypothesis.hypothesisId) {
    errors.push("HYPOTHESIS_CANNOT_BE_OWN_PARENT");
  }
  if (!nonEmptyText(hypothesis.rationale)) errors.push("RATIONALE_INVALID");
  if (!nonEmptyText(hypothesis.mechanism)) errors.push("MECHANISM_INVALID");
  if (typeof hypothesis.targetMarket !== "string" || !ID.test(hypothesis.targetMarket)) errors.push("TARGET_MARKET_INVALID");
  if (!nonEmptyText(hypothesis.expectedRegime, 256)) errors.push("EXPECTED_REGIME_INVALID");
  if (!nonEmptyText(hypothesis.invalidationCondition)) errors.push("INVALIDATION_CONDITION_INVALID");
  if (!Number.isSafeInteger(hypothesis.holdingPeriodMs) || (hypothesis.holdingPeriodMs as number) <= 0) errors.push("HOLDING_PERIOD_INVALID");

  const capacity = hypothesis.capacityAssumptions;
  if (!capacity || typeof capacity !== "object" || Array.isArray(capacity)) {
    errors.push("CAPACITY_ASSUMPTIONS_INVALID");
  } else {
    const c = capacity as Record<string, unknown>;
    if (!finitePositive(c.maxNotional)) errors.push("CAPACITY_MAX_NOTIONAL_INVALID");
    if (!unitInterval(c.maxParticipationRate)) errors.push("CAPACITY_MAX_PARTICIPATION_RATE_INVALID");
  }

  if (!unitInterval(hypothesis.transactionCostSensitivity)) errors.push("TRANSACTION_COST_SENSITIVITY_INVALID");

  const provenance = hypothesis.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push("PROVENANCE_INVALID");
  } else {
    const p = provenance as Record<string, unknown>;
    if (!nonEmptyText(p.author, 256)) errors.push("PROVENANCE_AUTHOR_INVALID");
    if (p.modelVersionId !== undefined && !nonEmptyText(p.modelVersionId, 256)) errors.push("PROVENANCE_MODEL_VERSION_INVALID");
    if (p.promptArtifactDigest !== undefined && !nonEmptyText(p.promptArtifactDigest, 256)) errors.push("PROVENANCE_PROMPT_DIGEST_INVALID");
    if (!Array.isArray(p.sourceReferences) || !p.sourceReferences.every((ref) => typeof ref === "string" && ref.trim().length > 0)) {
      errors.push("PROVENANCE_SOURCE_REFERENCES_INVALID");
    }
  }

  if (typeof hypothesis.createdAt !== "string" || !Number.isFinite(Date.parse(hypothesis.createdAt))) errors.push("CREATED_AT_INVALID");

  return { valid: errors.length === 0, errors: Object.freeze([...new Set(errors)]) };
}

export function isValidResearchHypothesis(value: unknown): value is ResearchHypothesis {
  return validateResearchHypothesis(value).valid;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

/**
 * Creates the immutable, fully populated contract that a research pipeline may admit. This is
 * intentionally separate from the AI DRAFT record: callers must provide every field explicitly;
 * no missing research assumption is filled in by this helper.
 */
export function createResearchHypothesis(
  input: Omit<ResearchHypothesis, "schemaVersion">,
): ResearchHypothesis {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchHypothesisContractError("INVALID_HYPOTHESIS", "research hypothesis input must be an object");
  }
  const hypothesis = {
    schemaVersion: 1 as const,
    hypothesisId: input.hypothesisId,
    candidateId: input.candidateId,
    family: input.family,
    ...(input.parentHypothesisId === undefined ? {} : { parentHypothesisId: input.parentHypothesisId }),
    rationale: input.rationale,
    mechanism: input.mechanism,
    targetMarket: input.targetMarket,
    expectedRegime: input.expectedRegime,
    invalidationCondition: input.invalidationCondition,
    holdingPeriodMs: input.holdingPeriodMs,
    capacityAssumptions: input.capacityAssumptions == null ? input.capacityAssumptions : { ...input.capacityAssumptions },
    transactionCostSensitivity: input.transactionCostSensitivity,
    provenance: input.provenance == null ? input.provenance : {
      ...input.provenance,
      sourceReferences: Array.isArray(input.provenance.sourceReferences)
        ? [...input.provenance.sourceReferences]
        : input.provenance.sourceReferences,
    },
    createdAt: input.createdAt,
  };
  const decision = validateResearchHypothesis(hypothesis);
  if (!decision.valid) {
    throw new ResearchHypothesisContractError(
      "INVALID_HYPOTHESIS",
      `research hypothesis is invalid: ${decision.errors.join(",")}`,
    );
  }
  return deepFreeze(hypothesis as ResearchHypothesis);
}

/**
 * True when `candidate` is a legitimate revision of `original` (new id, parent points back,
 * everything else about the original's claim stays traceable) rather than a same-id in-place
 * rewrite. Callers should reject any update attempt that reuses `original.hypothesisId`.
 */
export function isLegitimateHypothesisRevision(original: ResearchHypothesis, candidate: ResearchHypothesis): boolean {
  return (
    candidate.hypothesisId !== original.hypothesisId &&
    candidate.parentHypothesisId === original.hypothesisId &&
    candidate.candidateId === original.candidateId
  );
}
