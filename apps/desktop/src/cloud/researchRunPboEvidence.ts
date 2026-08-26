import type { ResearchExperimentResult } from "./researchDataset";
import { estimateProbabilityBacktestOverfitting, type PboCscvEvidence } from "./researchSearchAdjustedEvidence";

export class ResearchRunPboEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunPboEvidenceError";
  }
}

export interface ResearchRunPboCandidate {
  readonly id: string;
  readonly experiment: ResearchExperimentResult;
}

interface TimestampedReturn {
  readonly timestamp: number;
  readonly value: number;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const PARTITION_PREFERENCE = Object.freeze([16, 14, 12, 10, 8, 6, 4] as const);

function oosReturns(candidate: ResearchRunPboCandidate): readonly TimestampedReturn[] {
  if (!candidate.id.trim()) throw new ResearchRunPboEvidenceError("INVALID_CANDIDATE_ID", "candidate id is required");
  const configured = candidate.experiment.experimentConfig.candidates;
  if (configured.length !== 1 || configured[0]?.id !== candidate.id) {
    throw new ResearchRunPboEvidenceError(
      "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH",
      `candidate ${candidate.id} must carry a single-candidate experiment for its own id`,
    );
  }

  const returns: TimestampedReturn[] = [];
  for (const window of candidate.experiment.walkForwardResult.windows) {
    const curve = window.testResult.equityCurve;
    if (curve.length < 2) {
      throw new ResearchRunPboEvidenceError("INSUFFICIENT_OOS_EQUITY_POINTS", `candidate ${candidate.id} has an OOS window with fewer than two equity points`);
    }
    for (let index = 1; index < curve.length; index += 1) {
      const prior = curve[index - 1]!;
      const current = curve[index]!;
      if (!Number.isFinite(prior.equity) || prior.equity <= 0 || !Number.isFinite(current.equity) || current.equity <= 0) {
        throw new ResearchRunPboEvidenceError("INVALID_OOS_EQUITY", `candidate ${candidate.id} OOS equity must be positive and finite`);
      }
      if (!Number.isFinite(current.timestamp) || current.timestamp <= prior.timestamp) {
        throw new ResearchRunPboEvidenceError("INVALID_OOS_TIMESTAMP", `candidate ${candidate.id} OOS equity timestamps must increase within each window`);
      }
      const value = current.equity / prior.equity - 1;
      if (!Number.isFinite(value)) throw new ResearchRunPboEvidenceError("NON_FINITE_OOS_RETURN", `candidate ${candidate.id} produced a non-finite OOS return`);
      returns.push(freeze({ timestamp: current.timestamp, value }));
    }
  }
  if (returns.length < 8) throw new ResearchRunPboEvidenceError("INSUFFICIENT_OOS_RETURN_POINTS", "real-run PBO requires at least eight OOS return observations");
  return Object.freeze(returns);
}

function choosePartitions(observationCount: number): number {
  const partitions = PARTITION_PREFERENCE.find((value) => observationCount % value === 0 && observationCount / value >= 2);
  if (partitions == null) {
    throw new ResearchRunPboEvidenceError(
      "NO_SYMMETRIC_CSCV_PARTITION",
      `OOS return count ${observationCount} cannot be partitioned into an even CSCV grid between 4 and 16`,
    );
  }
  return partitions;
}

/**
 * Builds search-level PBO evidence from the cost-aware OOS equity paths already produced by the
 * real walk-forward run. Training returns are never used. Window boundaries are never bridged:
 * each window resets its backtest equity, so the first point of a window is only a baseline and
 * no synthetic cross-window return is created.
 */
export function buildResearchRunPboEvidence(candidates: readonly ResearchRunPboCandidate[]): PboCscvEvidence {
  if (candidates.length < 2) throw new ResearchRunPboEvidenceError("INSUFFICIENT_CANDIDATES", "real-run PBO requires at least two candidates");
  const ids = candidates.map((candidate) => candidate.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new ResearchRunPboEvidenceError("INVALID_CANDIDATE_IDS", "candidate ids must be unique and non-empty");
  }

  const firstManifest = candidates[0]!.experiment.manifest;
  for (const candidate of candidates.slice(1)) {
    const manifest = candidate.experiment.manifest;
    if (manifest.datasetId !== firstManifest.datasetId || manifest.contentSha256 !== firstManifest.contentSha256) {
      throw new ResearchRunPboEvidenceError("DATASET_PROVENANCE_MISMATCH", "all PBO candidates must use the same verified dataset");
    }
  }

  const series = candidates.map((candidate) => ({ id: candidate.id, returns: oosReturns(candidate) }));
  const reference = series[0]!.returns;
  for (const candidate of series.slice(1)) {
    if (candidate.returns.length !== reference.length) {
      throw new ResearchRunPboEvidenceError("UNEQUAL_OOS_RETURN_LENGTHS", "all PBO candidates must have equal OOS return lengths");
    }
    for (let index = 0; index < reference.length; index += 1) {
      if (candidate.returns[index]!.timestamp !== reference[index]!.timestamp) {
        throw new ResearchRunPboEvidenceError("OOS_TIMESTAMP_ALIGNMENT_MISMATCH", "all PBO candidates must describe the same OOS timestamps");
      }
    }
  }

  const partitions = choosePartitions(reference.length);
  return estimateProbabilityBacktestOverfitting({
    strategies: series.map((candidate) => ({
      strategyId: candidate.id,
      returns: Object.freeze(candidate.returns.map((entry) => entry.value)),
    })),
    partitions,
  });
}
