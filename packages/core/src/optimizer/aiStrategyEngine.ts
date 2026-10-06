export type StrategyStatus = "DRAFT" | "VALIDATED" | "REJECTED";
export type EntryRule =
  | { readonly type: "SMA_CROSSOVER"; readonly fastPeriod: number; readonly slowPeriod: number; readonly direction: "ABOVE" | "BELOW" }
  | { readonly type: "RSI_THRESHOLD"; readonly period: number; readonly operator: "BELOW"; readonly threshold: number }
  | { readonly type: "PRICE_THRESHOLD"; readonly operator: "ABOVE"; readonly price: number };
export type ExitRule =
  | { readonly type: "TAKE_PROFIT"; readonly percent: number }
  | { readonly type: "STOP_LOSS"; readonly percent: number }
  | { readonly type: "TIMEOUT"; readonly minutes: number };

export interface StrategyDsl {
  readonly entry: EntryRule;
  readonly exits: readonly ExitRule[];
  readonly risk: {
    readonly positionSize: { readonly mode: "PERCENT_OF_EQUITY" | "FIXED_NOTIONAL"; readonly value: number };
    readonly maxRiskPercent: number;
    readonly maxPositionNotional: number;
  };
  readonly scope: { readonly symbols: readonly string[]; readonly regimes: readonly string[] };
}

export interface StrategyGenerationEvidence {
  readonly sourceText: string;
  readonly generationReasons: readonly string[];
  readonly datasetVersion?: string;
  readonly datasetChecksum?: string;
}

export interface GeneratedStrategy {
  readonly strategyId: string;
  readonly name: string;
  readonly version: string;
  readonly status: StrategyStatus;
  readonly dsl: StrategyDsl;
  readonly evidence: StrategyGenerationEvidence;
  readonly createdAt: number;
  readonly paperOnly: true;
  readonly productionMutationAllowed: false;
  readonly executionAllowed: false;
}

export interface StrategyParseOptions {
  readonly strategyId?: string;
  readonly name?: string;
  readonly version?: string;
  readonly now?: number;
  readonly datasetVersion?: string;
  readonly datasetChecksum?: string;
}

export interface StrategyParseResult {
  readonly status: "DRAFT" | "REJECTED";
  readonly strategy?: GeneratedStrategy;
  readonly errors: readonly string[];
}

