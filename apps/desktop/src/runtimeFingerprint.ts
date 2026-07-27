import { createHash } from "node:crypto";

/**
 * Deterministic fingerprints for the four identities the WO-0032 risk gateway checks
 * (`docs/operations/independent-risk-gateway-contract.md`).
 *
 * The gateway rejects an order whose strategy, config, runtime, or risk-policy fingerprint
 * does not match the one it was configured to guard. That check is only worth anything if
 * the fingerprint actually changes when the thing it names changes.
 *
 * THE TRAP THIS MODULE IS BUILT AROUND. There are two ways to derive such a fingerprint and
 * both have a failure mode:
 *
 *   - Hash a hand-picked subset of fields. A field added later is not covered, so the
 *     fingerprint stays identical while behaviour changes. The gateway then happily allows
 *     orders from a build it was never configured for. This failure is SILENT.
 *   - Hash whatever object is handed in. Key order, `undefined`, and accidental extra
 *     properties all leak into the digest, so unrelated refactors invalidate every
 *     fingerprint and operators learn to ignore mismatches.
 *
 * This module takes the first approach and makes its failure LOUD: each input has an
 * explicitly enumerated field set, and an unknown key is a thrown error rather than an
 * ignored one. Adding a field to a config type therefore forces a decision here instead of
 * silently widening a blind spot.
 */

/** Canonical JSON: object keys sorted, arrays order-preserving, `undefined` rejected upstream. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key]);
    return result;
  }
  return value;
}

function digest(domain: string, fields: Record<string, unknown>): string {
  const payload = JSON.stringify({ domain, fields: canonicalize(fields) });
  return `${domain}-${createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32)}`;
}

export class FingerprintInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FingerprintInputError";
  }
}

/**
 * Reads exactly the declared keys and refuses anything else. Missing keys and unknown keys
 * are both errors: a fingerprint computed over partially-supplied input would be a
 * different identity wearing the same name.
 */
function readExact<T extends object>(label: string, input: T, keys: readonly (keyof T & string)[]): Record<string, unknown> {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new FingerprintInputError(`${label}: input must be a plain object`);
  }
  const source = input as unknown as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !(keys as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new FingerprintInputError(
      `${label}: unknown field(s) ${unknown.join(", ")}. A field that is not part of the fingerprint is a change the risk gateway cannot see; add it here deliberately or do not pass it.`
    );
  }
  const missing = keys.filter((key) => input[key] === undefined);
  if (missing.length > 0) throw new FingerprintInputError(`${label}: missing field(s) ${missing.join(", ")}`);

  const fields: Record<string, unknown> = {};
  for (const key of keys) fields[key] = input[key];
  return fields;
}

export interface StrategyIdentityInput {
  readonly kind: string;
  readonly shortPeriod: number;
  readonly longPeriod: number;
  readonly timeframeMs: number;
  readonly symbol: string;
}

const STRATEGY_KEYS = ["kind", "shortPeriod", "longPeriod", "timeframeMs", "symbol"] as const;

export function deriveStrategyFingerprint(input: StrategyIdentityInput): string {
  const fields = readExact("strategy", input, STRATEGY_KEYS);
  if (!Number.isInteger(input.shortPeriod) || !Number.isInteger(input.longPeriod) || input.shortPeriod < 2 || input.longPeriod <= input.shortPeriod) {
    throw new FingerprintInputError("strategy: invalid SMA periods");
  }
  if (!Number.isInteger(input.timeframeMs) || input.timeframeMs <= 0) throw new FingerprintInputError("strategy: timeframeMs must be a positive integer");
  if (typeof input.kind !== "string" || input.kind.length === 0) throw new FingerprintInputError("strategy: kind must be a non-empty string");
  if (typeof input.symbol !== "string" || input.symbol.length === 0) throw new FingerprintInputError("strategy: symbol must be a non-empty string");
  return digest("strategy", fields);
}

export interface ConfigIdentityInput {
  readonly feeRate: number;
  readonly slippageBps: number;
  readonly spreadBps: number;
  readonly maxFillRatio: number;
  readonly marketImpactBpsPerUnit: number;
  readonly orderQuantity: number;
  readonly autoTradeDefaultEnabled: boolean;
}

