import type { LeagueStanding, LeagueRankedEntry } from "./nusaLeague";
import type {
  LeagueCapitalAllocationAdvisory,
  LeagueCapitalAllocationEntry,
  LeagueCapitalAllocationPolicy,
} from "../../../../packages/contracts/src/leagueCapitalAllocation";

export type {
  LeagueCapitalAllocationAdvisory,
  LeagueCapitalAllocationEntry,
  LeagueCapitalAllocationPolicy,
} from "../../../../packages/contracts/src/leagueCapitalAllocation";

/**
 * Research-only capital-allocation advisory over an already-evaluated NUSA League standing.
 *
 * This module does not size orders, move funds, call brokers, or grant LIVE authority. It only
 * emits normalized research weights that can be compared in PAPER/research evaluation. The
 * production execution/risk stack remains the sole owner of any real position sizing decision.
 */

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
  maximumFamilyWeight: 0.5,
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
  assertFinite(policy.maximumFamilyWeight, "INVALID_POLICY", "maximumFamilyWeight must be finite");
  if (policy.maximumFamilyWeight <= 0 || policy.maximumFamilyWeight > 1) {
    throw new LeagueCapitalAllocationError("INVALID_POLICY", "maximumFamilyWeight must be in (0, 1]");
  }
  // A family cap below the candidate cap is incoherent: a family always contains its own members.
  if (policy.maximumFamilyWeight < policy.maximumCandidateWeight) {
    throw new LeagueCapitalAllocationError("INVALID_POLICY", "maximumFamilyWeight must not be below maximumCandidateWeight");
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

/**
 * Water-filling normalization under two simultaneous constraints: no candidate may exceed the
 * candidate cap, and no strategy family may exceed the family cap in total.
 *
 * The family constraint is what makes the diversification real. A per-candidate cap alone is
 * satisfied by N tuned variants of one family that each sit under the cap while together owning
 * almost everything -- correlated risk wearing the costume of a diversified book.
 *
 * Each iteration pins at least one candidate at a binding constraint, so this terminates.
 */
function cappedNormalize(
  raw: readonly number[],
  familyIds: readonly string[],
  cap: number,
  familyCap: number,
): { readonly weights: number[]; readonly familyCapped: boolean } {
  if (raw.length === 0) return { weights: [], familyCapped: false };

  const distinctFamilies = new Set(familyIds);
  // With a single family there is nothing to diversify into, so the family cap cannot bind; the
  // caller discloses that rather than presenting a single-family book as diversified.
  const familyCapApplies = distinctFamilies.size > 1;
  const effectiveFamilyCap = familyCapApplies ? familyCap : 1;

  // Both caps bind at once, so capacity is the sum over families of whichever cap binds first.
  // Checking this up front turns a genuinely infeasible policy/candidate combination into one
  // clear diagnostic instead of a downstream "weights do not sum to 1" failure.
  const capacity = [...distinctFamilies].reduce((sum, family) => {
    const memberCount = familyIds.filter((id) => id === family).length;
    return sum + Math.min(effectiveFamilyCap, memberCount * cap);
  }, 0);
  if (capacity < 1 - 1e-12) {
    throw new LeagueCapitalAllocationError(
      "INSUFFICIENT_DIVERSIFICATION_CAPACITY",
      `maximumCandidateWeight=${cap} and maximumFamilyWeight=${familyCap} cannot allocate 100% across ${raw.length} candidates in ${distinctFamilies.size} families`,
    );
  }

  const weights = new Array<number>(raw.length).fill(0);
  const active = new Set(raw.map((_, index) => index));
  const indexesOfFamily = (family: string, from: Iterable<number>): number[] =>
    [...from].filter((index) => familyIds[index] === family);
  let remaining = 1;
  let familyCapped = false;

  while (active.size > 0) {
    const rawTotal = [...active].reduce((sum, index) => sum + raw[index]!, 0);
    const equalFallback = rawTotal <= 0;
    const tentative = (index: number): number => (equalFallback
      ? remaining / active.size
      : remaining * (raw[index]! / rawTotal));

    let cappedAny = false;
    for (const index of [...active]) {
      if (tentative(index) > cap + 1e-12) {
        weights[index] = cap;
        remaining -= cap;
        active.delete(index);
        cappedAny = true;
      }
    }
    if (cappedAny) continue;

    if (familyCapApplies) {
      let familyCappedThisPass = false;
      for (const family of distinctFamilies) {
        const activeInFamily = indexesOfFamily(family, active);
        if (activeInFamily.length === 0) continue;
        const alreadyPinned = indexesOfFamily(family, weights.keys())
          .filter((index) => !active.has(index))
          .reduce((sum, index) => sum + weights[index]!, 0);
        const projected = alreadyPinned + activeInFamily.reduce((sum, index) => sum + tentative(index), 0);
        if (projected <= familyCap + 1e-12) continue;

        // Pin this family's remaining members to the budget it has left, shared by relative
        // utility, and release the rest of the book to the other families. Each member still
        // respects the candidate cap, so any budget it cannot absorb returns to the pool.
        const budget = Math.max(0, familyCap - alreadyPinned);
        const familyRawTotal = activeInFamily.reduce((sum, index) => sum + raw[index]!, 0);
        let assigned = 0;
        for (const index of activeInFamily) {
          const share = familyRawTotal <= 0
            ? budget / activeInFamily.length
            : budget * (raw[index]! / familyRawTotal);
          weights[index] = Math.min(cap, share);
          assigned += weights[index]!;
          active.delete(index);
        }
        remaining -= assigned;
        familyCapped = true;
        familyCappedThisPass = true;
      }
      if (familyCappedThisPass) continue;
    }

    const denominator = equalFallback ? active.size : rawTotal;
    for (const index of active) {
      weights[index] = equalFallback ? remaining / denominator : remaining * (raw[index]! / denominator);
    }
    remaining = 0;
    break;
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new LeagueCapitalAllocationError("ALLOCATION_NORMALIZATION_FAILED", `research weights sum to ${total}`);
  }
  return { weights, familyCapped };
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
  const { weights, familyCapped } = cappedNormalize(
    rawUtility,
    selected.map((entry) => entry.familyId),
    policy.maximumCandidateWeight,
    policy.maximumFamilyWeight,
  );
  const distinctFamilyCount = new Set(selected.map((entry) => entry.familyId)).size;

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
    reasons: freeze([
      "NO_EXECUTION_AUTHORITY",
      "NORMALIZED_RESEARCH_WEIGHTS_ONLY",
      ...(familyCapped ? ["FAMILY_CONCENTRATION_CAPPED"] : []),
      // One family cannot be diversified against itself. Say so rather than presenting a
      // single-family book as if it were diversified.
      ...(distinctFamilyCount <= 1 ? ["SINGLE_FAMILY_EVIDENCE_BASE"] : []),
    ]),
    provenance: freeze({ sourceDatasetIds: freeze([...provenance].sort()) }),
  });
}
