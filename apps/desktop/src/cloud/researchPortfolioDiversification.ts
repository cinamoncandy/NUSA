import { createHash } from "node:crypto";
import {
  adviseLeagueCapitalAllocation,
  LeagueCapitalAllocationError,
  type LeagueCapitalAllocationAdvisory,
  type LeagueCapitalAllocationPolicy,
} from "./leagueCapitalAllocation";
import type { LeagueRankedEntry, LeagueStanding } from "./nusaLeague";

export interface ResearchPortfolioReturnPoint {
  readonly timestamp: number;
  readonly value: number;
}

export interface ResearchPortfolioDiversificationSeries {
  readonly candidateId: string;
  readonly familyId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly market: string;
  readonly interval: string;
  readonly returns: readonly ResearchPortfolioReturnPoint[];
}

export interface ResearchPortfolioDiversificationPair {
  readonly leftCandidateId: string;
  readonly rightCandidateId: string;
  readonly leftFamilyId: string;
  readonly rightFamilyId: string;
  readonly observationCount: number;
  readonly correlation: number;
  readonly absoluteCorrelation: number;
  /** Jaccard overlap of OOS drawdown states: both-in-drawdown / either-in-drawdown. */
  readonly simultaneousDrawdownOverlap: number;
}

export interface ResearchPortfolioDiversificationEvidence {
  readonly schemaVersion: 1;
  readonly evidenceMode: "RESEARCH_OOS";
  readonly candidateCount: number;
  readonly pairCount: number;
  readonly pairwiseCoverage: number;
  readonly observationCount: number;
  readonly candidateIds: readonly string[];
  readonly familyIds: readonly string[];
  readonly pairs: readonly ResearchPortfolioDiversificationPair[];
  readonly maximumAbsolutePairwiseCorrelation: number | null;
  readonly maximumSimultaneousDrawdownOverlap: number | null;
  readonly provenance: Readonly<{
    candidates: readonly Readonly<{
      candidateId: string;
      familyId: string;
      datasetId: string;
      datasetContentSha256: string;
      market: string;
      interval: string;
    }>[];
  }>;
  readonly reasons: readonly string[];
  readonly evidenceFingerprintSha256: string;
}

export interface CorrelationAwareLeagueAllocationResult {
  readonly schemaVersion: 1;
  readonly evidenceMode: "RESEARCH_ONLY";
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly diversificationEvidence: ResearchPortfolioDiversificationEvidence;
  readonly maximumAllowedAbsoluteCorrelation: number;
  readonly excludedForDependence: readonly string[];
  readonly reasons: readonly string[];
}

export class ResearchPortfolioDiversificationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchPortfolioDiversificationError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new ResearchPortfolioDiversificationError(code, message);
}

function validateSeries(series: ResearchPortfolioDiversificationSeries): void {
  if (!series.candidateId.trim() || !series.familyId.trim() || !series.datasetId.trim() || !series.market.trim() || !series.interval.trim()) {
    throw new ResearchPortfolioDiversificationError("INVALID_IDENTITY", "candidate, family, dataset, market and interval identities are required");
  }
  if (!SHA256.test(series.datasetContentSha256)) {
    throw new ResearchPortfolioDiversificationError("INVALID_DATASET_HASH", `candidate ${series.candidateId} datasetContentSha256 is invalid`);
  }
  if (series.returns.length < 8) {
    throw new ResearchPortfolioDiversificationError("INSUFFICIENT_OOS_RETURN_POINTS", `candidate ${series.candidateId} requires at least eight OOS returns`);
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of series.returns) {
    if (!Number.isSafeInteger(point.timestamp) || point.timestamp <= previous) {
      throw new ResearchPortfolioDiversificationError("INVALID_OOS_TIMESTAMP", `candidate ${series.candidateId} OOS timestamps must be strictly increasing safe integers`);
    }
    assertFinite(point.value, "NON_FINITE_OOS_RETURN", `candidate ${series.candidateId} OOS return must be finite`);
    if (point.value <= -1) {
      throw new ResearchPortfolioDiversificationError("INVALID_OOS_RETURN", `candidate ${series.candidateId} OOS return would make equity non-positive`);
    }
    previous = point.timestamp;
  }
}

