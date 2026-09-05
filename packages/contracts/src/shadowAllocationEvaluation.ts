import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";

export interface ShadowAllocationPeriodInput {
  readonly periodIndex: number;
  readonly advisory: LeagueCapitalAllocationAdvisory;
  readonly realizedReturns: Readonly<Record<string, number>>;
  readonly benchmarkReturn: number;
  readonly turnoverCostRate: number;
}

export interface ShadowAllocationPeriodResult {
  readonly periodIndex: number;
  readonly candidateCount: number;
  readonly grossReturn: number;
  readonly turnover: number;
  readonly cost: number;
  readonly netReturn: number;
  readonly benchmarkExcess: number;
  readonly concentration: number;
}

export interface ShadowAllocationEvaluation {
  readonly schemaVersion: 1;
  readonly evidenceMode: "PAPER_SHADOW";
  readonly periodCount: number;
  readonly periods: readonly ShadowAllocationPeriodResult[];
  readonly cumulativeNetReturn: number;
  readonly cumulativeGrossReturn: number;
  readonly totalCost: number;
  readonly costDrag: number;
  readonly maximumDrawdown: number;
  readonly averageTurnover: number;
  readonly averageConcentration: number;
  readonly cumulativeBenchmarkExcess: number;
  readonly allocationInstability: number;
  readonly candidateChurnRatio: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export class ShadowAllocationEvaluationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ShadowAllocationEvaluationError";
  }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFinite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new ShadowAllocationEvaluationError(code, message);
}

function weightsOf(period: ShadowAllocationPeriodInput): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  for (const entry of period.advisory.entries) {
    if (weights.has(entry.id)) throw new ShadowAllocationEvaluationError("DUPLICATE_ALLOCATION_ENTRY", `period ${period.periodIndex} allocates candidate ${entry.id} twice`);
    assertFinite(entry.researchWeight, "NON_FINITE_WEIGHT", `period ${period.periodIndex} candidate ${entry.id} weight must be finite`);
    if (entry.researchWeight < 0 || entry.researchWeight > 1) throw new ShadowAllocationEvaluationError("INVALID_WEIGHT", `period ${period.periodIndex} candidate ${entry.id} weight must be within [0, 1]`);
    weights.set(entry.id, entry.researchWeight);
  }
  return weights;
}

function turnoverBetween(previous: ReadonlyMap<string, number>, current: ReadonlyMap<string, number>): number {
  const ids = new Set<string>([...previous.keys(), ...current.keys()]);
  let total = 0;
  for (const id of ids) total += Math.abs((current.get(id) ?? 0) - (previous.get(id) ?? 0));
  return total / 2;
}

function sameCandidateSet(previous: ReadonlyMap<string, number>, current: ReadonlyMap<string, number>): boolean {
  if (previous.size !== current.size) return false;
  for (const id of current.keys()) if (!previous.has(id)) return false;
  return true;
}

