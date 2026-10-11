import type { PaperExecutionResult } from "./paperTradingExecutionLoop";

const MAX_REASON_LENGTH = 100;

/**
 * Public, unauthenticated-safe code for what the PAPER boundary did with the latest tick, so
 * "why was no order placed?" is answerable from `/health` without exposing prices, balances,
 * positions or order detail. Only the boundary's own status and reason/risk codes are carried;
 * free-text reasons are reduced to an upper-case code.
 */
export function codePaperDecisionOutcome(result: Pick<PaperExecutionResult, "status" | "reason" | "risk">): string {
  const riskCodes = result.risk != null && result.risk.status !== "ALLOW" && result.risk.reasonCodes.length > 0
    ? result.risk.reasonCodes.join("+")
    : undefined;
  const raw = result.reason?.trim() || riskCodes || result.status;
  const reason = raw.toUpperCase().replace(/[^A-Z0-9_.:+-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_REASON_LENGTH) || result.status;
  return `${result.status}:${reason}`;
}
