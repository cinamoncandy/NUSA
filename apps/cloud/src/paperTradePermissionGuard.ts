import { createHash } from "node:crypto";
import { evaluateTradePermission, type TradePermissionGateName, type TradePermissionInput, type TradePermissionPolicy, type TradePermissionResult } from "./tradePermissionEngine";

/**
 * Canonical TradePermission enforcement for the Cloud PAPER execution boundary (#3108).
 *
 * Risk `ALLOW` is not enough: a strategy order (new or continued) may only reach the simulator when the latest
 * canonical permission is an unexpired PERMIT bound to the same intent identity, strategy, market, policy version
 * and probability-model version, with complete gate evidence. Anything else is refused BEFORE the risk gate and the
 * simulator are touched. This module never produces a permit; with no authority configured nothing is permitted.
 */

export const REQUIRED_TRADE_PERMISSION_GATES: readonly TradePermissionGateName[] = Object.freeze([
  "DATA_QUALITY", "FRESHNESS", "REGIME_COMPATIBILITY", "PROBABILITY", "EXPECTED_VALUE", "REWARD_TO_RISK", "LIQUIDITY",
  "CAPACITY", "SLIPPAGE", "UNCERTAINTY", "MODEL_AGREEMENT", "RISK_BUDGET", "KILL_SWITCH", "GOVERNANCE"
]);

export interface PaperTradePermissionQuery {
  /** The canonical intent identity (`paperExecutionIntentCommandId`), the same for a new order and its continuation. */
  readonly decisionId: string;
  readonly strategyId: string;
  readonly market: string;
}

/** The permit together with the exact evidence it was computed from, so the boundary can recompute and compare. */
export interface PaperTradePermissionRecord {
  readonly input: TradePermissionInput;
  readonly permit: TradePermissionResult;
}

/**
 * TRUST BOUNDARY. The authority is the only trusted source of canonical permits: it must return the LATEST record for the
 * query from the canonical producer and must be able to say whether each evidence reference really exists and belongs to
 * the query. The boundary does not trust the permit object itself: it recomputes the permit from `input` with the
 * canonical engine and the authority's policy and refuses anything that differs (a fabricated, edited or partial permit),
 * checks the record is bound to the query, refuses an older record than one already accepted for the same intent, and
 * asks the authority to confirm the evidence. Production supplies no authority, so nothing is permitted.
 */
export interface PaperTradePermissionAuthority {
  /** The policy a permit must have been computed with; its version is the required policy version. */
  readonly policy: TradePermissionPolicy;
  readonly probabilityModelVersion: string;
  /** The latest canonical record for the query, or null when none exists. May throw; a throw means "not verifiable". */
  latestPermit(query: PaperTradePermissionQuery): PaperTradePermissionRecord | null;
  /** True only when every reference exists in the canonical evidence store and is linked to this query. May throw. */
  evidenceExists(references: readonly string[], query: PaperTradePermissionQuery): boolean;
  /**
   * PERSISTENT replay guard. True only when the trusted, durable store confirms that this exact record (same permit content)
   * is the latest one for the intent, across restarts and for any number of intents. May throw; a throw means "not verifiable".
   * The boundary's own memory is only a second line of defence and is lost on restart.
   */
  isLatest(record: PaperTradePermissionRecord, query: PaperTradePermissionQuery): boolean;
}

/** Production default until an independent producer exists: there is never a permit, so no strategy order is created. */
const UNAVAILABLE_POLICY: TradePermissionPolicy = Object.freeze({
  policyVersion: "UNAVAILABLE", minimumDataQuality: 1, maximumAgeMs: 1, compatibleRegimes: Object.freeze(["UNAVAILABLE"]), minimumCalibratedProbability: 1,
  minimumNetExpectedValue: 0, minimumRewardToRisk: 1, minimumLiquidityScore: 1, minimumCapacityUsd: 0, maximumSlippageBps: 0, maximumUncertainty: 0,
  maximumModelDispersion: 0, maximumRiskBudgetUsage: 0, permissionTtlMs: 1
});
export const NO_PAPER_TRADE_PERMISSION_AUTHORITY: PaperTradePermissionAuthority = Object.freeze({
  policy: UNAVAILABLE_POLICY,
  probabilityModelVersion: "UNAVAILABLE",
  latestPermit: () => null,
  evidenceExists: () => false,
  isLatest: () => false
});

export type PaperTradePermissionRefusal =
  | "PAPER_TRADE_PERMISSION_ABSENT"
  | "PAPER_TRADE_PERMISSION_NOT_PERMIT"
  | "PAPER_TRADE_PERMISSION_MISMATCH"
  | "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE"
  | "PAPER_TRADE_PERMISSION_EVIDENCE_UNVERIFIED"
  | "PAPER_TRADE_PERMISSION_TAMPERED"
  | "PAPER_TRADE_PERMISSION_REPLAYED"
  | "PAPER_TRADE_PERMISSION_INVALID_TIME"
  | "PAPER_TRADE_PERMISSION_EXPIRED"
  | "PAPER_TRADE_PERMISSION_UNVERIFIABLE";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Second line of defence only (in memory, lost on restart, bounded): the newest accepted permit per intent. The durable
 * guarantee is the authority's `isLatest`. Losing an entry only weakens this extra check, never accepts a bad permit.
 */
