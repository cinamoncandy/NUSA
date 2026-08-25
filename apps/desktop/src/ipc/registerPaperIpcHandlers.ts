import { randomUUID } from "node:crypto";
import { PERSISTENCE_REPAIR_MESSAGE } from "../control/runtimeCommandService";
import { parsePaperOrderIpc } from "./paperIpcValidation";
import type { PaperOrder } from "../paper/paperBroker";
import type { RuntimeContext } from "./runtimeContext";

/**
 * WO-0019. The renderer must show its confirmation UI (exact side/quantity/symbol) and only
 * invoke this channel once the user has passed it -- that confirmation is what "explicit user
 * confirmation" means here, and this handler trusts that it already happened. What this
 * handler does NOT trust is a renderer- or test-supplied approvalId: the approval is minted
 * right here, by PaperApprovalService, bound to a freshly generated commandId and the exact
 * side/quantity/symbol of this call, and is therefore usable for this order alone.
 */
export function registerPaperIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("paper:order", (_event, input: unknown) => {
    if (!ctx.paperTradingAvailable) throw new Error(PERSISTENCE_REPAIR_MESSAGE);
    if (input == null || typeof input !== "object") throw new Error("invalid paper order input");
    const candidate = input as { side?: unknown; quantity?: unknown };
    if ((candidate.side !== "BUY" && candidate.side !== "SELL") || typeof candidate.quantity !== "number" || !Number.isFinite(candidate.quantity)) throw new Error("invalid paper order input");
    const { side, quantity } = parsePaperOrderIpc(input);
    const ticker = ctx.assertFreshMarketData();
    if (!ctx.paperApprovalService) throw new Error(PERSISTENCE_REPAIR_MESSAGE);
    const nowMs = Date.now();
    const commandId = `manual:${nowMs}:${randomUUID()}`;
    const signalId = commandId;
    const clientOrderId = `paper:${commandId}`;
    // Approval issuance failure is fail-closed by construction: nothing below this line runs
    // (manualOrder is never called) unless an approval was actually persisted.
    const approval = ctx.paperApprovalService.issueManualApproval({ symbol: ctx.MARKET, side, commandId, policyFingerprint: ctx.PAPER_SAFETY_FINGERPRINTS.riskPolicy, nowMs });
    let order: PaperOrder;
    try { order = ctx.runtime.manualOrder(side, quantity, ticker.trade_price, { approvalId: approval.approvalId, commandId, signalId, clientOrderId, nowMs }); }
    finally { ctx.paperTradingAvailable = ctx.runtime.isAvailable(); }
    ctx.publishControl();
    ctx.publishAiCioDashboard();
    return { order, snapshot: ctx.broker.snapshot(ticker.trade_price) };
  });

  ctx.ipcMain.handle("paper:snapshot", () => ctx.latestTicker ? ctx.broker.snapshot(ctx.latestTicker.trade_price) : null);
  ctx.ipcMain.handle("execution:list", () => ctx.executionRepository?.listActive() ?? Object.freeze([]));
  ctx.ipcMain.handle("execution:get", (_event, executionId: unknown) => {
    if (typeof executionId !== "string" || executionId.trim().length === 0 || executionId.length > 128) throw new Error("invalid execution id");
    return ctx.executionRepository?.get(executionId) ?? null;
  });
  ctx.ipcMain.handle("execution:transitions", (_event, executionId: unknown) => {
    if (typeof executionId !== "string" || executionId.trim().length === 0 || executionId.length > 128) throw new Error("invalid execution id");
    return ctx.executionRepository?.transitions(executionId) ?? Object.freeze([]);
  });
  ctx.ipcMain.handle("execution:fills", (_event, executionId: unknown) => {
    if (typeof executionId !== "string" || executionId.trim().length === 0 || executionId.length > 128) throw new Error("invalid execution id");
    return ctx.executionRepository?.fills(executionId) ?? Object.freeze([]);
  });
  ctx.ipcMain.handle("execution:health", () => {
    const active = ctx.executionRepository?.listActive() ?? [];
    return Object.freeze({ activeCount: active.length, states: Object.freeze(Object.fromEntries(active.map((record) => [record.state, (active.filter((candidate) => candidate.state === record.state).length)]))), observedAt: new Date().toISOString() });
  });
  ctx.ipcMain.handle("paper:preflight", () => ctx.operationalPreflight);
  ctx.ipcMain.handle("paper:risk-budget-usage", () => ctx.lastRiskBudgetUsage);
}
