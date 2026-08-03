import {
  StrategyRegistry,
  type EntryRule,
  type GeneratedStrategy,
  type StrategyDsl,
  validateStrategy
} from "./aiStrategyEngine";
import {
  runDslBacktest,
  type BacktestCandle,
  type BacktestConfig,
  type BacktestDatasetIdentity,
  type BacktestMetrics,
  type BacktestReport
} from "./aiBacktestEngine";

export interface StrategyParameterGrid {
  readonly entryPrice?: readonly number[];
  readonly entryPeriod?: readonly number[];
  readonly entryThreshold?: readonly number[];
  readonly fastPeriod?: readonly number[];
  readonly slowPeriod?: readonly number[];
  readonly takeProfitPercent?: readonly number[];
  readonly stopLossPercent?: readonly number[];
  readonly timeoutMinutes?: readonly number[];
  readonly positionSizeValue?: readonly number[];
  readonly maxRiskPercent?: readonly number[];
  readonly maxPositionNotional?: readonly number[];
}

export interface OptimizerSplitConfig {
  readonly trainSize: number;
  readonly validationSize: number;
  readonly holdoutSize: number;
  readonly stepSize?: number;
}

export interface HoldoutGate {
  readonly minimumClosedTrades: number;
  readonly minimumReturn: number;
  readonly maximumDrawdown: number;
  readonly minimumProfitFactor: number;
}

export interface StrategyOptimizerConfig {
  readonly split: OptimizerSplitConfig;
  readonly holdout: HoldoutGate;
  readonly backtest?: BacktestConfig;
  readonly maxCandidates?: number;
}

export interface OptimizerParameterChange { readonly name: string; readonly value: number; }

export interface OptimizerWindowResult {
  readonly windowId: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly validationStart: number;
  readonly validationEnd: number;
  readonly trainMetrics: BacktestMetrics;
  readonly validationMetrics: BacktestMetrics;
}

export interface OptimizerCandidateSummary {
  readonly strategy: GeneratedStrategy;
  readonly parameters: readonly OptimizerParameterChange[];
  readonly trainMetrics: BacktestMetrics;
  readonly validationMetrics: BacktestMetrics;
  readonly windows: readonly OptimizerWindowResult[];
  readonly stability: number;
  readonly generalizationGap: number;
  readonly complexityPenalty: number;
  readonly score: number;
}

export interface PromotionCandidate {
  readonly strategyId: string;
  readonly version: string;
  readonly status: "PENDING_OWNER_APPROVAL";
  readonly requiresOwnerApproval: true;
  readonly ownerApproved: false;
  readonly existingStrategyReplaced: false;
  readonly holdoutMetrics: BacktestMetrics;
  readonly dataset: BacktestDatasetIdentity;
}

export interface StrategyOptimizerReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly strategy: Readonly<{ strategyId: string; version: string }>;
  readonly dataset: BacktestDatasetIdentity;
  readonly split: Readonly<OptimizerSplitConfig>;
  readonly candidates: readonly OptimizerCandidateSummary[];
  readonly selectedCandidate: OptimizerCandidateSummary;
  readonly holdout: Readonly<{ reportId: string; metrics: BacktestMetrics; passed: boolean }>;
  readonly promotionCandidate: PromotionCandidate | null;
  readonly safety: Readonly<{ researchOnly: true; paperOnly: true; liveMutationAllowed: false; holdoutRequired: true; existingStrategyReplaced: false }>;
}

export interface StrategyOptimizerRunRepository {
  hasDataset(dataset: BacktestDatasetIdentity): boolean;
  save(report: StrategyOptimizerReport): void;
  load(runId: string): StrategyOptimizerReport | null;
}

export class InMemoryStrategyOptimizerRunRepository implements StrategyOptimizerRunRepository {
  private readonly values = new Map<string, StrategyOptimizerReport>();

  hasDataset(dataset: BacktestDatasetIdentity): boolean {
    return [...this.values.values()].some((report) => report.dataset.version === dataset.version && report.dataset.checksum === dataset.checksum);
  }

