import { createHash } from "node:crypto";

export type HardRiskResult = "PASS" | "REJECT" | "BLOCK" | "UNKNOWN";
export type ReconciliationHealth = "MATCH" | "DIFF" | "UNKNOWN";
export type MarketDataHealth = "HEALTHY" | "STALE" | "DISCONNECTED" | "UNKNOWN";
export type RuntimeHealth = "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT" | "UNKNOWN";

export interface HardRiskPolicy {
  readonly policyVersion: string;
  readonly maxOrderNotional: string;
  readonly maxGlobalExposure: string;
  readonly maxStrategyExposure: string;
  readonly maxSymbolExposure: string;
  readonly maxDrawdown: string;
  readonly maxOpenOrders: number;
  readonly maxPositionCount: number;
  readonly maxConcentrationBps: number;
}

export interface HardRiskInput {
  readonly requestedNotional: string;
  readonly globalExposure: string;
  readonly strategyExposure: string;
  readonly symbolExposure: string;
  readonly portfolioGrossExposure: string;
  readonly drawdown: string;
  readonly openOrders: number;
  readonly positionCount: number;
  readonly reconciliation: ReconciliationHealth;
  readonly marketData: MarketDataHealth;
  readonly runtime: RuntimeHealth;
  readonly killSwitchActive: boolean;
}

export interface HardRiskDecision {
  readonly decisionId: string;
  readonly result: HardRiskResult;
  readonly policyVersion: string;
  readonly reasonCodes: readonly string[];
  readonly observedAt: string;
  readonly inputDigest: string;
}

type Decimal = Readonly<{ digits: bigint; scale: number }>;

function parseNonNegativeDecimal(value: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const [integer, fraction = ""] = value.split(".");
  return { digits: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function align(a: Decimal, b: Decimal): readonly [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  return [a.digits * 10n ** BigInt(scale - a.scale), b.digits * 10n ** BigInt(scale - b.scale)];
}

function gt(a: Decimal, b: Decimal): boolean { const [x, y] = align(a, b); return x > y; }
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  const [x, y] = align(a, b);
  return { digits: x + y, scale };
}
function ratioBps(part: Decimal, whole: Decimal): bigint | null {
  if (whole.digits === 0n) return part.digits === 0n ? 0n : null;
  const scale = Math.max(part.scale, whole.scale);
  const p = part.digits * 10n ** BigInt(scale - part.scale);
  const w = whole.digits * 10n ** BigInt(scale - whole.scale);
  return (p * 10000n + w - 1n) / w;
}

function stableDigest(policy: HardRiskPolicy, input: HardRiskInput): string {
  const canonical = JSON.stringify({
    input: Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
    policy: Object.fromEntries(Object.entries(policy).sort(([a], [b]) => a.localeCompare(b))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function decision(policyVersion: string, result: HardRiskResult, reasons: readonly string[], observedAt: string, digest: string): HardRiskDecision {
  const reasonCodes = Object.freeze([...new Set(reasons)].sort());
  const decisionId = createHash("sha256").update(`${policyVersion}|${observedAt}|${digest}|${result}|${reasonCodes.join(",")}`).digest("hex");
  return Object.freeze({ decisionId, result, policyVersion, reasonCodes, observedAt, inputDigest: digest });
}

export function evaluateHardRisk(policy: HardRiskPolicy, input: HardRiskInput, observedAt: string): HardRiskDecision {
  let digest = "INVALID";
  try {
    if (!policy.policyVersion.trim() || Number.isNaN(Date.parse(observedAt))) throw new Error("INVALID_METADATA");
    if (!Number.isInteger(policy.maxOpenOrders) || policy.maxOpenOrders < 0 || !Number.isInteger(policy.maxPositionCount) || policy.maxPositionCount < 0) throw new Error("INVALID_POLICY");
    if (!Number.isInteger(policy.maxConcentrationBps) || policy.maxConcentrationBps < 0 || policy.maxConcentrationBps > 10000) throw new Error("INVALID_POLICY");
    if (!Number.isInteger(input.openOrders) || input.openOrders < 0 || !Number.isInteger(input.positionCount) || input.positionCount < 0) throw new Error("INVALID_INPUT");

    digest = stableDigest(policy, input);
    const requested = parseNonNegativeDecimal(input.requestedNotional);
    const global = parseNonNegativeDecimal(input.globalExposure);
    const strategy = parseNonNegativeDecimal(input.strategyExposure);
    const symbol = parseNonNegativeDecimal(input.symbolExposure);
    const gross = parseNonNegativeDecimal(input.portfolioGrossExposure);
    const drawdown = parseNonNegativeDecimal(input.drawdown);
    const maxOrder = parseNonNegativeDecimal(policy.maxOrderNotional);
    const maxGlobal = parseNonNegativeDecimal(policy.maxGlobalExposure);
    const maxStrategy = parseNonNegativeDecimal(policy.maxStrategyExposure);
    const maxSymbol = parseNonNegativeDecimal(policy.maxSymbolExposure);
    const maxDrawdown = parseNonNegativeDecimal(policy.maxDrawdown);

    const blocked: string[] = [];
    const rejected: string[] = [];
    if (input.killSwitchActive) blocked.push("KILL_SWITCH_ACTIVE");
    if (input.reconciliation !== "MATCH") blocked.push(`RECONCILIATION_${input.reconciliation}`);
    if (input.marketData !== "HEALTHY") blocked.push(`MARKET_DATA_${input.marketData}`);
    if (input.runtime !== "SAFE") blocked.push(`RUNTIME_${input.runtime}`);

    if (gt(requested, maxOrder)) rejected.push("MAX_ORDER_NOTIONAL");
    if (gt(add(global, requested), maxGlobal)) rejected.push("MAX_GLOBAL_EXPOSURE");
    if (gt(add(strategy, requested), maxStrategy)) rejected.push("MAX_STRATEGY_EXPOSURE");
    if (gt(add(symbol, requested), maxSymbol)) rejected.push("MAX_SYMBOL_EXPOSURE");
    if (gt(drawdown, maxDrawdown)) rejected.push("MAX_DRAWDOWN");
    if (input.openOrders >= policy.maxOpenOrders) rejected.push("MAX_OPEN_ORDERS");
    if (input.positionCount >= policy.maxPositionCount) rejected.push("MAX_POSITION_COUNT");
    const concentration = ratioBps(add(symbol, requested), add(gross, requested));
    if (concentration === null || concentration > BigInt(policy.maxConcentrationBps)) rejected.push("MAX_CONCENTRATION");

    if (blocked.length) return decision(policy.policyVersion, "BLOCK", [...blocked, ...rejected], observedAt, digest);
    if (rejected.length) return decision(policy.policyVersion, "REJECT", rejected, observedAt, digest);
    return decision(policy.policyVersion, "PASS", [], observedAt, digest);
  } catch {
    return decision(policy.policyVersion || "UNKNOWN", "UNKNOWN", ["RISK_INPUT_OR_POLICY_UNKNOWN"], observedAt, digest);
  }
}

export class HardRiskGateway {
  public constructor(private readonly policy: HardRiskPolicy) {}
  evaluate(input: HardRiskInput, observedAt = new Date().toISOString()): HardRiskDecision { return evaluateHardRisk(this.policy, input, observedAt); }
  assertPass(value: HardRiskDecision): void { if (value.result !== "PASS") throw new Error(`HARD_RISK_${value.result}:${value.reasonCodes.join(",")}`); }
}
