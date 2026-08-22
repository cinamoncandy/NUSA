import { randomUUID } from "node:crypto";
import { CanonicalRiskSafetyGate, type PaperApproval } from "../../contracts/src/risk-safety-integration";

/**
 * WO-0019. The single place in this process allowed to mint a PaperApproval. Nothing else --
 * not an IPC handler, not the renderer, not a test -- may call CanonicalRiskSafetyGate.saveApproval
 * directly. An approvalId that did not come from here has no record a real order can match,
 * so a renderer or test that fabricates one is rejected by the canonical gate's own scope check,
 * not by convention alone.
 */

/** MANUAL approvals expire fast: they exist to cover the single click that just happened. */
export const MANUAL_APPROVAL_TTL_MS = 60_000;
/** STRATEGY approvals cover an entire automatic-trading session, up to an hour at a time. */
export const STRATEGY_APPROVAL_TTL_MS = 60 * 60_000;
const LOCAL_OPERATOR = "LOCAL_OPERATOR";

export interface IssueManualApprovalInput {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  /** The exact commandId the order this approval covers will present. Binds the approval to that one order. */
  readonly commandId: string;
  readonly policyFingerprint: string;
  readonly nowMs: number;
}

export interface IssueStrategyApprovalInput {
  readonly symbol: string;
  readonly strategyId: string;
  readonly policyFingerprint: string;
  readonly nowMs: number;
}

export class PaperApprovalService {
  public constructor(private readonly gate: CanonicalRiskSafetyGate) {}

  /**
   * Issued once per confirmed manual order, after the renderer's confirmation UI has already
   * been passed -- the caller must not invoke this before that confirmation resolves. Bound to
   * a single side and a single commandId, so it is single-use by construction: a retry with a
   * different commandId, or a changed side/quantity/symbol producing a different commandId,
   * can never match this approval's scope.
   */
  public issueManualApproval(input: IssueManualApprovalInput): PaperApproval {
    const approval: PaperApproval = Object.freeze({
      approvalId: `manual-${randomUUID()}`,
      mode: "PAPER",
      symbol: input.symbol,
      strategyId: "MANUAL",
      policyFingerprint: input.policyFingerprint,
      side: input.side,
      commandId: input.commandId,
      expiresAtMs: input.nowMs + MANUAL_APPROVAL_TTL_MS,
      approvedBy: LOCAL_OPERATOR,
      approvedAtMs: input.nowMs
    });
    this.gate.saveApproval(approval);
    return approval;
  }

  /**
   * Issued once per explicit "start strategy" action. Never issued automatically -- not at
   * app boot, not on restart recovery. The caller is responsible for revoking the previous
   * strategy approval (if any) before issuing a new one, and for revoking this one when the
   * strategy stops or the kill switch activates.
   */
  public issueStrategyApproval(input: IssueStrategyApprovalInput): PaperApproval {
    const approval: PaperApproval = Object.freeze({
      approvalId: `strategy-${randomUUID()}`,
      mode: "PAPER",
      symbol: input.symbol,
      strategyId: input.strategyId,
      policyFingerprint: input.policyFingerprint,
      expiresAtMs: input.nowMs + STRATEGY_APPROVAL_TTL_MS,
      approvedBy: LOCAL_OPERATOR,
      approvedAtMs: input.nowMs
    });
    this.gate.saveApproval(approval);
    return approval;
  }

  public revoke(approvalId: string, reason: string): void {
    this.gate.revokeApproval(approvalId, reason);
  }
}
