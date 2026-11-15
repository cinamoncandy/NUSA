import type { TradePermissionGateName, TradePermissionResult } from "./tradePermissionEngine";

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

export interface PaperTradePermissionAuthority {
  /** Versions a permit must carry. Empty or missing versions permit nothing. */
  readonly policyVersion: string;
  readonly probabilityModelVersion: string;
  /** The latest canonical permission for the query, or null when none exists. May throw; a throw means "not verifiable". */
  latestPermit(query: PaperTradePermissionQuery): TradePermissionResult | null;
}

/** Production default until an independent producer exists: there is never a permit, so no strategy order is created. */
export const NO_PAPER_TRADE_PERMISSION_AUTHORITY: PaperTradePermissionAuthority = Object.freeze({
  policyVersion: "UNAVAILABLE",
  probabilityModelVersion: "UNAVAILABLE",
  latestPermit: () => null
});

export type PaperTradePermissionRefusal =
  | "PAPER_TRADE_PERMISSION_ABSENT"
  | "PAPER_TRADE_PERMISSION_NOT_PERMIT"
  | "PAPER_TRADE_PERMISSION_MISMATCH"
  | "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE"
  | "PAPER_TRADE_PERMISSION_INVALID_TIME"
  | "PAPER_TRADE_PERMISSION_EXPIRED"
  | "PAPER_TRADE_PERMISSION_UNVERIFIABLE";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Returns null when the permit is acceptable for the query at `nowMs`, else the stable refusal code. */
export function refusePaperTradePermission(
  authority: PaperTradePermissionAuthority | undefined,
  query: PaperTradePermissionQuery,
  nowMs: number
): PaperTradePermissionRefusal | null {
  if (authority == null || !text(authority.policyVersion) || !text(authority.probabilityModelVersion)) return "PAPER_TRADE_PERMISSION_UNVERIFIABLE";
  if (!Number.isFinite(nowMs)) return "PAPER_TRADE_PERMISSION_UNVERIFIABLE";
  let permit: TradePermissionResult | null;
  try { permit = authority.latestPermit(query); }
  catch { return "PAPER_TRADE_PERMISSION_UNVERIFIABLE"; }
  if (permit == null) return "PAPER_TRADE_PERMISSION_ABSENT";
  if (permit.decision !== "PERMIT") return "PAPER_TRADE_PERMISSION_NOT_PERMIT";
  if (permit.decisionId !== query.decisionId || permit.strategyId !== query.strategyId || permit.market !== query.market ||
      permit.policyVersion !== authority.policyVersion || permit.probabilityModelVersion !== authority.probabilityModelVersion) {
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
  const generatedAt = Date.parse(permit.generatedAt);
  const expiresAt = Date.parse(permit.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || expiresAt <= generatedAt || generatedAt > nowMs) return "PAPER_TRADE_PERMISSION_INVALID_TIME";
  if (expiresAt <= nowMs) return "PAPER_TRADE_PERMISSION_EXPIRED";
  return null;
}