  save(report: StrategyOptimizerReport): void { this.values.set(report.runId, report); }
  load(runId: string): StrategyOptimizerReport | null { return this.values.get(runId) ?? null; }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const DATASET_CHECKSUM = /^[a-f0-9]{64}$/i;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function validateDataset(dataset: BacktestDatasetIdentity): void {
  if (!dataset.version.trim()) throw new Error("dataset version is required");
  if (!DATASET_CHECKSUM.test(dataset.checksum)) throw new Error("dataset checksum must be SHA-256");
}

function validateGate(gate: HoldoutGate): void {
  if (!Number.isSafeInteger(gate.minimumClosedTrades) || gate.minimumClosedTrades < 1) throw new Error("minimumClosedTrades must be positive");
  if (!Number.isFinite(gate.minimumReturn)) throw new Error("minimumReturn must be finite");
  if (!Number.isFinite(gate.maximumDrawdown) || gate.maximumDrawdown < 0 || gate.maximumDrawdown > 1) throw new Error("maximumDrawdown is invalid");
  if (!Number.isFinite(gate.minimumProfitFactor) || gate.minimumProfitFactor < 0) throw new Error("minimumProfitFactor is invalid");
}

function valuesFor(name: string, values: readonly number[] | undefined, fallback: number): readonly number[] {
  const result = values ?? [fallback];
  if (result.length === 0 || result.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`invalid parameter grid: ${name}`);
  return [...result];
}

function product(dimensions: readonly { readonly name: string; readonly values: readonly number[] }[], maxCandidates: number): readonly OptimizerParameterChange[][] {
  const result: OptimizerParameterChange[][] = [[]];
  for (const dimension of dimensions) {
    const next: OptimizerParameterChange[][] = [];
    for (const existing of result) for (const value of dimension.values) {
      next.push([...existing, { name: dimension.name, value }]);
      if (next.length > maxCandidates) throw new Error("OPTIMIZER_CANDIDATE_LIMIT_EXCEEDED");
    }
    result.splice(0, result.length, ...next);
  }
  return result;
}

function exitValue(strategy: GeneratedStrategy, type: "TAKE_PROFIT" | "STOP_LOSS" | "TIMEOUT"): number {
  const exit = strategy.dsl.exits.find((item) => item.type === type);
  if (!exit) return 1;
  return exit.type === "TIMEOUT" ? exit.minutes : exit.percent;
}

function nextVersion(version: string, candidateIndex: number): string {
  const match = version.match(SEMVER);
  if (!match) throw new Error("base strategy version must be semver");
  return `${match[1]}.${match[2]}.${Number(match[3]) + candidateIndex + 1}`;
}

function applyParameters(strategy: GeneratedStrategy, parameters: readonly OptimizerParameterChange[], candidateIndex: number): GeneratedStrategy {
  const values = new Map(parameters.map((parameter) => [parameter.name, parameter.value]));
  const entry = strategy.dsl.entry;
  const nextEntry: EntryRule = entry.type === "PRICE_THRESHOLD"
    ? { ...entry, price: values.get("entryPrice") ?? entry.price }
    : entry.type === "RSI_THRESHOLD"
      ? { ...entry, period: values.get("entryPeriod") ?? entry.period, threshold: values.get("entryThreshold") ?? entry.threshold }
      : { ...entry, fastPeriod: values.get("fastPeriod") ?? entry.fastPeriod, slowPeriod: values.get("slowPeriod") ?? entry.slowPeriod };
  const exits = strategy.dsl.exits.map((exit) => {
    if (exit.type === "TAKE_PROFIT") return { ...exit, percent: values.get("takeProfitPercent") ?? exit.percent };
    if (exit.type === "STOP_LOSS") return { ...exit, percent: values.get("stopLossPercent") ?? exit.percent };
    return { ...exit, minutes: values.get("timeoutMinutes") ?? exit.minutes };
  });
  const dsl: StrategyDsl = {
    ...strategy.dsl,
    entry: nextEntry,
    exits,
    risk: {
      ...strategy.dsl.risk,
      positionSize: { ...strategy.dsl.risk.positionSize, value: values.get("positionSizeValue") ?? strategy.dsl.risk.positionSize.value },
      maxRiskPercent: values.get("maxRiskPercent") ?? strategy.dsl.risk.maxRiskPercent,
      maxPositionNotional: values.get("maxPositionNotional") ?? strategy.dsl.risk.maxPositionNotional
    }
  };
  const candidate: GeneratedStrategy = {
    ...strategy,
    version: nextVersion(strategy.version, candidateIndex),
    dsl,
    evidence: {
      ...strategy.evidence,
      generationReasons: [...strategy.evidence.generationReasons, `optimizer:candidate-${candidateIndex}`]
    }
  };
  const validation = validateStrategy(candidate);
  if (validation.status !== "VALIDATED" || !validation.strategy) throw new Error(`OPTIMIZER_CANDIDATE_INVALID:${validation.errors.join(",")}`);
  return validation.strategy;
}

export function generateStrategyCandidates(strategy: GeneratedStrategy, grid: StrategyParameterGrid, maxCandidates = 256): readonly GeneratedStrategy[] {
  if (strategy.status !== "VALIDATED") throw new Error("STRATEGY_NOT_VALIDATED");
  const dimensions: Array<{ name: string; values: readonly number[] }> = [];
  if (strategy.dsl.entry.type === "PRICE_THRESHOLD") dimensions.push({ name: "entryPrice", values: valuesFor("entryPrice", grid.entryPrice, strategy.dsl.entry.price) });
  if (strategy.dsl.entry.type === "RSI_THRESHOLD") {
    dimensions.push({ name: "entryPeriod", values: valuesFor("entryPeriod", grid.entryPeriod, strategy.dsl.entry.period) });
    dimensions.push({ name: "entryThreshold", values: valuesFor("entryThreshold", grid.entryThreshold, strategy.dsl.entry.threshold) });
  }
  if (strategy.dsl.entry.type === "SMA_CROSSOVER") {
    dimensions.push({ name: "fastPeriod", values: valuesFor("fastPeriod", grid.fastPeriod, strategy.dsl.entry.fastPeriod) });
    dimensions.push({ name: "slowPeriod", values: valuesFor("slowPeriod", grid.slowPeriod, strategy.dsl.entry.slowPeriod) });
  }
  if (strategy.dsl.exits.some((exit) => exit.type === "TAKE_PROFIT")) dimensions.push({ name: "takeProfitPercent", values: valuesFor("takeProfitPercent", grid.takeProfitPercent, exitValue(strategy, "TAKE_PROFIT")) });
  if (strategy.dsl.exits.some((exit) => exit.type === "STOP_LOSS")) dimensions.push({ name: "stopLossPercent", values: valuesFor("stopLossPercent", grid.stopLossPercent, exitValue(strategy, "STOP_LOSS")) });
  if (strategy.dsl.exits.some((exit) => exit.type === "TIMEOUT")) dimensions.push({ name: "timeoutMinutes", values: valuesFor("timeoutMinutes", grid.timeoutMinutes, exitValue(strategy, "TIMEOUT")) });
  dimensions.push({ name: "positionSizeValue", values: valuesFor("positionSizeValue", grid.positionSizeValue, strategy.dsl.risk.positionSize.value) });
  dimensions.push({ name: "maxRiskPercent", values: valuesFor("maxRiskPercent", grid.maxRiskPercent, strategy.dsl.risk.maxRiskPercent) });
  dimensions.push({ name: "maxPositionNotional", values: valuesFor("maxPositionNotional", grid.maxPositionNotional, strategy.dsl.risk.maxPositionNotional) });
  return product(dimensions, maxCandidates).map((parameters, index) => applyParameters(strategy, parameters, index));
}

function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function deviation(values: readonly number[]): number { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))); }

