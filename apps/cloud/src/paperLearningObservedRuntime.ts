import type { PaperAutoLearningObservation, PaperAutoLearningRuntime, PaperAutoLearningSnapshot } from "./paperAutoLearningRuntime";
import { PaperLearningEventRecorder, paperLearningCycleId } from "./paperLearningObservability";

export class PaperLearningObservedRuntime {
  public constructor(
    private readonly runtime: Pick<PaperAutoLearningRuntime, "snapshot" | "onMarketObservation">,
    private readonly recorder: PaperLearningEventRecorder
  ) {}

  public snapshot(): PaperAutoLearningSnapshot { return this.runtime.snapshot(); }

  public onMarketObservation(observation: PaperAutoLearningObservation): PaperAutoLearningSnapshot {
    const market = observation.market.trim().toUpperCase();
    const cycleId = paperLearningCycleId(market, observation.observedAt);
    const before = this.runtime.snapshot();
    this.recorder.record({ cycleId, stage: "MARKET_DATA", occurredAt: observation.now, market, status: observation.trusted ? "PASS" : "FAIL", reason: `observedAt=${observation.observedAt};ageMs=${observation.now - observation.observedAt}` });
    const after = this.runtime.onMarketObservation(observation);
    const decision = after.lastDecision;
    this.recorder.record({ cycleId, stage: "DECISION", occurredAt: observation.now, market, status: decision ? "PASS" : "SKIP", reason: decision ? undefined : after.lastReason ?? "NO_DECISION", ...(decision ? { decision } : {}) });
    const executionStatus = after.lastExecutionStatus;
    const executionPass = executionStatus === "FILLED";
    const executionFail = executionStatus === "FAILED" || executionStatus === "BLOCKED" || after.status === "ERROR" || after.status === "HALTED";
    this.recorder.record({ cycleId, stage: "ORDER_INTENT", occurredAt: observation.now, market, status: executionPass ? "PASS" : executionFail ? "FAIL" : "SKIP", reason: after.lastReason ?? executionStatus });
    if (after.lastFill && after.lastFill.id !== before.lastFill?.id) this.recorder.record({ cycleId, stage: "FILL", occurredAt: after.lastFill.filledAt, market, status: "PASS", fill: after.lastFill, idSuffix: after.lastFill.id });
    this.recorder.record({ cycleId, stage: "PNL", occurredAt: observation.now, market, status: "PASS", account: after.account, reason: `cash:${before.account.cash}->${after.account.cash};equity:${before.account.equity}->${after.account.equity};realizedPnL:${before.account.realizedPnL}->${after.account.realizedPnL};unrealizedPnL:${before.account.unrealizedPnL}->${after.account.unrealizedPnL}` });
    if (executionPass) this.recorder.record({ cycleId, stage: "LEARNING", occurredAt: observation.now, market, status: "PASS", reason: "PAPER_OUTCOME_FORWARDED_TO_RESEARCH" });
    if (after.status === "HALTED") this.recorder.record({ cycleId, stage: "HALT", occurredAt: observation.now, market, status: "FAIL", reason: after.lastReason ?? "PAPER_HALTED" });
    if (after.status === "ERROR") this.recorder.record({ cycleId, stage: "ERROR", occurredAt: observation.now, market, status: "FAIL", reason: after.lastError ?? after.lastReason ?? "PAPER_ERROR" });
    return after;
  }

  public timeline() { return this.recorder.replay(); }
}
