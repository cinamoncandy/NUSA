import { createHash } from "node:crypto";
import { validateResearchCandidateSpecification, type ResearchCandidateSpecification } from "../../../packages/contracts/src/researchCandidateSpecification";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { StrategyFamilyRegistry } from "./strategyFamilyRegistry";

export const EXPLORATION_SCHEMA_VERSION = 2;
export const EXPLORATION_POLICY_VERSION = "exploration-v1";
export const EXPLORATION_ALLOTMENT_PER_CYCLE = 4;
export const FAMILY_REPETITION_CEILING = 3;

export class ExplorationError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExplorationError";
  }
}

export type ExplorationVerdict = "ALLOTTED" | "SUPPRESSED_EXACT_DUPLICATE" | "SUPPRESSED_NEAR_DUPLICATE" | "SUPPRESSED_FAMILY_CEILING" | "EXHAUSTED";

export const GATES_STILL_REQUIRED: readonly string[] = Object.freeze([
  "point-in-time", "out-of-sample", "walk-forward", "cost-completeness", "minimum-sample", "qualification", "governance",
]);

export interface ExplorationAttempt {
  readonly schemaVersion: typeof EXPLORATION_SCHEMA_VERSION;
  readonly policyVersion: typeof EXPLORATION_POLICY_VERSION;
  readonly learningCycleId: string;
  readonly experimentIdentity: string;
  readonly configurationIdentity: string;
  readonly configurationDescriptor: ExplorationConfigurationDescriptor;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly familyId: string;
  readonly familyRepetitionCount: number;
  readonly nearDuplicateKey: string;
  readonly nearDuplicateCount: number;
  readonly verdict: ExplorationVerdict;
  readonly allotmentRemaining: number;
  readonly reason: string;
  readonly gatesStillRequired: readonly string[];
}

export interface ExplorationConfigurationDescriptor {
  readonly familyId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parametersSha256: string;
  readonly codeSha: string;
  readonly datasetContentSha256: string;
  readonly costModel: Readonly<{ readonly feeBps: number; readonly slippageBps: number; readonly spreadBps: number; readonly turnoverAssumption: number }>;
  readonly evaluationWindowStart: string;
  readonly evaluationWindowEnd: string;
}

