import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import type { ResearchExperimentResult } from "./researchDataset";
import {
  validateResearchCandidateSpecification,
  type ResearchCandidateSpecification,
} from "./researchCandidateSpecification";
import { estimateProbabilityBacktestOverfitting, type PboCscvEvidence } from "./researchSearchAdjustedEvidence";

export class ResearchRunPboEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunPboEvidenceError";
  }
}

export interface ResearchRunPboCandidate {
  readonly id: string;
  readonly familyId: string;
  readonly experiment: ResearchExperimentResult;
  readonly candidateSpecification: ResearchCandidateSpecification;
}

export interface ResearchRunOosReturn {
  readonly timestamp: number;
  readonly value: number;
}

export interface ResearchRunPboEvidence extends PboCscvEvidence {
  readonly provenance: Readonly<{
    readonly schemaVersion: 1;
    readonly datasetId: string;
    readonly datasetContentSha256: string;
    readonly market: string;
    readonly interval: string;
    readonly candleCount: number;
    readonly startOpenTime: number;
    readonly endCloseTime: number;
    readonly candidateIds: readonly string[];
    readonly familyIds: readonly string[];
    readonly candidateSpecificationHashes: readonly string[];
    readonly candidateConfigurationSha256: string;
    readonly evaluationSha256: string;
    readonly oosTimestampSha256: string;
    readonly oosReturnMatrixSha256: string;
  }>;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const hashCanonical = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const PARTITION_PREFERENCE = Object.freeze([16, 14, 12, 10, 8, 6, 4] as const);

export function researchRunOosReturns(candidate: ResearchRunPboCandidate): readonly ResearchRunOosReturn[] {
  if (!candidate.id.trim()) throw new ResearchRunPboEvidenceError("INVALID_CANDIDATE_ID", "candidate id is required");
  const configured = candidate.experiment.experimentConfig.candidates;
  if (configured.length !== 1 || configured[0]?.id !== candidate.id) {
    throw new ResearchRunPboEvidenceError(
      "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH",
      `candidate ${candidate.id} must carry a single-candidate experiment for its own id`,
    );
  }

  const returns: ResearchRunOosReturn[] = [];
  let previousWindowEndTimestamp: number | undefined;
  for (const window of candidate.experiment.walkForwardResult.windows) {
    const curve = window.testResult.equityCurve;
    if (curve.length < 2) {
      throw new ResearchRunPboEvidenceError("INSUFFICIENT_OOS_EQUITY_POINTS", `candidate ${candidate.id} has an OOS window with fewer than two equity points`);
    }
    const firstTimestamp = curve[0]!.timestamp;
    if (!Number.isFinite(firstTimestamp)) {
      throw new ResearchRunPboEvidenceError("INVALID_OOS_TIMESTAMP", `candidate ${candidate.id} OOS equity timestamps must be finite`);
    }
    if (previousWindowEndTimestamp != null && firstTimestamp <= previousWindowEndTimestamp) {
      throw new ResearchRunPboEvidenceError("NON_MONOTONIC_OOS_WINDOWS", `candidate ${candidate.id} OOS windows must be strictly chronological and non-overlapping`);
    }
    for (let index = 1; index < curve.length; index += 1) {
      const prior = curve[index - 1]!;
      const current = curve[index]!;
      if (!Number.isFinite(prior.equity) || prior.equity <= 0 || !Number.isFinite(current.equity) || current.equity <= 0) {
        throw new ResearchRunPboEvidenceError("INVALID_OOS_EQUITY", `candidate ${candidate.id} OOS equity must be positive and finite`);
      }
      if (!Number.isFinite(prior.timestamp) || !Number.isFinite(current.timestamp) || current.timestamp <= prior.timestamp) {
        throw new ResearchRunPboEvidenceError("INVALID_OOS_TIMESTAMP", `candidate ${candidate.id} OOS equity timestamps must increase within each window`);
      }
      const value = current.equity / prior.equity - 1;
      if (!Number.isFinite(value)) throw new ResearchRunPboEvidenceError("NON_FINITE_OOS_RETURN", `candidate ${candidate.id} produced a non-finite OOS return`);
      returns.push(freeze({ timestamp: current.timestamp, value }));
    }
    previousWindowEndTimestamp = curve[curve.length - 1]!.timestamp;
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
export function buildResearchRunPboEvidence(candidates: readonly ResearchRunPboCandidate[]): ResearchRunPboEvidence {
  if (candidates.length < 2) throw new ResearchRunPboEvidenceError("INSUFFICIENT_CANDIDATES", "real-run PBO requires at least two candidates");
  const ids = candidates.map((candidate) => candidate.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new ResearchRunPboEvidenceError("INVALID_CANDIDATE_IDS", "candidate ids must be unique and non-empty");
  }

  const specificationHashes = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.familyId.trim()) {
      throw new ResearchRunPboEvidenceError("INVALID_FAMILY_ID", `candidate ${candidate.id} family id is required`);
    }
  }

  const firstManifest = candidates[0]!.experiment.manifest;
  const firstEvaluationSha256 = hashCanonical({
    walkForward: candidates[0]!.experiment.experimentConfig.walkForward,
    executionCosts: candidates[0]!.experiment.experimentConfig.executionCosts,
  });
  for (const candidate of candidates.slice(1)) {
    const manifest = candidate.experiment.manifest;
    if (
      manifest.datasetId !== firstManifest.datasetId
      || manifest.contentSha256 !== firstManifest.contentSha256
      || manifest.market !== firstManifest.market
      || manifest.interval !== firstManifest.interval
      || manifest.candleCount !== firstManifest.candleCount
      || manifest.startOpenTime !== firstManifest.startOpenTime
      || manifest.endCloseTime !== firstManifest.endCloseTime
    ) {
      throw new ResearchRunPboEvidenceError("DATASET_PROVENANCE_MISMATCH", "all PBO candidates must use the same verified dataset");
    }
    const evaluationSha256 = hashCanonical({
      walkForward: candidate.experiment.experimentConfig.walkForward,
      executionCosts: candidate.experiment.experimentConfig.executionCosts,
    });
    if (evaluationSha256 !== firstEvaluationSha256) {
      throw new ResearchRunPboEvidenceError("EVALUATION_PROVENANCE_MISMATCH", "all PBO candidates must use the same walk-forward and execution-cost policy");
    }
  }

  const series = candidates.map((candidate) => ({ id: candidate.id, returns: researchRunOosReturns(candidate) }));
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

  for (const candidate of candidates) {
    const specification = candidate.candidateSpecification;
    const decision = validateResearchCandidateSpecification(
      specification,
      Date.parse(specification.evaluationEndedAt),
    );
    const configured = candidate.experiment.experimentConfig.candidates;
    const manifest = candidate.experiment.manifest;
    if (
      decision.status !== "VERIFIED"
      || specification.candidateId !== candidate.id
      || specification.familyId !== candidate.familyId
      || specification.datasetId !== manifest.datasetId
      || specification.datasetContentSha256.toLowerCase() !== manifest.contentSha256.toLowerCase()
      || canonicalResearchJson(configured[0]?.parameters ?? {}) !== canonicalResearchJson(specification.parameters)
    ) {
      throw new ResearchRunPboEvidenceError(
        "CANDIDATE_SPECIFICATION_MISMATCH",
        `candidate ${candidate.id} PBO evidence must bind to its verified canonical specification`,
      );
    }
    specificationHashes.set(candidate.id, decision.specificationHash);
  }

  const candidateConfigurationSha256 = hashCanonical(
    candidates
      .map((candidate) => ({
        candidateId: candidate.id,
        familyId: candidate.familyId,
        specificationHash: specificationHashes.get(candidate.id),
        parameters: candidate.experiment.experimentConfig.candidates[0]?.parameters ?? null,
      }))
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
  );
  const partitions = choosePartitions(reference.length);
  const evidence = estimateProbabilityBacktestOverfitting({
    strategies: series.map((candidate) => ({
      strategyId: candidate.id,
      returns: Object.freeze(candidate.returns.map((entry) => entry.value)),
    })),
    partitions,
  });
  return freeze({
    ...evidence,
    provenance: freeze({
      schemaVersion: 1 as const,
      datasetId: firstManifest.datasetId,
      datasetContentSha256: firstManifest.contentSha256,
      market: firstManifest.market,
      interval: firstManifest.interval,
      candleCount: firstManifest.candleCount,
      startOpenTime: firstManifest.startOpenTime,
      endCloseTime: firstManifest.endCloseTime,
      candidateIds: freeze([...ids].sort()),
      familyIds: freeze([...new Set(candidates.map((candidate) => candidate.familyId))].sort()),
      candidateSpecificationHashes: freeze(
        candidates.map((candidate) => specificationHashes.get(candidate.id)!).sort(),
      ),
      candidateConfigurationSha256,
      evaluationSha256: firstEvaluationSha256,
      oosTimestampSha256: hashCanonical(reference.map((entry) => entry.timestamp)),
      oosReturnMatrixSha256: hashCanonical(
        series
          .map((candidate) => ({
            candidateId: candidate.id,
            returns: candidate.returns.map((entry) => ({ timestamp: entry.timestamp, value: entry.value })),
          }))
          .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
      ),
    }),
  });
}
