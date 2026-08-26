import type { LeagueStanding, LeagueRankedEntry } from "./nusaLeague";

/**
 * Research-only capital-allocation advisory over an already-evaluated NUSA League standing.
 *
 * This module does not size orders, move funds, call brokers, or grant LIVE authority. It only
 * emits normalized research weights that can be compared in PAPER/research evaluation. The
 * production execution/risk stack remains the sole owner of any real position sizing decision.
 */

export interface LeagueCapitalAllocationPolicy {
  readonly maximumCandidateWeight: number;
  readonly minimumEvidenceBreadth: number;
  readonly maximumCandidateCount: number;
}

export interface LeagueCapitalAllocationEntry {
  readonly id: string;
  readonly familyId: string;
  readonly rank: number;
  readonly leagueScore: number;
  readonly evidenceBreadth: number;
  readonly researchWeight: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export interface LeagueCapitalAllocationAdvisory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly policy: LeagueCapitalAllocationPolicy;
  readonly entries: readonly LeagueCapitalAllocationEntry[];
  readonly excludedCandidateIds: readonly string[];
  readonly reasons: readonly string[];
  readonly provenance: Readonly<{ sourceDatasetIds: readonly string[] }>;
}

export class LeagueCapitalAllocationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LeagueCapitalAllocationError";
  }
}

const DEFAULT_POLICY: LeagueCapitalAllocationPolicy = Object.freeze({
  maximumCandidateWeight: 0.4,
  minimumEvidenceBreadth: 0.5,
  maximumCandidateCount: 5,
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new LeagueCapitalAllocationError(code, message);
}

function validatePolicy(policy: LeagueCapitalAllocationPolicy): void {
  assertFinite(policy.maximumCandidateWeight, "INVALID_POLICY", "maximumCandidateWeight must be finite");
  assertFinite(policy.minimumEvidenceBreadth, "INVALID_POLICY", "minimumEvidenceBreadth must be finite");
  if (policy.maximumCandidateWeight <= 0 || policy.maximumCandidateWeight > 1) {
    throw new LeagueCapitalAllocationError("INVALID_POLICY", "maximumCandidateWeight must be in (0, 1]");
  }
  if (policy.minimumEvidenceBreadth < 0 || policy.minimumEvidenceBreadth > 1) {
    throw new LeagueCapitalAllocationError("INVALID_POLICY", "minimumEvidenceBreadth must be in [0, 1]");
  }
  if (!Number.isInteger(policy.maximumCandidateCount) || policy.maximumCandidateCount < 1) {
    throw new LeagueCapitalAllocationError("INVALID_POLICY", "maximumCandidateCount must be a positive integer");
  }
}

function eligibleEntries(standing: LeagueStanding, policy: LeagueCapitalAllocationPolicy): LeagueRankedEntry[] {
  return standing.entries
    .filter((entry): entry is LeagueRankedEntry & { rank: number; leagueScore: number } =>
      entry.eligible === true
      && entry.rank != null
      && entry.leagueScore != null
      && Number.isFinite(entry.leagueScore)
      && entry.evidenceBreadth >= policy.minimumEvidenceBreadth,
    )
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, policy.maximumCandidateCount);
}

function cappedNormalize(raw: readonly number[], cap: number): number[] {
  if (raw.length === 0) return [];
  if (cap * raw.length < 1 - 1e-12) {
    throw new LeagueCapitalAllocationError(
      "INSUFFICIENT_DIVERSIFICATION_CAPACITY",
      `maximumCandidateWeight=${cap} cannot allocate 100% across ${raw.length} eligible candidates`,
    );
  }

  const weights = new Array<number>(raw.length).fill(0);
  const active = new Set(raw.map((_, index) => index));
  let remaining = 1;

  while (active.size > 0) {
    const rawTotal = [...active].reduce((sum, index) => sum + raw[index]!, 0);
    const equalFallback = rawTotal <= 0;
    let cappedAny = false;

    for (const index of [...active]) {
      const proposed = equalFallback
        ? remaining / active.size
        : remaining * (raw[index]! / rawTotal);
      if (proposed > cap + 1e-12) {
        weights[index] = cap;
        remaining -= cap;
        active.delete(index);
        cappedAny = true;
      }
    }

    if (!cappedAny) {
      const denominator = equalFallback ? active.size : rawTotal;
      for (const index of active) {
        weights[index] = equalFallback
          ? remaining / denominator
          : remaining * (raw[index]! / denominator);
      }
      remaining = 0;
      break;
    }
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new LeagueCapitalAllocationError("ALLOCATION_NORMALIZATION_FAILED", `research weights sum to ${total}`);
  }
  return weights;
}

export function adviseLeagueCapitalAllocation(
  standing: LeagueStanding,
  overrides: Partial<LeagueCapitalAllocationPolicy> = {},
): LeagueCapitalAllocationAdvisory {
  if (standing.schemaVersion !== 1) {
    throw new LeagueCapitalAllocationError("UNSUPPORTED_LEAGUE_SCHEMA", "League standing schema is unsupported");
  }
  const policy: LeagueCapitalAllocationPolicy = freeze({ ...DEFAULT_POLICY, ...overrides });
  validatePolicy(policy);

  const selected = eligibleEntries(standing, policy);
  if (selected.length === 0) {
    throw new LeagueCapitalAllocationError("NO_ALLOCATABLE_CANDIDATES", "League contains no eligible candidates with sufficient evidence breadth");
  }

  const scores = selected.map((entry) => entry.leagueScore!);
  scores.forEach((score) => assertFinite(score, "NON_FINITE_LEAGUE_SCORE", "leagueScore must be finite"));
  const minimum = Math.min(...scores);
  const maximum = Math.max(...scores);
  const spread = maximum - minimum;
  const rawUtility = scores.map((score) => {
    const normalized = spread <= 1e-12 ? 1 : (score - minimum) / spread;
    return 0.25 + 0.75 * normalized;
  });
  const weights = cappedNormalize(rawUtility, policy.maximumCandidateWeight);

  const selectedIds = new Set(selected.map((entry) => entry.id));
  const excludedCandidateIds = standing.entries.filter((entry) => !selectedIds.has(entry.id)).map((entry) => entry.id).sort();
  const provenance = new Set<string>();
  const entries = selected.map((entry, index): LeagueCapitalAllocationEntry => {
    for (const datasetId of entry.sourceDatasetIds) provenance.add(datasetId);
    const reasons = [
      "RESEARCH_ONLY_ALLOCATION_ADVISORY",
      ...(entry.evidenceBreadth < 1 ? ["INCOMPLETE_EVIDENCE_BREADTH"] : []),
    ];
    return freeze({
      id: entry.id,
      familyId: entry.familyId,
      rank: entry.rank!,
      leagueScore: entry.leagueScore!,
      evidenceBreadth: entry.evidenceBreadth,
      researchWeight: weights[index]!,
      reasons: freeze(reasons),
      sourceDatasetIds: freeze([...entry.sourceDatasetIds]),
    });
  });

  return freeze({
    schemaVersion: 1,
    generatedAt: standing.generatedAt,
    policy,
    entries: freeze(entries),
    excludedCandidateIds: freeze(excludedCandidateIds),
    reasons: freeze(["NO_EXECUTION_AUTHORITY", "NORMALIZED_RESEARCH_WEIGHTS_ONLY"]),
    provenance: freeze({ sourceDatasetIds: freeze([...provenance].sort()) }),
  });
}