function pearson(left: readonly number[], right: readonly number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const ld = left[index]! - leftMean;
    const rd = right[index]! - rightMean;
    covariance += ld * rd;
    leftVariance += ld * ld;
    rightVariance += rd * rd;
  }
  if (!(leftVariance > 0) || !(rightVariance > 0)) {
    throw new ResearchPortfolioDiversificationError("ZERO_RETURN_VARIANCE", "pairwise correlation requires non-zero OOS return variance for both candidates");
  }
  const value = covariance / Math.sqrt(leftVariance * rightVariance);
  assertFinite(value, "NON_FINITE_CORRELATION", "pairwise OOS correlation must be finite");
  return Math.max(-1, Math.min(1, value));
}

function drawdownStates(returns: readonly number[]): readonly boolean[] {
  let equity = 1;
  let peak = 1;
  return Object.freeze(returns.map((value) => {
    equity *= 1 + value;
    if (!(equity > 0) || !Number.isFinite(equity)) {
      throw new ResearchPortfolioDiversificationError("INVALID_OOS_EQUITY", "OOS return path produced non-positive or non-finite equity");
    }
    peak = Math.max(peak, equity);
    return equity < peak - 1e-12;
  }));
}

function drawdownOverlap(left: readonly boolean[], right: readonly boolean[]): number {
  let both = 0;
  let either = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index]!;
    const r = right[index]!;
    if (l || r) either += 1;
    if (l && r) both += 1;
  }
  return either === 0 ? 0 : both / either;
}

function evidencePayload(evidence: Omit<ResearchPortfolioDiversificationEvidence, "evidenceFingerprintSha256">): unknown {
  return evidence;
}

export function buildResearchPortfolioDiversificationEvidence(
  input: readonly ResearchPortfolioDiversificationSeries[],
): ResearchPortfolioDiversificationEvidence {
  if (input.length === 0) throw new ResearchPortfolioDiversificationError("EMPTY_CANDIDATE_SET", "diversification evidence requires at least one candidate");
  input.forEach(validateSeries);
  const ids = input.map((series) => series.candidateId.trim());
  if (new Set(ids).size !== ids.length) throw new ResearchPortfolioDiversificationError("DUPLICATE_CANDIDATE_ID", "candidate ids must be unique");

  const series = [...input].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const interval = series[0]!.interval;
  if (series.some((entry) => entry.interval !== interval)) {
    throw new ResearchPortfolioDiversificationError("INTERVAL_MISMATCH", "all diversification candidates must use the same OOS interval");
  }
  const reference = series[0]!.returns;
  for (const candidate of series.slice(1)) {
    if (candidate.returns.length !== reference.length) {
      throw new ResearchPortfolioDiversificationError("OOS_RETURN_LENGTH_MISMATCH", "all diversification candidates must have equal OOS return lengths");
    }
    for (let index = 0; index < reference.length; index += 1) {
      if (candidate.returns[index]!.timestamp !== reference[index]!.timestamp) {
        throw new ResearchPortfolioDiversificationError("OOS_TIMESTAMP_ALIGNMENT_MISMATCH", "all diversification candidates must describe identical OOS timestamps");
      }
    }
  }

  const drawdownById = new Map(series.map((entry) => [entry.candidateId, drawdownStates(entry.returns.map((point) => point.value))] as const));
  const pairs: ResearchPortfolioDiversificationPair[] = [];
  for (let leftIndex = 0; leftIndex < series.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < series.length; rightIndex += 1) {
      const left = series[leftIndex]!;
      const right = series[rightIndex]!;
      const correlation = pearson(left.returns.map((point) => point.value), right.returns.map((point) => point.value));
      pairs.push(freeze({
        leftCandidateId: left.candidateId,
        rightCandidateId: right.candidateId,
        leftFamilyId: left.familyId,
        rightFamilyId: right.familyId,
        observationCount: reference.length,
        correlation,
        absoluteCorrelation: Math.abs(correlation),
        simultaneousDrawdownOverlap: drawdownOverlap(drawdownById.get(left.candidateId)!, drawdownById.get(right.candidateId)!),
      }));
    }
  }

  const provenanceCandidates = freeze(series.map((entry) => freeze({
    candidateId: entry.candidateId,
    familyId: entry.familyId,
    datasetId: entry.datasetId,
    datasetContentSha256: entry.datasetContentSha256,
    market: entry.market,
    interval: entry.interval,
  })));
  const withoutFingerprint: Omit<ResearchPortfolioDiversificationEvidence, "evidenceFingerprintSha256"> = freeze({
    schemaVersion: 1,
    evidenceMode: "RESEARCH_OOS",
    candidateCount: series.length,
    pairCount: pairs.length,
    pairwiseCoverage: series.length < 2 ? 0 : pairs.length / (series.length * (series.length - 1) / 2),
    observationCount: reference.length,
    candidateIds: freeze(series.map((entry) => entry.candidateId)),
    familyIds: freeze([...new Set(series.map((entry) => entry.familyId))].sort()),
    pairs: freeze(pairs),
    maximumAbsolutePairwiseCorrelation: pairs.length === 0 ? null : Math.max(...pairs.map((pair) => pair.absoluteCorrelation)),
    maximumSimultaneousDrawdownOverlap: pairs.length === 0 ? null : Math.max(...pairs.map((pair) => pair.simultaneousDrawdownOverlap)),
    provenance: freeze({ candidates: provenanceCandidates }),
    reasons: freeze([
      "NO_EXECUTION_AUTHORITY",
      "RESEARCH_OOS_DIVERSIFICATION_EVIDENCE",
      ...(series.length < 2 ? ["INSUFFICIENT_PAIRWISE_DIVERSIFICATION_EVIDENCE"] : []),
      ...(new Set(series.map((entry) => entry.familyId)).size < 2 ? ["SINGLE_FAMILY_EVIDENCE_BASE"] : []),
    ].sort()),
  });
  return freeze({ ...withoutFingerprint, evidenceFingerprintSha256: fingerprint(evidencePayload(withoutFingerprint)) });
}

