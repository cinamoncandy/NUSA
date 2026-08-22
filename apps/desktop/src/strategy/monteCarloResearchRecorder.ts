import { checksum, createResearchRunManifest, validateMonteCarlo, type ResearchRunManifest, type ResearchValidationReport } from "../../../cloud/src/researchRunValidation";
import { runDeterministicMonteCarlo, type MonteCarloSimulationResult } from "../../../cloud/src/monteCarloResearch";
import { DesktopPersistenceStore } from "../persistence/desktopPersistenceStore";

export interface PersistMonteCarloResearchInput {
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameterSet: Readonly<Record<string, unknown>>;
  readonly datasetId: string;
  readonly datasetChecksum: string;
  readonly datasetStart: string;
  readonly datasetEnd: string;
  readonly codeVersion: string;
  readonly createdAt: string;
  readonly checkedAt: string;
  readonly returns: readonly number[];
  readonly pathCount: number;
  readonly horizon: number;
  readonly ruinThreshold: number;
  readonly maximumRuinProbability: number;
  readonly seed: string;
}

export interface PersistedMonteCarloResearch {
  readonly manifest: ResearchRunManifest;
  readonly report: ResearchValidationReport;
  readonly result: MonteCarloSimulationResult;
}

export function persistMonteCarloResearch(store: DesktopPersistenceStore, input: PersistMonteCarloResearchInput): PersistedMonteCarloResearch {
  const result = runDeterministicMonteCarlo({
    returns: input.returns,
    pathCount: input.pathCount,
    horizon: input.horizon,
    ruinThreshold: input.ruinThreshold,
    seed: input.seed
  });
  const runConfig = Object.freeze({
    pathCount: input.pathCount,
    horizon: input.horizon,
    ruinThreshold: input.ruinThreshold,
    maximumRuinProbability: input.maximumRuinProbability,
    returnsChecksum: checksum(input.returns),
    seedHash: result.seedHash
  });
  const manifest = createResearchRunManifest({
    runId: input.runId,
    runType: "MONTE_CARLO",
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameterSet: input.parameterSet,
    datasetId: input.datasetId,
    datasetChecksum: input.datasetChecksum,
    datasetStart: input.datasetStart,
    datasetEnd: input.datasetEnd,
    sampleCount: input.returns.length,
    createdAt: input.createdAt,
    codeVersion: input.codeVersion,
    config: runConfig,
    result
  });
  const report = validateMonteCarlo({
    runId: input.runId,
    checkedAt: input.checkedAt,
    pathCount: result.pathCount,
    horizon: result.horizon,
    ruinProbability: result.ruinProbability,
    maximumRuinProbability: input.maximumRuinProbability,
    seedHash: result.seedHash,
    result
  });
  store.appendResearchEvidence(manifest, report);
  return Object.freeze({ manifest, report, result });
}