const CONFIG_KEYS = ["feeRate", "slippageBps", "spreadBps", "maxFillRatio", "marketImpactBpsPerUnit", "orderQuantity", "autoTradeDefaultEnabled"] as const;

export function deriveConfigFingerprint(input: ConfigIdentityInput): string {
  const fields = readExact("config", input, CONFIG_KEYS);
  const numbers = ["feeRate", "slippageBps", "spreadBps", "maxFillRatio", "marketImpactBpsPerUnit", "orderQuantity"] as const;
  for (const key of numbers) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0) {
      throw new FingerprintInputError(`config: ${key} must be a non-negative finite number`);
    }
  }
  if (input.maxFillRatio <= 0 || input.maxFillRatio > 1) throw new FingerprintInputError("config: maxFillRatio must be in (0, 1]");
  if (typeof input.autoTradeDefaultEnabled !== "boolean") throw new FingerprintInputError("config: autoTradeDefaultEnabled must be a boolean");
  return digest("config", fields);
}

export interface RuntimeIdentityInput {
  readonly appVersion: string;
  readonly sourceCommitSha: string;
  readonly persistenceSchemaVersion: number;
  readonly platform: string;
  readonly nodeMajorVersion: number;
}

const RUNTIME_KEYS = ["appVersion", "sourceCommitSha", "persistenceSchemaVersion", "platform", "nodeMajorVersion"] as const;

export function deriveRuntimeFingerprint(input: RuntimeIdentityInput): string {
  const fields = readExact("runtime", input, RUNTIME_KEYS);
  for (const key of ["appVersion", "sourceCommitSha", "platform"] as const) {
    if (typeof input[key] !== "string" || input[key].length === 0) throw new FingerprintInputError(`runtime: ${key} must be a non-empty string`);
  }
  for (const key of ["persistenceSchemaVersion", "nodeMajorVersion"] as const) {
    if (!Number.isInteger(input[key]) || input[key] < 0) throw new FingerprintInputError(`runtime: ${key} must be a non-negative integer`);
  }
  return digest("runtime", fields);
}

export interface RiskPolicyIdentityInput {
  readonly maxOrderNotional: number;
  readonly maxPositionNotional: number;
  readonly maxOpenOrders: number;
  readonly maxOrdersPerSecond: number;
  readonly maxOrdersPerMinute: number;
  readonly maxSameSideStreak: number;
  readonly maxSymbolExposureNotional: number;
  readonly maxPortfolioExposureNotional: number;
  readonly maxDailyBuyNotional: number;
  readonly maxDailySellNotional: number;
  readonly maxDailyLoss: number;
  readonly maxConsecutiveLosses: number;
  readonly maxSessionDrawdownRatio: number;
  readonly maxPriceDeviationRatio: number;
}

/**
 * Deliberately the exact key set of `IndependentRiskLimits`. If a limit is added to the
 * gateway without being added here, the fingerprint would not change when that limit was
 * relaxed -- which is precisely the change the fingerprint exists to catch. A test asserts
 * the two key sets stay equal.
 */
const RISK_POLICY_KEYS = [
  "maxOrderNotional", "maxPositionNotional", "maxOpenOrders", "maxOrdersPerSecond", "maxOrdersPerMinute",
  "maxSameSideStreak", "maxSymbolExposureNotional", "maxPortfolioExposureNotional", "maxDailyBuyNotional",
  "maxDailySellNotional", "maxDailyLoss", "maxConsecutiveLosses", "maxSessionDrawdownRatio", "maxPriceDeviationRatio"
] as const;

export const RISK_POLICY_FINGERPRINT_KEYS: readonly string[] = Object.freeze([...RISK_POLICY_KEYS]);

export function deriveRiskPolicyFingerprint(input: RiskPolicyIdentityInput): string {
  const fields = readExact("riskPolicy", input, RISK_POLICY_KEYS);
  for (const key of RISK_POLICY_KEYS) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0) {
      throw new FingerprintInputError(`riskPolicy: ${key} must be a non-negative finite number`);
    }
  }
  return digest("riskPolicy", fields);
}