function validateEvidence(evidence: ResearchPortfolioDiversificationEvidence): void {
  if (evidence.schemaVersion !== 1 || evidence.evidenceMode !== "RESEARCH_OOS") {
    throw new ResearchPortfolioDiversificationError("INVALID_DIVERSIFICATION_EVIDENCE", "unsupported diversification evidence schema or mode");
  }
  const { evidenceFingerprintSha256, ...withoutFingerprint } = evidence;
  if (!SHA256.test(evidenceFingerprintSha256) || fingerprint(evidencePayload(withoutFingerprint)) !== evidenceFingerprintSha256) {
    throw new ResearchPortfolioDiversificationError("DIVERSIFICATION_EVIDENCE_FINGERPRINT_MISMATCH", "diversification evidence fingerprint does not match content");
  }
  if (
    evidence.candidateCount !== evidence.candidateIds.length
    || evidence.candidateCount !== evidence.provenance.candidates.length
    || evidence.pairCount !== evidence.pairs.length
  ) {
    throw new ResearchPortfolioDiversificationError("DIVERSIFICATION_EVIDENCE_COUNT_MISMATCH", "diversification evidence counts do not match content");
  }
  if (new Set(evidence.candidateIds).size !== evidence.candidateIds.length) {
    throw new ResearchPortfolioDiversificationError("DIVERSIFICATION_EVIDENCE_DUPLICATE_CANDIDATE", "diversification evidence candidate ids must be unique");
  }
  const provenanceById = new Map(evidence.provenance.candidates.map((candidate) => [candidate.candidateId, candidate] as const));
  if (
    provenanceById.size !== evidence.candidateCount
    || evidence.candidateIds.some((candidateId) => !provenanceById.has(candidateId))
  ) {
    throw new ResearchPortfolioDiversificationError("DIVERSIFICATION_EVIDENCE_PROVENANCE_MISMATCH", "diversification evidence candidate provenance is incomplete");
  }

  const expectedPairCount = evidence.candidateCount < 2
    ? 0
    : evidence.candidateCount * (evidence.candidateCount - 1) / 2;
  const expectedCoverage = expectedPairCount === 0 ? 0 : evidence.pairCount / expectedPairCount;
  if (evidence.pairCount !== expectedPairCount || Math.abs(evidence.pairwiseCoverage - expectedCoverage) > 1e-12) {
    throw new ResearchPortfolioDiversificationError("PAIRWISE_EVIDENCE_INCOMPLETE", "diversification evidence must contain every candidate pair exactly once");
  }

  const pairKeys = new Set<string>();
  for (const pair of evidence.pairs) {
    const left = provenanceById.get(pair.leftCandidateId);
    const right = provenanceById.get(pair.rightCandidateId);
    const key = pairKey(pair.leftCandidateId, pair.rightCandidateId);
    if (left == null || right == null || pair.leftCandidateId === pair.rightCandidateId || pairKeys.has(key)) {
      throw new ResearchPortfolioDiversificationError("PAIRWISE_EVIDENCE_INVALID", "diversification evidence contains an invalid or duplicate pair");
    }
    pairKeys.add(key);
    if (pair.leftFamilyId !== left.familyId || pair.rightFamilyId !== right.familyId) {
      throw new ResearchPortfolioDiversificationError("PAIRWISE_FAMILY_MISMATCH", "pairwise family identity does not match candidate provenance");
    }
    if (
      !Number.isSafeInteger(pair.observationCount)
      || pair.observationCount !== evidence.observationCount
      || pair.observationCount < 8
      || !Number.isFinite(pair.correlation)
      || pair.correlation < -1
      || pair.correlation > 1
      || !Number.isFinite(pair.absoluteCorrelation)
      || Math.abs(pair.absoluteCorrelation - Math.abs(pair.correlation)) > 1e-12
      || !Number.isFinite(pair.simultaneousDrawdownOverlap)
      || pair.simultaneousDrawdownOverlap < 0
      || pair.simultaneousDrawdownOverlap > 1
    ) {
      throw new ResearchPortfolioDiversificationError("PAIRWISE_EVIDENCE_INVALID", "pairwise diversification statistics are invalid");
    }
  }

  const maximumCorrelation = evidence.pairs.length === 0
    ? null
    : Math.max(...evidence.pairs.map((pair) => pair.absoluteCorrelation));
  const maximumDrawdownOverlap = evidence.pairs.length === 0
    ? null
    : Math.max(...evidence.pairs.map((pair) => pair.simultaneousDrawdownOverlap));
  if (
    evidence.maximumAbsolutePairwiseCorrelation !== maximumCorrelation
    || evidence.maximumSimultaneousDrawdownOverlap !== maximumDrawdownOverlap
  ) {
    throw new ResearchPortfolioDiversificationError("DIVERSIFICATION_EVIDENCE_AGGREGATE_MISMATCH", "diversification evidence aggregate statistics do not match pairwise facts");
  }
}

