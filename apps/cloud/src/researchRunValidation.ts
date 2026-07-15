import { createHash } from "node:crypto";

export type ResearchRunType = "WALK_FORWARD" | "COST_STRESS" | "MONTE_CARLO" | "INTEGRITY_CHECK";
export type ResearchRunStatus = "PASS" | "FAIL";

export interface ResearchRunManifest {
  readonly runId: string;
  readonly runType: ResearchRunType;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameterSet: Readonly<Record<string, unknown>>;
  readonly parameterChecksum: string;
  readonly datasetId: string;
  readonly datasetChecksum: string;
  readonly datasetStart: string;
  readonly datasetEnd: string;
  readonly sampleCount: number;
  readonly createdAt: string;
  readonly codeVersion: string;
  readonly configChecksum: string;
  readonly resultChecksum: string;
  readonly manifestChecksum: string;
}

export interface ResearchValidationReport {
  readonly runId: string;
  readonly runType: ResearchRunType;
  readonly status: ResearchRunStatus;
  readonly reasons: readonly string[];
  readonly checkedAt: string;
  readonly resultChecksum: string;
}

export interface WalkForwardValidationInput {
  readonly runId: string;
  readonly checkedAt: string;
  readonly windows: readonly {
    readonly trainStart: string;
    readonly trainEnd: string;
    readonly testStart: string;
    readonly testEnd: string;
    readonly trainSampleCount: number;
    readonly testSampleCount: number;
    readonly complete: boolean;
    readonly outOfSample: boolean;
    readonly metrics: Readonly<Record<string, number>>;
  }[];
  readonly minimumFolds: number;
  readonly result: unknown;
  readonly includesCosts: boolean;
  readonly parameterSelectionFrozen: boolean;
}

export interface CostStressValidationInput {
  readonly runId: string;
  readonly checkedAt: string;
  readonly baselineScenarioId: string;
  readonly scenarios: readonly {
    readonly scenarioId: string;
    readonly result: unknown;
    readonly status: ResearchRunStatus;
    readonly costLoadBps: number;
    readonly netReturn: number;
    readonly totalCost: number;
  }[];
  readonly result: unknown;
}

export interface MonteCarloValidationInput {
  readonly runId: string;
  readonly checkedAt: string;
  readonly pathCount: number;
  readonly horizon: number;
  readonly ruinProbability: number;
  readonly maximumRuinProbability: number;
  readonly seedHash: string;
  readonly result: unknown;
}

export interface IntegrityValidationInput {
  readonly runId: string;
  readonly checkedAt: string;
  readonly eventIds: readonly string[];
  readonly sequenceNumbers: readonly number[];
  readonly eventTypes: readonly string[];
  readonly expectedEventTypes: readonly string[];
  readonly replayedCounters: Readonly<Record<string, number>>;
  readonly persistedCounters: Readonly<Record<string, number>>;
  readonly referencedRunIds: readonly string[];
  readonly manifests: readonly ResearchRunManifest[];
  readonly result: unknown;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const iso = (value: string): boolean => Number.isFinite(Date.parse(value));
const sha256Pattern = /^[a-f0-9]{64}$/i;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported value in canonical serialization");
}

export function canonicalResearchJson(value: unknown): string { return canonical(value); }
export function checksum(value: unknown): string { return sha256(canonical(value)); }