function aggregateMetrics(reports: readonly BacktestReport[]): BacktestMetrics {
  if (!reports.length) throw new Error("optimizer requires at least one report");
  const average = <K extends keyof BacktestMetrics>(key: K): number => mean(reports.map((report) => report.metrics[key] as number));
  const profitFactors = reports.map((report) => report.metrics.profitFactor).filter((value): value is number => value != null);
  const sharpes = reports.map((report) => report.metrics.sharpeRatio).filter((value): value is number => value != null);
  const sortinos = reports.map((report) => report.metrics.sortinoRatio).filter((value): value is number => value != null);
  const cagrs = reports.map((report) => report.metrics.cagr).filter((value): value is number => value != null);
  return Object.freeze({
    initialEquity: average("initialEquity"), finalEquity: average("finalEquity"), totalReturn: average("totalReturn"), winRate: average("winRate"),
    profitFactor: profitFactors.length ? mean(profitFactors) : null, sharpeRatio: sharpes.length ? mean(sharpes) : null,
    sortinoRatio: sortinos.length ? mean(sortinos) : null, cagr: cagrs.length ? mean(cagrs) : null,
    maxDrawdown: Math.max(...reports.map((report) => report.metrics.maxDrawdown)), tradeCount: reports.reduce((sum, report) => sum + report.metrics.tradeCount, 0),
    closedTradeCount: reports.reduce((sum, report) => sum + report.metrics.closedTradeCount, 0), feesPaid: reports.reduce((sum, report) => sum + report.metrics.feesPaid, 0),
    slippageCost: reports.reduce((sum, report) => sum + report.metrics.slippageCost, 0)
  });
}

