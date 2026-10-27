import { createHash } from "node:crypto";
import {
  attributeCandidateFailures,
  type CandidateFailureAttributionPolicy,
  type CandidateFailureCategory,
} from "./candidateFailureAttribution";
import {
  buildResearchFeedbackDigest,
  type ResearchFeedbackPolicy,
} from "./researchFeedbackDigest";
import type { LeagueStanding } from "./nusaLeague";
import type { ResearchTrialRecord } from "./researchTrialLedger";
import type { ResearchEvolutionFeedbackResult, ResearchFeedbackAction } from "../../../cloud/src/researchEvolutionFeedback";

export type InvestmentLearningGuidance = "EXPLORE" | "HOLD" | "DEPRIORITIZE";

export interface InvestmentLearningFamilyEvidence {
  readonly familyId: string;
  readonly guidance: InvestmentLearningGuidance;
  readonly priorTrialCount: number;
  readonly priorDistinctSearchCount: number;
  readonly historicalFailureRatio: number;
  readonly boundedPriorAdjustment: number;
  readonly currentCandidateCount: number;
  readonly currentFailureCategories: readonly CandidateFailureCategory[];
  readonly failureCategoryCounts: Readonly<Partial<Record<CandidateFailureCategory, number>>>;
  readonly recurringFailureCategories: readonly CandidateFailureCategory[];
  /** Rejection/abstention reason counts deduplicated by distinct canonical search. */
  readonly historicalFailureReasonSearchCounts: Readonly<Record<string, number>>;
  readonly recurringHistoricalFailureReasons: readonly string[];
  readonly insufficientEvidenceFor: readonly CandidateFailureCategory[];
  readonly reasons: readonly string[];
}

export interface InvestmentResearchAttentionEntry {
  readonly rank: number;
  readonly familyId: string;
  readonly guidance: InvestmentLearningGuidance;
  readonly priorTrialCount: number;
  readonly priorDistinctSearchCount: number;
  /** PAPER Review/evolution findings to investigate; never changes ordering or runtime strategy state. */
  readonly reviewResearchFocusActions: readonly ResearchFeedbackAction[];
  readonly reasons: readonly string[];
}

export interface InvestmentLearningEvidence {
  readonly schemaVersion: 1;
  readonly evidenceMode: "SEALED_RESEARCH_HISTORY_AND_CURRENT_LEAGUE";
  readonly ledgerTerminalHash: string;
  readonly evaluatedSequence: number;
  readonly leagueGeneratedAt: string;
  readonly leagueSourceDatasetIds: readonly string[];
  readonly families: readonly InvestmentLearningFamilyEvidence[];
  readonly evidenceFingerprintSha256: string;
  readonly authority: Readonly<{
    researchAdvisoryOnly: true;
    qualificationMutationAllowed: false;
    scoreMutationAllowed: false;
    portfolioWeightMutationAllowed: false;
    capitalMutationAllowed: false;
    executionAuthority: "NONE";
    liveAuthority: "NONE";
    productionMutationAllowed: false;
    aiAuthority: "ZERO_AUTHORITY";
  }>;
}

export class InvestmentLearningEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InvestmentLearningEvidenceError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const sortedUnique = <T extends string>(values: readonly T[]): readonly T[] => freeze([...new Set(values)].sort()) as readonly T[];

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvestmentLearningEvidenceError("NON_FINITE_EVIDENCE", "investment learning evidence contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  throw new InvestmentLearningEvidenceError("UNSUPPORTED_EVIDENCE", "investment learning evidence contains an unsupported value");
}

const sha256 = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function validateStanding(standing: LeagueStanding): void {
  if (standing.schemaVersion !== 1) throw new InvestmentLearningEvidenceError("UNSUPPORTED_LEAGUE_SCHEMA", "League standing schema is unsupported");
  if (!Number.isFinite(Date.parse(standing.generatedAt))) throw new InvestmentLearningEvidenceError("INVALID_LEAGUE_TIME", "League generatedAt is invalid");
  const candidateIds = new Set<string>();
  const familyIds = new Set<string>();
  for (const entry of standing.entries) {
    if (!entry.id.trim() || !entry.familyId.trim()) throw new InvestmentLearningEvidenceError("INVALID_LEAGUE_IDENTITY", "League candidate and family identity are required");
    if (candidateIds.has(entry.id)) throw new InvestmentLearningEvidenceError("DUPLICATE_CANDIDATE_ID", `League candidate ${entry.id} is duplicated`);
    candidateIds.add(entry.id);
    familyIds.add(entry.familyId);
    for (const value of Object.values(entry.components)) {
      if (value != null && typeof value === "number" && !Number.isFinite(value)) {
        throw new InvestmentLearningEvidenceError("NON_FINITE_LEAGUE_EVIDENCE", `League candidate ${entry.id} contains non-finite evidence`);
      }
    }
  }
  if (standing.coverage.candidateCount !== standing.entries.length
    || standing.coverage.eligibleCount !== standing.entries.filter((entry) => entry.eligible).length
    || standing.coverage.familyCount !== familyIds.size) {
    throw new InvestmentLearningEvidenceError("LEAGUE_COVERAGE_MISMATCH", "League coverage does not match entries");
  }
  if (standing.provenance.sourceDatasetIds.some((id) => !id.trim())) {
    throw new InvestmentLearningEvidenceError("INVALID_DATASET_PROVENANCE", "League dataset provenance contains an empty identity");
  }
}