export interface StrategyValidationResult {
  readonly status: "VALIDATED" | "REJECTED";
  readonly strategy?: GeneratedStrategy;
  readonly errors: readonly string[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const checksum = /^[a-f0-9]{64}$/i;
const symbolPattern = /^[A-Z0-9]+-[A-Z0-9]+$/;
const unsupported = /\b(?:live|real\s+trading|withdraw|withdrawal)\b|실거래|출금/i;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalSymbol(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.includes("/") ? trimmed.split("/").reverse().join("-") : trimmed;
}

function numberAfter(pattern: RegExp, text: string): number | undefined {
  const match = text.match(pattern);
  return match ? Number(match[1]) : undefined;
}

function knownRegime(text: string): string | undefined {
  const entries: readonly [RegExp, string][] = [
    [/strong\s+uptrend|weak\s+uptrend|uptrend|상승/, "UPTREND"],
    [/strong\s+downtrend|weak\s+downtrend|downtrend|하락/, "DOWNTREND"],
    [/high\s+volatility|고변동/, "HIGH_VOLATILITY"],
    [/low\s+volatility|저변동/, "LOW_VOLATILITY"],
    [/sideways|횡보/, "SIDEWAYS"]
  ];
  return entries.find(([pattern]) => pattern.test(text))?.[1];
}

function freezeStrategy(strategy: GeneratedStrategy): GeneratedStrategy {
  const dsl = freeze({
    entry: freeze({ ...strategy.dsl.entry }),
    exits: freeze(strategy.dsl.exits.map((exit) => freeze({ ...exit }))),
    risk: freeze({ positionSize: freeze({ ...strategy.dsl.risk.positionSize }), maxRiskPercent: strategy.dsl.risk.maxRiskPercent, maxPositionNotional: strategy.dsl.risk.maxPositionNotional }),
    scope: freeze({ symbols: freeze([...strategy.dsl.scope.symbols]), regimes: freeze([...strategy.dsl.scope.regimes]) })
  });
  const evidence = freeze({ ...strategy.evidence, generationReasons: freeze([...strategy.evidence.generationReasons]) });
  return freeze({ ...strategy, dsl, evidence });
}

export function parseNaturalLanguageStrategy(sourceText: string, options: StrategyParseOptions = {}): StrategyParseResult {
  const text = sourceText.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const errors: string[] = [];
  if (!text) errors.push("SOURCE_TEXT_REQUIRED");
  if (unsupported.test(text)) errors.push("LIVE_MUTATION_LANGUAGE_UNSUPPORTED");
  const symbolMatch = text.match(/\b([A-Za-z0-9]+[-/][A-Za-z0-9]+)\b/);
  const symbol = symbolMatch ? canonicalSymbol(symbolMatch[1]!) : undefined;
  if (!symbol) errors.push("SYMBOL_REQUIRED");
  const regime = knownRegime(lower);
  if (!regime) errors.push("REGIME_REQUIRED");

  let entry: EntryRule | undefined;
  const sma = lower.match(/sma\s*(\d+)\s*cross(?:es|ed|over)?\s*(above|below)\s*sma\s*(\d+)/i);
  if (sma) entry = { type: "SMA_CROSSOVER", fastPeriod: Number(sma[1]), direction: sma[2]!.toUpperCase() as "ABOVE" | "BELOW", slowPeriod: Number(sma[3]) };
  const rsiMatch = lower.match(/rsi\s*(\d+)?\s*(?:below|<|이하)\s*(\d+(?:\.\d+)?)/i);
  if (!entry && rsiMatch) entry = { type: "RSI_THRESHOLD", period: Number(rsiMatch[1] ?? 14), operator: "BELOW", threshold: Number(rsiMatch[2]) };
  const price = numberAfter(/price\s*(?:above|>|돌파)\s*(\d+(?:\.\d+)?)/i, lower);
  if (!entry && price !== undefined) entry = { type: "PRICE_THRESHOLD", operator: "ABOVE", price };
  if (!entry) errors.push("ENTRY_RULE_UNSUPPORTED");

  const takeProfit = numberAfter(/(?:take[- ]?profit|익절)\s*(?:at|of|=|은|\s)*\s*(\d+(?:\.\d+)?)\s*%?/i, lower);
  const stopLoss = numberAfter(/(?:stop[- ]?loss|손절)\s*(?:at|of|=|은|\s)*\s*(\d+(?:\.\d+)?)\s*%?/i, lower);
  const exits: ExitRule[] = [];
  if (takeProfit !== undefined) exits.push({ type: "TAKE_PROFIT", percent: takeProfit });
  if (stopLoss !== undefined) exits.push({ type: "STOP_LOSS", percent: stopLoss });
  const timeout = numberAfter(/(?:timeout|hold(?:ing)?\s+for|시간초과)\s*(?:at|of|=|은|\s)*\s*(\d+(?:\.\d+)?)\s*(?:minutes?|분)?/i, lower);
  if (timeout !== undefined) exits.push({ type: "TIMEOUT", minutes: timeout });
  if (takeProfit === undefined) errors.push("TAKE_PROFIT_REQUIRED");
  if (stopLoss === undefined) errors.push("STOP_LOSS_REQUIRED");

  const risk = numberAfter(/(?:risk|리스크)\s*(?:of|=|은)?\s*(\d+(?:\.\d+)?)\s*%/i, lower);
  const positionPercent = numberAfter(/(?:position\s*size|포지션\s*크기)\s*(?:of|=|은)?\s*(\d+(?:\.\d+)?)\s*%/i, lower);
  const positionNotional = numberAfter(/(?:position\s*size|포지션\s*크기)\s*(?:of|=|은)?\s*(?:krw\s*)?(\d+(?:\.\d+)?)/i, lower);
  const maxPosition = numberAfter(/(?:max(?:imum)?\s*position|max\s*notional)\s*(?:of|=)?\s*(?:krw\s*)?(\d+(?:\.\d+)?)/i, lower);
  if (risk === undefined) errors.push("RISK_PERCENT_REQUIRED");
  if (positionPercent === undefined && positionNotional === undefined) errors.push("POSITION_SIZE_REQUIRED");
  if (maxPosition === undefined) errors.push("MAX_POSITION_REQUIRED");
  if (errors.length) return freeze({ status: "REJECTED", errors: freeze(errors) });

  const normalized = lower;
  const strategy: GeneratedStrategy = {
    strategyId: options.strategyId ?? `nl-${stableHash(normalized)}`,
    name: options.name?.trim() || "Generated Paper Strategy",
    version: options.version ?? "1.0.0",
    status: "DRAFT",
    dsl: { entry: entry!, exits, risk: { positionSize: positionPercent !== undefined ? { mode: "PERCENT_OF_EQUITY", value: positionPercent } : { mode: "FIXED_NOTIONAL", value: positionNotional! }, maxRiskPercent: risk!, maxPositionNotional: maxPosition! }, scope: { symbols: [symbol!], regimes: [regime!] } },
    evidence: { sourceText: text, generationReasons: ["deterministic-restricted-parser", `entry:${entry!.type}`, `exit:${exits.map((exit) => exit.type).join(",")}`, `scope:${symbol}:${regime}`, ...(options.datasetVersion ? [`dataset:${options.datasetVersion}`] : [])], datasetVersion: options.datasetVersion, datasetChecksum: options.datasetChecksum },
    createdAt: options.now ?? 0,
    paperOnly: true,
    productionMutationAllowed: false,
    executionAllowed: false
  };
  return freeze({ status: "DRAFT", strategy: freezeStrategy(strategy), errors: freeze([]) });
}

export function validateStrategy(strategy: GeneratedStrategy): StrategyValidationResult {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(strategy.strategyId)) errors.push("STRATEGY_ID_INVALID");
  if (!strategy.name.trim()) errors.push("NAME_REQUIRED");
  if (!semver.test(strategy.version)) errors.push("VERSION_INVALID");
  if (!Number.isSafeInteger(strategy.createdAt) || strategy.createdAt < 0) errors.push("CREATED_AT_INVALID");
  if (strategy.paperOnly !== true || strategy.productionMutationAllowed !== false || strategy.executionAllowed !== false) errors.push("PAPER_BOUNDARY_INVALID");
  if (!strategy.evidence.sourceText.trim() || strategy.evidence.generationReasons.length === 0) errors.push("GENERATION_EVIDENCE_REQUIRED");
  if ((strategy.evidence.datasetVersion && !strategy.evidence.datasetChecksum) || (!strategy.evidence.datasetVersion && strategy.evidence.datasetChecksum) || (strategy.evidence.datasetChecksum && !checksum.test(strategy.evidence.datasetChecksum))) errors.push("DATASET_EVIDENCE_INVALID");
  const { entry, exits, risk, scope } = strategy.dsl;
  if (entry.type === "SMA_CROSSOVER" && (!Number.isInteger(entry.fastPeriod) || !Number.isInteger(entry.slowPeriod) || entry.fastPeriod <= 0 || entry.fastPeriod >= entry.slowPeriod)) errors.push("SMA_PERIODS_INVALID");
  if (entry.type === "RSI_THRESHOLD" && (!Number.isInteger(entry.period) || entry.period <= 0 || entry.threshold <= 0 || entry.threshold >= 100)) errors.push("RSI_RULE_INVALID");
  if (entry.type === "PRICE_THRESHOLD" && !finitePositive(entry.price)) errors.push("PRICE_RULE_INVALID");
  if (!exits.some((exit) => exit.type === "TAKE_PROFIT" && finitePositive(exit.percent))) errors.push("TAKE_PROFIT_INVALID");
  if (!exits.some((exit) => exit.type === "STOP_LOSS" && finitePositive(exit.percent) && exit.percent <= 100)) errors.push("STOP_LOSS_INVALID");
  if (!finitePositive(risk.maxRiskPercent) || risk.maxRiskPercent > 100) errors.push("MAX_RISK_INVALID");
  if (!finitePositive(risk.maxPositionNotional)) errors.push("MAX_POSITION_INVALID");
  if (!finitePositive(risk.positionSize.value) || (risk.positionSize.mode === "PERCENT_OF_EQUITY" && risk.positionSize.value > 100)) errors.push("POSITION_SIZE_INVALID");
  if (scope.symbols.length === 0 || scope.symbols.some((symbol) => !symbolPattern.test(symbol))) errors.push("SYMBOL_SCOPE_INVALID");
  if (scope.regimes.length === 0 || scope.regimes.some((regime) => !regime.trim())) errors.push("REGIME_SCOPE_INVALID");
  if (errors.length) return freeze({ status: "REJECTED", errors: freeze(errors) });
  return freeze({ status: "VALIDATED", strategy: freezeStrategy({ ...strategy, status: "VALIDATED" }), errors: freeze([]) });
}

export class StrategyRegistryError extends Error {
  constructor(readonly code: "INVALID_STRATEGY" | "VERSION_CONFLICT") { super(code); this.name = "StrategyRegistryError"; }
}

function versionCompare(left: string, right: string): number {
  return left.split(".").map(Number).reduce((result, value, index) => result || value - Number(right.split(".")[index]), 0);
}

export class StrategyRegistry {
  private readonly values = new Map<string, GeneratedStrategy>();