function qualityScore(metrics: BacktestMetrics, stability: number, complexityPenalty: number): number {
  const profitFactor = metrics.profitFactor == null ? 0 : Math.min(metrics.profitFactor, 10);
  return metrics.totalReturn * 0.4 + (metrics.sharpeRatio ?? 0) * 0.05 + (metrics.sortinoRatio ?? 0) * 0.05 + profitFactor * 0.02 + metrics.winRate * 0.05 - metrics.maxDrawdown * 0.25 + stability * 0.05 - complexityPenalty;
}

function complexityPenalty(strategy: GeneratedStrategy, base: GeneratedStrategy): number {
  return changedParameters(base, strategy).length * 0.01;
}

function changedParameters(base: GeneratedStrategy, candidate: GeneratedStrategy): readonly OptimizerParameterChange[] {
  const changes: OptimizerParameterChange[] = [];
  const baseEntry = base.dsl.entry;
  const candidateEntry = candidate.dsl.entry;
  if (baseEntry.type === "PRICE_THRESHOLD" && candidateEntry.type === "PRICE_THRESHOLD" && baseEntry.price !== candidateEntry.price) changes.push({ name: "entryPrice", value: candidateEntry.price });
  if (baseEntry.type === "RSI_THRESHOLD" && candidateEntry.type === "RSI_THRESHOLD") {
    if (baseEntry.period !== candidateEntry.period) changes.push({ name: "entryPeriod", value: candidateEntry.period });
    if (baseEntry.threshold !== candidateEntry.threshold) changes.push({ name: "entryThreshold", value: candidateEntry.threshold });
  }
  if (baseEntry.type === "SMA_CROSSOVER" && candidateEntry.type === "SMA_CROSSOVER") {
    if (baseEntry.fastPeriod !== candidateEntry.fastPeriod) changes.push({ name: "fastPeriod", value: candidateEntry.fastPeriod });
    if (baseEntry.slowPeriod !== candidateEntry.slowPeriod) changes.push({ name: "slowPeriod", value: candidateEntry.slowPeriod });
  }
  const baseTake = base.dsl.exits.find((exit) => exit.type === "TAKE_PROFIT");
  const candidateTake = candidate.dsl.exits.find((exit) => exit.type === "TAKE_PROFIT");
  if (baseTake?.type === "TAKE_PROFIT" && candidateTake?.type === "TAKE_PROFIT" && baseTake.percent !== candidateTake.percent) changes.push({ name: "takeProfitPercent", value: candidateTake.percent });
  const baseStop = base.dsl.exits.find((exit) => exit.type === "STOP_LOSS");
  const candidateStop = candidate.dsl.exits.find((exit) => exit.type === "STOP_LOSS");
  if (baseStop?.type === "STOP_LOSS" && candidateStop?.type === "STOP_LOSS" && baseStop.percent !== candidateStop.percent) changes.push({ name: "stopLossPercent", value: candidateStop.percent });
  const baseTimeout = base.dsl.exits.find((exit) => exit.type === "TIMEOUT");
  const candidateTimeout = candidate.dsl.exits.find((exit) => exit.type === "TIMEOUT");
  if (baseTimeout?.type === "TIMEOUT" && candidateTimeout?.type === "TIMEOUT" && baseTimeout.minutes !== candidateTimeout.minutes) changes.push({ name: "timeoutMinutes", value: candidateTimeout.minutes });
  if (base.dsl.risk.positionSize.value !== candidate.dsl.risk.positionSize.value) changes.push({ name: "positionSizeValue", value: candidate.dsl.risk.positionSize.value });
  if (base.dsl.risk.maxRiskPercent !== candidate.dsl.risk.maxRiskPercent) changes.push({ name: "maxRiskPercent", value: candidate.dsl.risk.maxRiskPercent });
  if (base.dsl.risk.maxPositionNotional !== candidate.dsl.risk.maxPositionNotional) changes.push({ name: "maxPositionNotional", value: candidate.dsl.risk.maxPositionNotional });
  return freeze(changes);
}