function guidanceFor(input: {
  readonly priorTrialCount: number;
  readonly minimumPriorTrials: number;
  readonly priorDistinctSearchCount: number;
  readonly minimumDistinctSearches: number;
  readonly boundedPriorAdjustment: number;
  readonly recurringFailureCategories: readonly CandidateFailureCategory[];
  readonly recurringHistoricalFailureReasons: readonly string[];
}): InvestmentLearningGuidance {
  if (input.priorTrialCount < input.minimumPriorTrials || input.priorDistinctSearchCount < input.minimumDistinctSearches) return "EXPLORE";
  if (input.boundedPriorAdjustment < 0
    && input.recurringFailureCategories.length > 0
    && input.recurringHistoricalFailureReasons.length > 0) return "DEPRIORITIZE";
  return "HOLD";
}

function failureReasonSearchCounts(
  ledger: readonly ResearchTrialRecord[],
  evaluatedSequence: number,
  familyId: string,
): Readonly<Record<string, number>> {
  const searchesByReason = new Map<string, Set<string>>();
  for (const record of ledger) {
    if (record.sequence >= evaluatedSequence || record.familyId !== familyId) continue;
    const reasons = record.outcome === "REJECTED" ? (record.rejectionReasons ?? [])
      : record.outcome === "ABSTAINED" ? (record.abstentionReasons ?? []) : [];
    for (const reason of reasons) {
      const searches = searchesByReason.get(reason) ?? new Set<string>();
      searches.add(record.search.searchId);
      searchesByReason.set(reason, searches);
    }
  }
  return freeze(Object.fromEntries([...searchesByReason.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, searches]) => [reason, searches.size])));
}

/**
 * Composes the existing sealed-history feedback and League failure attribution into one bounded
 * investment-learning record. Positive history is intentionally never promoted into a higher
 * qualification score or stronger execution authority: it can only remain HOLD. Under-explored
 * families may move earlier in research attention, while repeatedly weak families may move later.
 * All canonical qualification gates remain untouched.
 */