export class PaperTradePermissionMemory {
  private static readonly LIMIT = 10_000;
  private readonly newest = new Map<string, { readonly generatedAt: number; readonly fingerprint: string }>();
  public get(decisionId: string): { readonly generatedAt: number; readonly fingerprint: string } | undefined { return this.newest.get(decisionId); }
  public record(decisionId: string, generatedAt: number, fingerprint: string): void {
    this.newest.delete(decisionId);
    this.newest.set(decisionId, { generatedAt, fingerprint });
    if (this.newest.size > PaperTradePermissionMemory.LIMIT) this.newest.delete(this.newest.keys().next().value as string);
  }
}

/** Returns null when the record is acceptable for the query at `nowMs`, else the stable refusal code. */
export function refusePaperTradePermission(
  authority: PaperTradePermissionAuthority | undefined,
  query: PaperTradePermissionQuery,
  nowMs: number,
  memory?: PaperTradePermissionMemory
): PaperTradePermissionRefusal | null {
  if (authority == null || authority.policy == null || !text(authority.policy.policyVersion) || !text(authority.probabilityModelVersion)) return "PAPER_TRADE_PERMISSION_UNVERIFIABLE";
  if (!Number.isFinite(nowMs)) return "PAPER_TRADE_PERMISSION_UNVERIFIABLE";
  let record: PaperTradePermissionRecord | null;
  try { record = authority.latestPermit(query); }
  catch { return "PAPER_TRADE_PERMISSION_UNVERIFIABLE"; }
  if (record == null) return "PAPER_TRADE_PERMISSION_ABSENT";
  const permit = record.permit;
  const input = record.input;
  if (permit == null || input == null) return "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE";
  if (permit.decision !== "PERMIT") return "PAPER_TRADE_PERMISSION_NOT_PERMIT";
  if (permit.decisionId !== query.decisionId || permit.strategyId !== query.strategyId || permit.market !== query.market ||
      input.decisionId !== query.decisionId || input.strategyId !== query.strategyId || input.market !== query.market ||
      permit.policyVersion !== authority.policy.policyVersion || permit.probabilityModelVersion !== authority.probabilityModelVersion ||
      input.probability?.modelVersion !== authority.probabilityModelVersion) {
    return "PAPER_TRADE_PERMISSION_MISMATCH";
  }
  // Complete verifiable evidence: references present, every canonical gate evaluated and passed, none failed.
  const passed = Array.isArray(permit.passedGates) ? permit.passedGates : [];
  if (!Array.isArray(permit.evidenceReferences) || permit.evidenceReferences.length === 0 || !permit.evidenceReferences.every(text) ||
      !Array.isArray(permit.failedGates) || permit.failedGates.length !== 0 ||
      !Array.isArray(permit.gates) || permit.gates.length !== REQUIRED_TRADE_PERMISSION_GATES.length ||
      !permit.gates.every((item) => item != null && item.passed === true) ||
      new Set(passed).size !== REQUIRED_TRADE_PERMISSION_GATES.length ||
      !REQUIRED_TRADE_PERMISSION_GATES.every((name) => passed.includes(name)) ||
      !REQUIRED_TRADE_PERMISSION_GATES.every((name) => permit.gates.some((item) => item.gate === name))) {
    return "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE";
  }
  // Recompute with the canonical engine: a permit that is not exactly the engine's output for this evidence is refused.
  try {
    const recomputed = evaluateTradePermission(input, authority.policy);
    if (JSON.stringify(recomputed) !== JSON.stringify(permit)) return "PAPER_TRADE_PERMISSION_TAMPERED";
  } catch { return "PAPER_TRADE_PERMISSION_TAMPERED"; }
  const generatedAt = Date.parse(permit.generatedAt);
  const expiresAt = Date.parse(permit.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || expiresAt <= generatedAt || generatedAt > nowMs) return "PAPER_TRADE_PERMISSION_INVALID_TIME";
  if (expiresAt <= nowMs) return "PAPER_TRADE_PERMISSION_EXPIRED";
  // The references must exist in the canonical evidence store and be linked to this query (the authority is the trusted store).
  try { if (authority.evidenceExists(permit.evidenceReferences, query) !== true) return "PAPER_TRADE_PERMISSION_EVIDENCE_UNVERIFIED"; }
  catch { return "PAPER_TRADE_PERMISSION_UNVERIFIABLE"; }
  // Replay: the durable store must confirm this exact record is the latest for the intent (survives restarts).
  try { if (authority.isLatest(record, query) !== true) return "PAPER_TRADE_PERMISSION_REPLAYED"; }
  catch { return "PAPER_TRADE_PERMISSION_UNVERIFIABLE"; }
  // Second line: within this process an older record, or a different record with the same time, than one already accepted is refused.
  const fingerprint = createHash("sha256").update(JSON.stringify(permit)).digest("hex");
  const newest = memory?.get(query.decisionId);
  if (newest !== undefined && (generatedAt < newest.generatedAt || (generatedAt === newest.generatedAt && fingerprint !== newest.fingerprint))) return "PAPER_TRADE_PERMISSION_REPLAYED";
  memory?.record(query.decisionId, generatedAt, fingerprint);
  return null;
}