function runWindow(strategy: GeneratedStrategy, registry: StrategyRegistry, candles: readonly BacktestCandle[], dataset: BacktestDatasetIdentity, config: BacktestConfig | undefined, windowId: number, trainStart: number, trainSize: number, validationSize: number): OptimizerWindowResult {
  const trainEnd = trainStart + trainSize;
  const validationEnd = trainEnd + validationSize;
  const trainReport = runDslBacktest({ candles: candles.slice(trainStart, trainEnd), dataset, strategy, registry, config });
  const validationReport = runDslBacktest({ candles: candles.slice(trainEnd, validationEnd), dataset, strategy, registry, config });
  return freeze({ windowId, trainStart, trainEnd, validationStart: trainEnd, validationEnd, trainMetrics: trainReport.metrics, validationMetrics: validationReport.metrics });
}

function holdoutPassed(metrics: BacktestMetrics, gate: HoldoutGate): boolean {
  const profitFactor = metrics.profitFactor ?? (metrics.closedTradeCount > 0 ? Number.POSITIVE_INFINITY : 0);
  return metrics.closedTradeCount >= gate.minimumClosedTrades && metrics.totalReturn >= gate.minimumReturn && metrics.maxDrawdown <= gate.maximumDrawdown && profitFactor >= gate.minimumProfitFactor;
}