const HASH = /^[a-f0-9]{64}$/;
const CODE_SHA = /^[a-f0-9]{40}$/;
const CYCLE_ID = /^learning-cycle:[a-f0-9]{64}$/;
const VERDICTS = new Set<ExplorationVerdict>(["ALLOTTED", "SUPPRESSED_EXACT_DUPLICATE", "SUPPRESSED_NEAR_DUPLICATE", "SUPPRESSED_FAMILY_CEILING", "EXHAUSTED"]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function candidateShape(candidate: ResearchCandidateSpecification, families: StrategyFamilyRegistry): {
  readonly experimentIdentity: string;
  readonly configurationIdentity: string;
  readonly nearDuplicateKey: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly familyId: string;
  readonly configurationDescriptor: ExplorationConfigurationDescriptor;
} {
  const errors = validateResearchCandidateSpecification(candidate);
  if (errors.length > 0) throw new ExplorationError("INVALID_CANDIDATE", "canonical Research Candidate Specification is invalid: " + errors.join(","));
  try {
    families.requireMembership(candidate.strategyId, candidate.strategyVersion, candidate.familyId);
  } catch {
    throw new ExplorationError("UNREGISTERED_FAMILY_MEMBER", "candidate strategy family is not registered for this exact strategy version");
  }
  const configurationDescriptor: ExplorationConfigurationDescriptor = Object.freeze({
    familyId: candidate.familyId,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    parametersSha256: sha256(candidate.parametersCanonicalJson),
    codeSha: candidate.codeSha.toLowerCase(),
    datasetContentSha256: candidate.datasetContentSha256.toLowerCase(),
    costModel: Object.freeze({
      feeBps: candidate.costModel.feeBps,
      slippageBps: candidate.costModel.slippageBps,
      spreadBps: candidate.costModel.spreadBps,
      turnoverAssumption: candidate.costModel.turnoverAssumption,
    }),
    // Equivalent ISO spellings must not mint different Research configuration identities.
    evaluationWindowStart: new Date(candidate.evaluationWindowStart).toISOString(),
    evaluationWindowEnd: new Date(candidate.evaluationWindowEnd).toISOString(),
  });
  const configurationIdentity = sha256(canonicalResearchJson(configurationDescriptor));
  // Near duplicate deliberately excludes dataset/window/cost so a renamed or re-evaluated copy
  // of the same family configuration cannot consume fresh exploration budget.
  const nearDuplicateKey = sha256(canonicalResearchJson({
    familyId: candidate.familyId,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    parametersSha256: configurationDescriptor.parametersSha256,
  }));
  return Object.freeze({
    experimentIdentity: configurationIdentity,
    configurationIdentity,
    nearDuplicateKey,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    familyId: candidate.familyId,
    configurationDescriptor,
  });
}

function stableString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function expectedReason(verdict: ExplorationVerdict, familyId: string): string {
  switch (verdict) {
    case "SUPPRESSED_EXACT_DUPLICATE": return "the canonical candidate configuration was already attempted in prior durable Learning history";
    case "SUPPRESSED_NEAR_DUPLICATE": return "the same registered family configuration was already attempted in prior durable Learning history";
    case "SUPPRESSED_FAMILY_CEILING": return "registered family " + familyId + " has reached its owner-set durable-history repetition ceiling of " + String(FAMILY_REPETITION_CEILING);
    case "EXHAUSTED": return "owner-set exploration allotment of " + String(EXPLORATION_ALLOTMENT_PER_CYCLE) + " for this learning cycle is exhausted";
    case "ALLOTTED": return "within the owner-set exploration allotment; all required evaluation and governance gates remain";
  }
}

function deriveAttempt(
  cycleId: string,
  shape: ReturnType<typeof candidateShape>,
  history: readonly ExplorationAttempt[],
): ExplorationAttempt {
  if (!CYCLE_ID.test(cycleId)) throw new ExplorationError("INVALID_CYCLE_ID", "a canonical A2 learning cycle identity is required");
  const current = history.filter((attempt) => attempt.learningCycleId === cycleId);
  // Diversity is durable across cycles; only the hard exploration allotment resets at the A2 cycle boundary.
  const exactDuplicate = history.some((attempt) => attempt.configurationIdentity === shape.configurationIdentity);
  const nearDuplicateCount = history.filter((attempt) => attempt.nearDuplicateKey === shape.nearDuplicateKey).length;
  const familyAttempts = history.filter((attempt) => attempt.familyId === shape.familyId && attempt.verdict === "ALLOTTED").length;
  const allotted = current.filter((attempt) => attempt.verdict === "ALLOTTED").length;
  const remaining = Math.max(0, EXPLORATION_ALLOTMENT_PER_CYCLE - allotted);
  const verdict: ExplorationVerdict = exactDuplicate
    ? "SUPPRESSED_EXACT_DUPLICATE"
    : nearDuplicateCount > 0
      ? "SUPPRESSED_NEAR_DUPLICATE"
      : familyAttempts >= FAMILY_REPETITION_CEILING
        ? "SUPPRESSED_FAMILY_CEILING"
        : remaining === 0
          ? "EXHAUSTED"
          : "ALLOTTED";
  const nextAllotted = allotted + (verdict === "ALLOTTED" ? 1 : 0);
  const nextRemaining = Math.max(0, EXPLORATION_ALLOTMENT_PER_CYCLE - nextAllotted);
  const nextFamilyCount = familyAttempts + (verdict === "ALLOTTED" ? 1 : 0);
  return Object.freeze({
    schemaVersion: EXPLORATION_SCHEMA_VERSION,
    policyVersion: EXPLORATION_POLICY_VERSION,
    learningCycleId: cycleId,
    experimentIdentity: shape.experimentIdentity,
    configurationIdentity: shape.configurationIdentity,
    configurationDescriptor: shape.configurationDescriptor,
    strategyId: shape.strategyId,
    strategyVersion: shape.strategyVersion,
    familyId: shape.familyId,
    familyRepetitionCount: nextFamilyCount,
    nearDuplicateKey: shape.nearDuplicateKey,
    nearDuplicateCount,
    verdict,
    allotmentRemaining: nextRemaining,
    reason: expectedReason(verdict, shape.familyId),
    gatesStillRequired: GATES_STILL_REQUIRED,
  });
}

export function assertExplorationAttempt(value: unknown): asserts value is ExplorationAttempt {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new ExplorationError("MALFORMED_ATTEMPT", "exploration attempt must be an object");
  const attempt = value as Record<string, unknown>;
  const fields = ["schemaVersion", "policyVersion", "learningCycleId", "experimentIdentity", "configurationIdentity", "configurationDescriptor", "strategyId", "strategyVersion", "familyId", "familyRepetitionCount", "nearDuplicateKey", "nearDuplicateCount", "verdict", "allotmentRemaining", "reason", "gatesStillRequired"];
  if (Object.keys(attempt).length !== fields.length || Object.keys(attempt).some((field) => !fields.includes(field))) throw new ExplorationError("MALFORMED_ATTEMPT", "exploration attempt fields are not exact");
  if (attempt.schemaVersion !== EXPLORATION_SCHEMA_VERSION || attempt.policyVersion !== EXPLORATION_POLICY_VERSION || !CYCLE_ID.test(String(attempt.learningCycleId))) throw new ExplorationError("MALFORMED_ATTEMPT", "exploration schema, policy or cycle identity is unsupported");
  if (![attempt.experimentIdentity, attempt.configurationIdentity, attempt.nearDuplicateKey].every((item) => typeof item === "string" && HASH.test(item))) throw new ExplorationError("MALFORMED_ATTEMPT", "exploration fingerprints are malformed");
  const descriptor = attempt.configurationDescriptor as Record<string, unknown> | null;
  const descriptorFields = ["familyId", "strategyId", "strategyVersion", "parametersSha256", "codeSha", "datasetContentSha256", "costModel", "evaluationWindowStart", "evaluationWindowEnd"];
  if (descriptor == null || typeof descriptor !== "object" || Array.isArray(descriptor)
    || Object.keys(descriptor).length !== descriptorFields.length || Object.keys(descriptor).some((field) => !descriptorFields.includes(field))) {
    throw new ExplorationError("MALFORMED_ATTEMPT", "configuration descriptor fields are not exact");
  }
  const cost = descriptor.costModel as Record<string, unknown> | null;
  if (cost == null || typeof cost !== "object" || Array.isArray(cost)
    || Object.keys(cost).length !== 4 || Object.keys(cost).some((field) => !["feeBps", "slippageBps", "spreadBps", "turnoverAssumption"].includes(field))
    || Object.values(cost).some((item) => typeof item !== "number" || !Number.isFinite(item) || item < 0)) {
    throw new ExplorationError("MALFORMED_ATTEMPT", "configuration cost model is malformed");
  }
  if (![descriptor.familyId, descriptor.strategyId, descriptor.strategyVersion, descriptor.evaluationWindowStart, descriptor.evaluationWindowEnd].every(stableString)
    || ![descriptor.parametersSha256, descriptor.datasetContentSha256].every((item) => typeof item === "string" && HASH.test(item))
    || typeof descriptor.codeSha !== "string" || !CODE_SHA.test(descriptor.codeSha)
    || !Number.isFinite(Date.parse(descriptor.evaluationWindowStart as string)) || !Number.isFinite(Date.parse(descriptor.evaluationWindowEnd as string))
    || new Date(descriptor.evaluationWindowStart as string).toISOString() !== descriptor.evaluationWindowStart
    || new Date(descriptor.evaluationWindowEnd as string).toISOString() !== descriptor.evaluationWindowEnd
    || Date.parse(descriptor.evaluationWindowStart as string) >= Date.parse(descriptor.evaluationWindowEnd as string)) {
    throw new ExplorationError("MALFORMED_ATTEMPT", "configuration descriptor identity is malformed");
  }
  const expectedConfig = sha256(canonicalResearchJson(descriptor));
  const expectedNear = sha256(canonicalResearchJson({ familyId: descriptor.familyId, strategyId: descriptor.strategyId, strategyVersion: descriptor.strategyVersion, parametersSha256: descriptor.parametersSha256 }));
  if (attempt.experimentIdentity !== expectedConfig || attempt.configurationIdentity !== expectedConfig || attempt.nearDuplicateKey !== expectedNear
    || attempt.strategyId !== descriptor.strategyId || attempt.strategyVersion !== descriptor.strategyVersion || attempt.familyId !== descriptor.familyId
    || !stableString(attempt.reason)) throw new ExplorationError("MALFORMED_ATTEMPT", "candidate-derived identity or explanation is inconsistent");
  if (!Number.isSafeInteger(attempt.familyRepetitionCount) || (attempt.familyRepetitionCount as number) < 0
    || !Number.isSafeInteger(attempt.nearDuplicateCount) || (attempt.nearDuplicateCount as number) < 0
    || !Number.isSafeInteger(attempt.allotmentRemaining) || (attempt.allotmentRemaining as number) < 0 || (attempt.allotmentRemaining as number) > EXPLORATION_ALLOTMENT_PER_CYCLE
    || typeof attempt.verdict !== "string" || !VERDICTS.has(attempt.verdict as ExplorationVerdict)
    || !Array.isArray(attempt.gatesStillRequired) || canonicalResearchJson(attempt.gatesStillRequired) !== canonicalResearchJson(GATES_STILL_REQUIRED)) {
    throw new ExplorationError("MALFORMED_ATTEMPT", "exploration counters, verdict, or required gates are invalid");
  }
}

/** Pure deterministic assessment. Durable callers must validate and serialize append around this result. */
export function assessExploration(
  cycleId: string,
  candidate: ResearchCandidateSpecification,
  families: StrategyFamilyRegistry,
  history: readonly ExplorationAttempt[],
): ExplorationAttempt {
  for (const attempt of history) assertExplorationAttempt(attempt);
  const shape = candidateShape(candidate, families);
  return deriveAttempt(cycleId, shape, history);
}

/** Validate a complete durable projection by replaying its deterministic counters and verdicts. */
export function assertExplorationHistory(history: readonly ExplorationAttempt[]): void {
  const accepted: ExplorationAttempt[] = [];
  for (const attempt of history) {
    assertExplorationAttempt(attempt);
    const expected = deriveAttempt(attempt.learningCycleId, {
      experimentIdentity: attempt.experimentIdentity,
      configurationIdentity: attempt.configurationIdentity,
      nearDuplicateKey: attempt.nearDuplicateKey,
      strategyId: attempt.strategyId,
      strategyVersion: attempt.strategyVersion,
      familyId: attempt.familyId,
      configurationDescriptor: attempt.configurationDescriptor,
    }, accepted);
    if (!sameExplorationAttempt(attempt, expected)) throw new ExplorationError("CORRUPTED_HISTORY", "durable exploration history is not a deterministic replay");
    accepted.push(attempt);
  }
}

/** Deterministic payload equality used by the durable adapter's serialized append validator. */
export function sameExplorationAttempt(left: ExplorationAttempt, right: ExplorationAttempt): boolean {
  return canonicalResearchJson(left) === canonicalResearchJson(right);
}