export function evaluateShadowAllocation(periods: readonly ShadowAllocationPeriodInput[]): ShadowAllocationEvaluation {
  if (periods.length === 0) throw new ShadowAllocationEvaluationError("EMPTY_EVALUATION", "shadow allocation evaluation requires at least one period");

  const results: ShadowAllocationPeriodResult[] = [];
  const provenance = new Set<string>();
  let previousWeights: ReadonlyMap<string, number> = new Map();
  let previousPeriodIndex: number | undefined;
  let equity = 1;
  let grossEquity = 1;
  let peakEquity = 1;
  let maximumDrawdown = 0;
  let totalCost = 0;
  let totalTurnover = 0;
  let totalConcentration = 0;
  let totalBenchmarkExcess = 0;
  let totalWeightChange = 0;
  let candidateSetChanges = 0;

  for (const period of periods) {
    if (!Number.isInteger(period.periodIndex) || period.periodIndex < 0) throw new ShadowAllocationEvaluationError("INVALID_PERIOD_INDEX", "periodIndex must be a non-negative integer");
    if (previousPeriodIndex != null && period.periodIndex <= previousPeriodIndex) throw new ShadowAllocationEvaluationError("NON_MONOTONIC_PERIODS", `period ${period.periodIndex} does not follow period ${previousPeriodIndex}`);
    if (period.advisory.schemaVersion !== 1) throw new ShadowAllocationEvaluationError("UNSUPPORTED_ADVISORY_SCHEMA", `period ${period.periodIndex} advisory schema is unsupported`);
    assertFinite(period.benchmarkReturn, "NON_FINITE_BENCHMARK_RETURN", `period ${period.periodIndex} benchmarkReturn must be finite`);
    assertFinite(period.turnoverCostRate, "NON_FINITE_COST_RATE", `period ${period.periodIndex} turnoverCostRate must be finite`);
    if (period.turnoverCostRate < 0) throw new ShadowAllocationEvaluationError("NEGATIVE_COST_RATE", `period ${period.periodIndex} turnoverCostRate must be non-negative`);

    const weights = weightsOf(period);
    const weightSum = [...weights.values()].reduce((sum, value) => sum + value, 0);
    if (weights.size > 0 && Math.abs(weightSum - 1) > 1e-9) throw new ShadowAllocationEvaluationError("WEIGHTS_NOT_NORMALIZED", `period ${period.periodIndex} weights sum to ${weightSum}, not 1`);

    let grossReturn = 0;
    let concentration = 0;
    for (const [id, weight] of weights) {
      const realized = period.realizedReturns[id];
      if (realized == null) throw new ShadowAllocationEvaluationError("MISSING_REALIZED_RETURN", `period ${period.periodIndex} has no realized return for allocated candidate ${id}`);
      assertFinite(realized, "NON_FINITE_REALIZED_RETURN", `period ${period.periodIndex} candidate ${id} realized return must be finite`);
      grossReturn += weight * realized;
      concentration += weight * weight;
    }

    const turnover = turnoverBetween(previousWeights, weights);
    const cost = turnover * period.turnoverCostRate;
    const netReturn = grossReturn - cost;
    equity *= 1 + netReturn;
    grossEquity *= 1 + grossReturn;
    peakEquity = Math.max(peakEquity, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peakEquity === 0 ? 0 : (peakEquity - equity) / peakEquity);
    totalCost += cost;
    totalTurnover += turnover;
    totalConcentration += concentration;
    totalBenchmarkExcess += netReturn - period.benchmarkReturn;
    totalWeightChange += turnover;
    if (previousPeriodIndex != null && !sameCandidateSet(previousWeights, weights)) candidateSetChanges += 1;
    for (const id of period.advisory.provenance.sourceDatasetIds) provenance.add(id);
    results.push(freeze({ periodIndex: period.periodIndex, candidateCount: weights.size, grossReturn, turnover, cost, netReturn, benchmarkExcess: netReturn - period.benchmarkReturn, concentration }));
    previousWeights = weights;
    previousPeriodIndex = period.periodIndex;
  }

  const periodCount = results.length;
  const cumulativeNetReturn = equity - 1;
  const cumulativeGrossReturn = grossEquity - 1;
  const reasons: string[] = ["PAPER_SHADOW_EVIDENCE_ONLY", "NO_EXECUTION_AUTHORITY"];
  if (periodCount < 30) reasons.push("NARROW_SHADOW_EVIDENCE_WINDOW");
  if (results.every((result) => result.candidateCount === 0)) reasons.push("NO_ALLOCATED_CANDIDATES");

  return freeze({
    schemaVersion: 1,
    evidenceMode: "PAPER_SHADOW",
    periodCount,
    periods: freeze(results),
    cumulativeNetReturn,
    cumulativeGrossReturn,
    totalCost,
    costDrag: cumulativeGrossReturn === 0 ? 0 : totalCost / Math.abs(cumulativeGrossReturn),
    maximumDrawdown,
    averageTurnover: totalTurnover / periodCount,
    averageConcentration: totalConcentration / periodCount,
    cumulativeBenchmarkExcess: totalBenchmarkExcess,
    allocationInstability: totalWeightChange / periodCount,
    candidateChurnRatio: periodCount < 2 ? 0 : candidateSetChanges / (periodCount - 1),
    reasons: freeze([...new Set(reasons)].sort()),
    sourceDatasetIds: freeze([...provenance].sort()),
  });
}