export function buildInvestmentLearningEvidence(input: {
  readonly ledger: readonly ResearchTrialRecord[];
  readonly standing: LeagueStanding;
  readonly evaluatedSequence?: number;
  readonly declaredFamilyIds?: readonly string[];
  readonly feedbackPolicy?: Partial<ResearchFeedbackPolicy>;
  readonly failurePolicy?: Partial<CandidateFailureAttributionPolicy>;
}): InvestmentLearningEvidence {
  validateStanding(input.standing);
  const feedback = buildResearchFeedbackDigest(input.ledger, {
    evaluatedSequence: input.evaluatedSequence,
    policy: input.feedbackPolicy,
  });
  const attributions = attributeCandidateFailures(input.standing, input.failurePolicy);
  const declaredFamilyIds = input.declaredFamilyIds ?? freeze([]);
  if (new Set(declaredFamilyIds).size !== declaredFamilyIds.length || declaredFamilyIds.some((id) => !id.trim())) {
    throw new InvestmentLearningEvidenceError("INVALID_DECLARED_FAMILIES", "declared research families must be unique non-empty identities");
  }

  const currentByFamily = new Map<string, typeof attributions>();
  for (const item of attributions) {
    const current = currentByFamily.get(item.familyId) ?? freeze([]);
    currentByFamily.set(item.familyId, freeze([...current, item]));
  }
  const feedbackByFamily = new Map(feedback.families.map((family) => [family.familyId, family] as const));
  const familyIds = sortedUnique([
    ...declaredFamilyIds,
    ...feedback.families.map((family) => family.familyId),
    ...input.standing.entries.map((entry) => entry.familyId),
  ]);

  const families = familyIds.map((familyId) => {
    const historical = feedbackByFamily.get(familyId);
    const current = currentByFamily.get(familyId) ?? freeze([]);
    const currentFailureCategories = sortedUnique(current.flatMap((item) => item.categories));
    const failureCategoryCounts = Object.fromEntries(currentFailureCategories.map((category) => [
      category,
      current.filter((item) => item.categories.includes(category)).length,
    ])) as Partial<Record<CandidateFailureCategory, number>>;
    const recurringFailureCategories = current.length >= 2
      ? sortedUnique(currentFailureCategories.filter((category) => failureCategoryCounts[category] === current.length))
      : freeze([]) as readonly CandidateFailureCategory[];
    const insufficientEvidenceFor = sortedUnique(current.flatMap((item) => item.insufficientEvidenceFor));
    const priorTrialCount = historical?.priorTrialCount ?? 0;
    const priorDistinctSearchCount = historical?.distinctSearchCount ?? 0;
    const historicalFailureRatio = historical?.failureRatio ?? 0;
    const boundedPriorAdjustment = historical?.priorAdjustment ?? 0;
    const historicalFailureReasonSearchCounts = failureReasonSearchCounts(input.ledger, feedback.evaluatedSequence, familyId);
    const recurringHistoricalFailureReasons = sortedUnique(Object.entries(historicalFailureReasonSearchCounts)
      .filter(([, count]) => count >= feedback.policy.minimumDistinctSearches)
      .map(([reason]) => reason));
    const guidance = guidanceFor({
      priorTrialCount,
      minimumPriorTrials: feedback.policy.minimumPriorTrials,
      priorDistinctSearchCount,
      minimumDistinctSearches: feedback.policy.minimumDistinctSearches,
      boundedPriorAdjustment,
      recurringFailureCategories,
      recurringHistoricalFailureReasons,
    });
    const reasons: string[] = ["CANONICAL_GATES_UNCHANGED", "POSITIVE_HISTORY_CANNOT_AUTO_PROMOTE"];
    if (guidance === "EXPLORE") reasons.push("INSUFFICIENT_DISTINCT_SEALED_HISTORY_EXPLORE_FOR_EVIDENCE");
    if (guidance === "DEPRIORITIZE") reasons.push("NEGATIVE_SEALED_HISTORY_WITH_DISTINCT_SEARCH_RECURRING_FAILURE_EVIDENCE");
    if (guidance === "HOLD") reasons.push("NO_BOUNDED_REASON_TO_CHANGE_RESEARCH_ATTENTION");
    if (current.length === 0) reasons.push("NO_CURRENT_LEAGUE_CANDIDATES_FOR_FAMILY");
    if (currentFailureCategories.length > 0) reasons.push(...currentFailureCategories.map((category) => `CURRENT_${category}`));
    if (recurringFailureCategories.length > 0) reasons.push("RECURRING_FAILURE_MECHANISM_ACROSS_CURRENT_CANDIDATES");
    if (recurringHistoricalFailureReasons.length > 0) reasons.push("RECURRING_FAILURE_REASON_ACROSS_DISTINCT_SEARCHES");
    if (insufficientEvidenceFor.length > 0) reasons.push("CURRENT_FAILURE_ATTRIBUTION_INCOMPLETE");
    return freeze({
      familyId,
      guidance,
      priorTrialCount,
      priorDistinctSearchCount,
      historicalFailureRatio,
      boundedPriorAdjustment,
      currentCandidateCount: current.length,
      currentFailureCategories,
      failureCategoryCounts: freeze(failureCategoryCounts),
      recurringFailureCategories,
      historicalFailureReasonSearchCounts,
      recurringHistoricalFailureReasons,
      insufficientEvidenceFor,
      reasons: sortedUnique(reasons),
    });
  });

  const authority = freeze({
    researchAdvisoryOnly: true as const,
    qualificationMutationAllowed: false as const,
    scoreMutationAllowed: false as const,
    portfolioWeightMutationAllowed: false as const,
    capitalMutationAllowed: false as const,
    executionAuthority: "NONE" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
  const body = {
    schemaVersion: 1 as const,
    evidenceMode: "SEALED_RESEARCH_HISTORY_AND_CURRENT_LEAGUE" as const,
    ledgerTerminalHash: feedback.ledgerTerminalHash,
    evaluatedSequence: feedback.evaluatedSequence,
    leagueGeneratedAt: new Date(Date.parse(input.standing.generatedAt)).toISOString(),
    leagueSourceDatasetIds: sortedUnique(input.standing.provenance.sourceDatasetIds),
    families: freeze(families),
    authority,
  };
  return freeze({ ...body, evidenceFingerprintSha256: sha256(body) });
}

/**
 * Applies learning only to the order in which already-declared families receive research
 * attention. It never adds/removes a family and never changes candidate parameters or gates.
 */
export function orderResearchFamiliesByLearning(
  declaredFamilyIds: readonly string[],
  evidence: InvestmentLearningEvidence,
): readonly string[] {
  if (new Set(declaredFamilyIds).size !== declaredFamilyIds.length || declaredFamilyIds.some((id) => !id.trim())) {
    throw new InvestmentLearningEvidenceError("INVALID_DECLARED_FAMILIES", "declared research families must be unique non-empty identities");
  }
  const byFamily = new Map(evidence.families.map((family) => [family.familyId, family] as const));
  for (const familyId of declaredFamilyIds) {
    if (!byFamily.has(familyId)) throw new InvestmentLearningEvidenceError("MISSING_FAMILY_LEARNING_EVIDENCE", `learning evidence is missing family ${familyId}`);
  }
  const priority: Readonly<Record<InvestmentLearningGuidance, number>> = freeze({ EXPLORE: 0, HOLD: 1, DEPRIORITIZE: 2 });
  return freeze([...declaredFamilyIds].sort((left, right) => {
    const a = byFamily.get(left)!;
    const b = byFamily.get(right)!;
    return priority[a.guidance] - priority[b.guidance]
      || a.priorDistinctSearchCount - b.priorDistinctSearchCount
      || a.priorTrialCount - b.priorTrialCount
      || left.localeCompare(right);
  }));
}

const RESEARCH_FEEDBACK_ACTIONS: ReadonlySet<ResearchFeedbackAction> = new Set([
  "PRIORITIZE_CALIBRATION",
  "PRIORITIZE_REGIME_ROBUSTNESS",
  "PRIORITIZE_COST_ROBUSTNESS",
  "PRIORITIZE_DRAWDOWN_CONTROL",
  "PRIORITIZE_PROVENANCE_REPAIR",
  "PRIORITIZE_INFRASTRUCTURE_REPAIR",
  "PRIORITIZE_REPLACEMENT_RESEARCH",
  "MAINTAIN_CURRENT_RESEARCH",
]);

function reviewFocusByFamily(
  declaredFamilyIds: readonly string[],
  feedback: readonly ResearchEvolutionFeedbackResult[],
): ReadonlyMap<string, readonly ResearchFeedbackAction[]> {
  const declared = new Set(declaredFamilyIds);
  const feedbackIds = new Set<string>();
  const actions = new Map<string, Set<ResearchFeedbackAction>>();
  for (const item of feedback) {
    if (!item.feedbackId.trim() || feedbackIds.has(item.feedbackId)) {
      throw new InvestmentLearningEvidenceError("INVALID_REVIEW_FEEDBACK_ID", "Review feedback identities must be unique and non-empty");
    }
    feedbackIds.add(item.feedbackId);
    if (!declared.has(item.strategyFamilyId)) {
      throw new InvestmentLearningEvidenceError("UNDECLARED_REVIEW_FEEDBACK_FAMILY", `Review feedback references undeclared family ${item.strategyFamilyId}`);
    }
    if (!item.candidateId.trim() || !item.regime.trim() || item.actions.length === 0
      || item.researchPriorityMutationAllowed !== false || item.liveAuthority !== "NONE"
      || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") {
      throw new InvestmentLearningEvidenceError("INVALID_REVIEW_FEEDBACK_AUTHORITY", `Review feedback ${item.feedbackId} violates the advisory-only contract`);
    }
    const bucket = actions.get(item.strategyFamilyId) ?? new Set<ResearchFeedbackAction>();
    for (const action of item.actions) {
      if (!RESEARCH_FEEDBACK_ACTIONS.has(action)) {
        throw new InvestmentLearningEvidenceError("INVALID_REVIEW_FEEDBACK_ACTION", `Review feedback ${item.feedbackId} contains an unsupported research action`);
      }
      bucket.add(action);
    }
    actions.set(item.strategyFamilyId, bucket);
  }
  return new Map([...actions.entries()].map(([familyId, values]) => [familyId, freeze([...values].sort())]));
}

/**
 * Produces the explicit next-cycle Strategy Research queue. Sealed Research history determines
 * ordering. Optional PAPER Review/evolution feedback only annotates what robustness dimension to
 * investigate; it cannot change rank, invent a family, alter parameters, change qualification,
 * or deploy a strategy.
 */
export function buildInvestmentResearchAttentionPlan(
  declaredFamilyIds: readonly string[],
  evidence: InvestmentLearningEvidence,
  reviewFeedback: readonly ResearchEvolutionFeedbackResult[] = freeze([]),
): readonly InvestmentResearchAttentionEntry[] {
  const byFamily = new Map(evidence.families.map((family) => [family.familyId, family] as const));
  const reviewFocus = reviewFocusByFamily(declaredFamilyIds, reviewFeedback);
  return freeze(orderResearchFamiliesByLearning(declaredFamilyIds, evidence).map((familyId, index) => {
    const family = byFamily.get(familyId)!;
    return freeze({
      rank: index + 1,
      familyId,
      guidance: family.guidance,
      priorTrialCount: family.priorTrialCount,
      priorDistinctSearchCount: family.priorDistinctSearchCount,
      reviewResearchFocusActions: reviewFocus.get(familyId) ?? freeze([]),
      reasons: family.reasons,
    });
  }));
}