export function runStrategyOptimization(input: {
  readonly candles: readonly BacktestCandle[];
  readonly dataset: BacktestDatasetIdentity;
  readonly strategy: GeneratedStrategy;
  readonly registry: StrategyRegistry;
  readonly parameterGrid: StrategyParameterGrid;
  readonly config: StrategyOptimizerConfig;
  readonly repository: StrategyOptimizerRunRepository;
}): StrategyOptimizerReport {
  validateDataset(input.dataset);
  validateGate(input.config.holdout);
  if (input.repository.hasDataset(input.dataset)) throw new Error("OPTIMIZER_DATASET_REUSE_BLOCKED");
  const registered = input.registry.get(input.strategy.strategyId, input.strategy.version);
  if (!registered || registered.status !== "VALIDATED") throw new Error("STRATEGY_NOT_REGISTERED");
  if (registered.paperOnly !== true || registered.productionMutationAllowed !== false || registered.executionAllowed !== false) throw new Error("PAPER_BOUNDARY_INVALID");
  const split = input.config.split;
  assertInteger(split.trainSize, "trainSize"); assertInteger(split.validationSize, "validationSize"); assertInteger(split.holdoutSize, "holdoutSize");
  const stepSize = split.stepSize ?? split.validationSize; assertInteger(stepSize, "stepSize");
  const available = input.candles.length - split.holdoutSize;
  if (available < split.trainSize + split.validationSize || input.candles.length < 2) throw new Error("OPTIMIZER_DATASET_TOO_SMALL");
  const windows: Array<{ readonly id: number; readonly start: number }> = [];
  for (let start = 0; start + split.trainSize + split.validationSize <= available; start += stepSize) windows.push({ id: windows.length, start });
  if (!windows.length) throw new Error("OPTIMIZER_NO_WALK_FORWARD_WINDOWS");
  const candidates = generateStrategyCandidates(registered, input.parameterGrid, input.config.maxCandidates ?? 256);
  const candidateRegistry = new StrategyRegistry();
  const summaries = candidates.map((candidate) => {
    const registeredCandidate = candidateRegistry.register(candidate);
    const windowResults = windows.map((window) => runWindow(registeredCandidate, candidateRegistry, input.candles, input.dataset, input.config.backtest, window.id, window.start, split.trainSize, split.validationSize));
    const trainMetrics = aggregateMetrics(windowResults.map((window) => ({ metrics: window.trainMetrics } as BacktestReport)));
    const validationMetrics = aggregateMetrics(windowResults.map((window) => ({ metrics: window.validationMetrics } as BacktestReport)));
    const stability = Math.max(0, Math.min(1, 1 - deviation(windowResults.map((window) => window.validationMetrics.totalReturn))));
    const generalizationGap = Math.abs(trainMetrics.totalReturn - validationMetrics.totalReturn);
    const penalty = complexityPenalty(registeredCandidate, registered);
    return freeze({ strategy: registeredCandidate, parameters: changedParameters(registered, registeredCandidate), trainMetrics, validationMetrics, windows: freeze(windowResults), stability, generalizationGap, complexityPenalty: penalty, score: qualityScore(validationMetrics, stability, penalty) - generalizationGap * 0.2 });
  }).sort((left, right) => right.score - left.score || left.strategy.version.localeCompare(right.strategy.version));
  const selectedCandidate = summaries[0];
  if (!selectedCandidate) throw new Error("OPTIMIZER_NO_CANDIDATES");
  const holdoutStart = input.candles.length - split.holdoutSize;
  const selectedRegistry = new StrategyRegistry();
  const selectedRegistered = selectedRegistry.register(selectedCandidate.strategy);
  const holdoutReport = runDslBacktest({ candles: input.candles.slice(holdoutStart), dataset: input.dataset, strategy: selectedRegistered, registry: selectedRegistry, config: input.config.backtest });
  const passed = holdoutPassed(holdoutReport.metrics, input.config.holdout);
  const promotionCandidate: PromotionCandidate | null = passed ? freeze({ strategyId: selectedRegistered.strategyId, version: selectedRegistered.version, status: "PENDING_OWNER_APPROVAL", requiresOwnerApproval: true, ownerApproved: false, existingStrategyReplaced: false, holdoutMetrics: holdoutReport.metrics, dataset: freeze({ ...input.dataset }) }) : null;
  const runId = `optimizer:${registered.strategyId}:${registered.version}:${input.dataset.version}`;
  const report = freeze({
    schemaVersion: 1 as const, runId, strategy: freeze({ strategyId: registered.strategyId, version: registered.version }), dataset: freeze({ ...input.dataset }), split: freeze({ ...split, stepSize }),
    candidates: freeze(summaries), selectedCandidate, holdout: freeze({ reportId: holdoutReport.reportId, metrics: holdoutReport.metrics, passed }), promotionCandidate,
    safety: freeze({ researchOnly: true, paperOnly: true, liveMutationAllowed: false, holdoutRequired: true, existingStrategyReplaced: false } as const)
  });
  input.repository.save(report);
  return report;
}