function required(value: string, field: string): void { if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`); }
function report(runId: string, runType: ResearchRunType, checkedAt: string, reasons: readonly string[], result: unknown): ResearchValidationReport {
  required(runId, "runId");
  if (!iso(checkedAt)) throw new Error("checkedAt must be an ISO timestamp");
  return freeze({ runId, runType, status: reasons.length === 0 ? "PASS" : "FAIL", reasons: Object.freeze([...reasons]), checkedAt, resultChecksum: checksum(result) });
}

export function createResearchRunManifest(input: Omit<ResearchRunManifest, "parameterChecksum" | "configChecksum" | "resultChecksum" | "manifestChecksum"> & { readonly config: unknown; readonly result: unknown }): ResearchRunManifest {
  required(input.runId, "runId"); required(input.strategyId, "strategyId"); required(input.strategyVersion, "strategyVersion"); required(input.datasetId, "datasetId"); required(input.codeVersion, "codeVersion");
  if (!iso(input.datasetStart) || !iso(input.datasetEnd) || Date.parse(input.datasetStart) >= Date.parse(input.datasetEnd)) throw new Error("dataset range is invalid");
  if (!iso(input.createdAt) || !Number.isInteger(input.sampleCount) || input.sampleCount <= 0) throw new Error("manifest sample count or timestamp is invalid");
  if (!sha256Pattern.test(input.datasetChecksum)) throw new Error("datasetChecksum must be SHA-256");
  const base = { ...input, parameterChecksum: checksum(input.parameterSet), configChecksum: checksum(input.config), resultChecksum: checksum(input.result) };
  return freeze({ ...base, manifestChecksum: sha256(canonical(base)) });
}

export function validateResearchRunManifest(manifest: ResearchRunManifest): void {
  const base = { ...manifest };
  delete (base as { manifestChecksum?: string }).manifestChecksum;
  if (!sha256Pattern.test(manifest.parameterChecksum) || !sha256Pattern.test(manifest.configChecksum) || !sha256Pattern.test(manifest.resultChecksum) || manifest.manifestChecksum !== sha256(canonical(base))) throw new Error("research manifest checksum mismatch");
}

export function validateWalkForward(input: WalkForwardValidationInput): ResearchValidationReport {
  const reasons: string[] = [];
  if (!Number.isInteger(input.minimumFolds) || input.minimumFolds < 1) reasons.push("INVALID_MINIMUM_FOLDS");
  if (input.windows.length < input.minimumFolds) reasons.push("INSUFFICIENT_FOLDS");
  let priorTestEnd = Number.NEGATIVE_INFINITY;
  for (const [index, fold] of input.windows.entries()) {
    const trainEnd = Date.parse(fold.trainEnd); const testStart = Date.parse(fold.testStart); const testEnd = Date.parse(fold.testEnd);
    if (!iso(fold.trainStart) || !iso(fold.trainEnd) || !iso(fold.testStart) || !iso(fold.testEnd) || trainEnd >= testStart || testStart >= testEnd || testStart <= priorTestEnd) reasons.push(`FOLD_${index}_TIME_INVALID`);
    if (!Number.isInteger(fold.trainSampleCount) || fold.trainSampleCount <= 0 || !Number.isInteger(fold.testSampleCount) || fold.testSampleCount <= 0) reasons.push(`FOLD_${index}_SAMPLE_INVALID`);
    if (!fold.complete) reasons.push(`FOLD_${index}_INCOMPLETE`);
    if (!fold.outOfSample) reasons.push(`FOLD_${index}_NOT_OUT_OF_SAMPLE`);
    if (Object.values(fold.metrics).some((value) => !Number.isFinite(value))) reasons.push(`FOLD_${index}_NON_FINITE`);
    priorTestEnd = testEnd;
  }
  if (!input.includesCosts) reasons.push("COSTS_NOT_INCLUDED");
  if (!input.parameterSelectionFrozen) reasons.push("PARAMETER_SELECTION_NOT_FROZEN");
  return report(input.runId, "WALK_FORWARD", input.checkedAt, reasons, input.result);
}

export function validateCostStress(input: CostStressValidationInput): ResearchValidationReport {
  const reasons: string[] = [];
  if (!input.scenarios.some((scenario) => scenario.scenarioId === input.baselineScenarioId)) reasons.push("BASELINE_SCENARIO_MISSING");
  const ids = new Set<string>();
  for (const scenario of input.scenarios) {
    if (ids.has(scenario.scenarioId)) reasons.push(`DUPLICATE_SCENARIO_${scenario.scenarioId}`);
    ids.add(scenario.scenarioId);
    if (scenario.status !== "PASS") reasons.push(`SCENARIO_${scenario.scenarioId}_FAILED`);
    if (!Number.isFinite(scenario.costLoadBps) || !Number.isFinite(scenario.netReturn) || !Number.isFinite(scenario.totalCost)) reasons.push(`SCENARIO_${scenario.scenarioId}_NON_FINITE`);
  }
  if (input.scenarios.length < 2) reasons.push("INSUFFICIENT_STRESS_SCENARIOS");
  return report(input.runId, "COST_STRESS", input.checkedAt, reasons, input.result);
}

export function validateMonteCarlo(input: MonteCarloValidationInput): ResearchValidationReport {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(input.pathCount) || input.pathCount < 100) reasons.push("INSUFFICIENT_MONTE_CARLO_PATHS");
  if (!Number.isSafeInteger(input.horizon) || input.horizon < 1) reasons.push("INVALID_MONTE_CARLO_HORIZON");
  if (!Number.isFinite(input.ruinProbability) || input.ruinProbability < 0 || input.ruinProbability > 1) reasons.push("INVALID_RUIN_PROBABILITY");
  if (!Number.isFinite(input.maximumRuinProbability) || input.maximumRuinProbability < 0 || input.maximumRuinProbability > 1) reasons.push("INVALID_RUIN_THRESHOLD");
  else if (Number.isFinite(input.ruinProbability) && input.ruinProbability > input.maximumRuinProbability) reasons.push("RUIN_PROBABILITY_ABOVE_THRESHOLD");
  if (!sha256Pattern.test(input.seedHash)) reasons.push("INVALID_MONTE_CARLO_SEED_HASH");
  return report(input.runId, "MONTE_CARLO", input.checkedAt, reasons, input.result);
}

export function validateIntegrity(input: IntegrityValidationInput): ResearchValidationReport {
  const reasons: string[] = [];
  if (input.eventIds.length !== new Set(input.eventIds).size) reasons.push("DUPLICATE_EVENT_ID");
  for (let index = 1; index < input.sequenceNumbers.length; index += 1) if (input.sequenceNumbers[index] !== input.sequenceNumbers[index - 1] + 1) reasons.push("SEQUENCE_GAP");
  for (const eventType of input.eventTypes) if (!input.expectedEventTypes.includes(eventType)) reasons.push(`UNKNOWN_EVENT_TYPE_${eventType}`);
  if (canonical(input.replayedCounters) !== canonical(input.persistedCounters)) reasons.push("COUNTER_REPLAY_MISMATCH");
  const manifestIds = new Set(input.manifests.map((manifest) => manifest.runId));
  for (const runId of input.referencedRunIds) if (!manifestIds.has(runId)) reasons.push(`ORPHAN_RUN_${runId}`);
  for (const manifest of input.manifests) try { validateResearchRunManifest(manifest); } catch { reasons.push(`MANIFEST_CHECKSUM_INVALID_${manifest.runId}`); }
  return report(input.runId, "INTEGRITY_CHECK", input.checkedAt, reasons, input.result);
}

export function allResearchGatesPassed(reports: readonly ResearchValidationReport[]): boolean {
  const requiredTypes = new Set<ResearchRunType>(["WALK_FORWARD", "COST_STRESS", "MONTE_CARLO", "INTEGRITY_CHECK"]);
  return reports.length === requiredTypes.size && reports.every((item) => item.status === "PASS") && reports.every((item) => requiredTypes.has(item.runType));
}