function filteredStanding(standing: LeagueStanding, excluded: ReadonlySet<string>): LeagueStanding {
  const entries = standing.entries.filter((entry) => !excluded.has(entry.id));
  return freeze({
    ...standing,
    entries: freeze(entries),
    coverage: freeze({
      candidateCount: entries.length,
      eligibleCount: entries.filter((entry) => entry.eligible).length,
      familyCount: new Set(entries.map((entry) => entry.familyId)).size,
    }),
  });
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

/**
 * Dependence gate around the existing League allocator. The underlying weighting engine remains
 * adviseLeagueCapitalAllocation; this function only removes the lowest-ranked member of a verified
 * over-correlated pair and asks the canonical allocator to normalize the remaining eligible book.
 */
export function adviseCorrelationAwareLeagueCapitalAllocation(
  standing: LeagueStanding,
  evidence: ResearchPortfolioDiversificationEvidence,
  allocationPolicy: Partial<LeagueCapitalAllocationPolicy>,
  maximumAllowedAbsoluteCorrelation: number,
): CorrelationAwareLeagueAllocationResult {
  validateEvidence(evidence);
  assertFinite(maximumAllowedAbsoluteCorrelation, "INVALID_CORRELATION_LIMIT", "maximumAllowedAbsoluteCorrelation must be finite");
  if (maximumAllowedAbsoluteCorrelation < 0 || maximumAllowedAbsoluteCorrelation > 1) {
    throw new ResearchPortfolioDiversificationError("INVALID_CORRELATION_LIMIT", "maximumAllowedAbsoluteCorrelation must be within [0,1]");
  }

  const standingById = new Map(standing.entries.map((entry) => [entry.id, entry] as const));
  for (const provenance of evidence.provenance.candidates) {
    const candidate = standingById.get(provenance.candidateId);
    if (candidate != null && candidate.familyId !== provenance.familyId) {
      throw new ResearchPortfolioDiversificationError("CANDIDATE_FAMILY_MISMATCH", `candidate ${provenance.candidateId} family differs between League and diversification evidence`);
    }
  }
  const pairByKey = new Map(evidence.pairs.map((pair) => [pairKey(pair.leftCandidateId, pair.rightCandidateId), pair] as const));
  const excluded = new Set<string>();

  for (let attempt = 0; attempt <= standing.entries.length; attempt += 1) {
    let advisory: LeagueCapitalAllocationAdvisory;
    try {
      advisory = adviseLeagueCapitalAllocation(filteredStanding(standing, excluded), allocationPolicy);
    } catch (error) {
      if (error instanceof LeagueCapitalAllocationError && excluded.size > 0) {
        throw new ResearchPortfolioDiversificationError("DEPENDENCE_SAFE_ALLOCATION_UNAVAILABLE", `correlation exclusions leave no feasible canonical allocation: ${error.code}`);
      }
      throw error;
    }

    const selected = advisory.entries;
    const violations: ResearchPortfolioDiversificationPair[] = [];
    for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
        const left = selected[leftIndex]!;
        const right = selected[rightIndex]!;
        const pair = pairByKey.get(pairKey(left.id, right.id));
        if (pair == null) {
          throw new ResearchPortfolioDiversificationError("PAIRWISE_EVIDENCE_MISSING", `pairwise OOS dependence evidence is missing for ${left.id} and ${right.id}`);
        }
        if (pair.absoluteCorrelation > maximumAllowedAbsoluteCorrelation) violations.push(pair);
      }
    }

    if (violations.length === 0) {
      const distinctFamilies = new Set(selected.map((entry) => entry.familyId)).size;
      return freeze({
        schemaVersion: 1,
        evidenceMode: "RESEARCH_ONLY",
        advisory,
        diversificationEvidence: evidence,
        maximumAllowedAbsoluteCorrelation,
        excludedForDependence: freeze([...excluded].sort()),
        reasons: freeze([
          "NO_EXECUTION_AUTHORITY",
          "CORRELATION_AWARE_CANONICAL_ALLOCATION",
          ...(excluded.size > 0 ? ["OVER_CORRELATED_CANDIDATES_EXCLUDED"] : []),
          ...(distinctFamilies < 2 ? ["INSUFFICIENT_CROSS_FAMILY_DIVERSIFICATION"] : []),
        ].sort()),
      });
    }

    const involved = new Set(violations.flatMap((pair) => [pair.leftCandidateId, pair.rightCandidateId]));
    const removable = [...involved]
      .map((id) => standingById.get(id))
      .filter((entry): entry is LeagueRankedEntry => entry != null)
      .sort((left, right) => (right.rank ?? Number.MAX_SAFE_INTEGER) - (left.rank ?? Number.MAX_SAFE_INTEGER) || right.id.localeCompare(left.id))[0];
    if (removable == null) {
      throw new ResearchPortfolioDiversificationError("DEPENDENCE_EXCLUSION_FAILED", "over-correlated pair does not map to a League candidate");
    }
    excluded.add(removable.id);
  }

  throw new ResearchPortfolioDiversificationError("DEPENDENCE_EXCLUSION_FAILED", "dependence filtering did not converge");
}