  register(strategy: GeneratedStrategy): GeneratedStrategy {
    if (strategy.status !== "VALIDATED") throw new StrategyRegistryError("INVALID_STRATEGY");
    const validation = validateStrategy(strategy);
    if (validation.status !== "VALIDATED") throw new StrategyRegistryError("INVALID_STRATEGY");
    const validated = validation.strategy!;
    const key = `${validated.strategyId}|${validated.version}`;
    const existing = this.values.get(key);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(validated)) throw new StrategyRegistryError("VERSION_CONFLICT");
      return existing;
    }
    this.values.set(key, validated);
    return validated;
  }

  get(strategyId: string, version: string): GeneratedStrategy | undefined { return this.values.get(`${strategyId}|${version}`); }
  list(strategyId?: string): readonly GeneratedStrategy[] { return freeze([...this.values.values()].filter((strategy) => !strategyId || strategy.strategyId === strategyId).sort((left, right) => left.strategyId.localeCompare(right.strategyId) || versionCompare(left.version, right.version))); }
  latest(strategyId: string): GeneratedStrategy | undefined { return this.list(strategyId).at(-1); }
}

export interface PaperExecutionContext { readonly mode: "PAPER" | "LIVE"; readonly marketDataHealthy: boolean; readonly recoveryReady: boolean; readonly riskHealthy: boolean; }
export interface PaperExecutionDecision { readonly allowed: boolean; readonly reason: string; readonly productionMutationAllowed: false; readonly orderAuthority: false; }

export function evaluatePaperExecutionBoundary(strategy: GeneratedStrategy, context: PaperExecutionContext): PaperExecutionDecision {
  if (strategy.status !== "VALIDATED") return freeze({ allowed: false, reason: "STRATEGY_NOT_VALIDATED", productionMutationAllowed: false, orderAuthority: false });
  if (context.mode !== "PAPER") return freeze({ allowed: false, reason: "PAPER_MODE_REQUIRED", productionMutationAllowed: false, orderAuthority: false });
  if (!context.marketDataHealthy) return freeze({ allowed: false, reason: "MARKET_DATA_UNHEALTHY", productionMutationAllowed: false, orderAuthority: false });
  if (!context.recoveryReady) return freeze({ allowed: false, reason: "RECOVERY_NOT_READY", productionMutationAllowed: false, orderAuthority: false });
  if (!context.riskHealthy) return freeze({ allowed: false, reason: "RISK_UNHEALTHY", productionMutationAllowed: false, orderAuthority: false });
  return freeze({ allowed: true, reason: "PAPER_EVALUATION_ALLOWED", productionMutationAllowed: false, orderAuthority: false });
}
