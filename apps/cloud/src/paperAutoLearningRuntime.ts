import { createHash } from "node:crypto";
import type { CioDecision } from "./cioDecisionEngine";
import type {
  PaperAccountState,
  PaperExecutionResult,
  PaperFillRecord,
  PaperTradingExecutionLoop
} from "./paperTradingExecutionLoop";
import type { PaperObservedExecutionQuote } from "./paperRuntimeExecutionCostEvidence";
import type { PaperScenarioEvidenceRecorder } from "./paperScenarioEvidenceRecorder";
import type { ResearchAutomationRuntime } from "./researchAutomationRuntime";

export type PaperAutoLearningStatus = "RUNNING" | "PAUSED" | "HALTED" | "ERROR";

export interface PaperAutoLearningObservation {
  readonly market: string;
  readonly price: number;
  readonly observedAt: number;
  readonly now: number;
  /** Only observations produced by the governed public-market adapter may set this true. */
  readonly trusted: boolean;
  /** Optional canonical public order-book evidence captured with the same observation. */
  readonly observedQuote?: PaperObservedExecutionQuote;
}

export interface PaperAutoLearningDecisionContext extends PaperAutoLearningObservation {
  readonly account: PaperAccountState;
}

export interface PaperAutoLearningSnapshot {
  readonly status: PaperAutoLearningStatus;
  readonly lastObservationAt?: number;
  readonly lastDecision?: CioDecision;
  readonly lastFill?: PaperFillRecord;
  readonly lastExecutionStatus?: PaperExecutionResult["status"];
  readonly lastReason?: string;
  readonly lastError?: string;
  readonly account: PaperAccountState;
}

export interface PaperAutoLearningRuntimeOptions {
  readonly execution: PaperTradingExecutionLoop;
  /** Structured, governed decision source. Never infer trade direction from AI prose. */
  readonly decisions: (context: PaperAutoLearningDecisionContext) => readonly CioDecision[];
  readonly control: () => {
    readonly killSwitchActive: boolean;
    readonly tradingAllowed: boolean;
    readonly overallHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  };
  readonly evidence?: Pick<PaperScenarioEvidenceRecorder, "sessionObserved" | "orderCompleted" | "duplicateOrderChecked">;
  readonly research?: Pick<ResearchAutomationRuntime, "onMarketData">;
  readonly investmentPercent?: number;
  readonly maxObservationAgeMs?: number;
  readonly startPaused?: boolean;
}

const freeze = <T>(value: T): T => Object.freeze(value);

function evidenceId(kind: string, observation: PaperAutoLearningObservation, suffix = ""): string {
  return `${kind}:${createHash("sha256").update(`${observation.market}:${observation.observedAt}:${suffix}`, "utf8").digest("hex").slice(0, 24)}`;
}

/**
 * Canonical autonomous PAPER orchestration layer.
 *
 * This class deliberately owns no broker, accounting, fill, or position logic. All simulated
 * mutation terminates at PaperTradingExecutionLoop, so restart/idempotency/fee/PnL behavior has
 * one source of truth. AI text is never parsed into a trading signal; callers must supply explicit
 * governed CioDecision records.
 */
export class PaperAutoLearningRuntime {
  private status: PaperAutoLearningStatus;
  private lastObservationAt?: number;
  private lastDecision?: CioDecision;
  private lastFill?: PaperFillRecord;
  private lastExecutionStatus?: PaperExecutionResult["status"];
  private lastReason?: string;
  private lastError?: string;
  private lastChronologyObservationAt?: number;
  private lastChronologyNow?: number;
  private readonly maxObservationAgeMs: number;
  private readonly investmentPercent: number;

  public constructor(private readonly options: PaperAutoLearningRuntimeOptions) {
    this.maxObservationAgeMs = options.maxObservationAgeMs ?? 30_000;
    this.investmentPercent = options.investmentPercent ?? 100;
    if (!Number.isSafeInteger(this.maxObservationAgeMs) || this.maxObservationAgeMs < 1_000) throw new Error("paper auto-learning stale window is invalid");
    if (!Number.isFinite(this.investmentPercent) || this.investmentPercent < 0 || this.investmentPercent > 100) throw new Error("paper auto-learning investment percentage is invalid");
    this.status = options.startPaused === true ? "PAUSED" : "RUNNING";
  }

  public snapshot(): PaperAutoLearningSnapshot {
    return freeze({
      status: this.status,
      ...(this.lastObservationAt === undefined ? {} : { lastObservationAt: this.lastObservationAt }),
      ...(this.lastDecision === undefined ? {} : { lastDecision: this.lastDecision }),
      ...(this.lastFill === undefined ? {} : { lastFill: this.lastFill }),
      ...(this.lastExecutionStatus === undefined ? {} : { lastExecutionStatus: this.lastExecutionStatus }),
      ...(this.lastReason === undefined ? {} : { lastReason: this.lastReason }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      account: this.options.execution.snapshot()
    });
  }

  public pause(reason = "PAPER_AUTO_LEARNING_PAUSED"): PaperAutoLearningSnapshot {
    if (this.status !== "HALTED") this.status = "PAUSED";
    this.lastReason = reason;
    return this.snapshot();
  }

  public resume(): PaperAutoLearningSnapshot {
    if (this.status === "HALTED") throw new Error("paper auto-learning is halted");
    this.status = "RUNNING";
    this.lastError = undefined;
    this.lastReason = "PAPER_AUTO_LEARNING_RESUMED";
    return this.snapshot();
  }

  public halt(reason = "PAPER_AUTO_LEARNING_HALTED"): PaperAutoLearningSnapshot {
    this.status = "HALTED";
    this.lastReason = reason;
    return this.snapshot();
  }

  public onMarketObservation(observation: PaperAutoLearningObservation): PaperAutoLearningSnapshot {
    if (this.status !== "RUNNING") return this.snapshot();
    try {
      this.validateObservation(observation);
      const control = this.options.control();
      if (control.killSwitchActive || !control.tradingAllowed || control.overallHealth === "DOWN") {
        this.status = "HALTED";
        this.lastReason = "PAPER_RISK_HALT";
        return this.snapshot();
      }
      if (control.overallHealth !== "HEALTHY") {
        this.status = "PAUSED";
        this.lastReason = "PAPER_RUNTIME_NOT_HEALTHY";
        return this.snapshot();
      }

      const account = this.options.execution.snapshot();
      const decisions = freeze([...this.options.decisions({ ...observation, account })]);
      const actionable = decisions.find((decision) => decision.symbol === observation.market.trim().toUpperCase() && (decision.action === "BUY" || decision.action === "SELL"));
      this.lastDecision = actionable ?? decisions[0];
      this.lastObservationAt = observation.observedAt;
      this.options.evidence?.sessionObserved(evidenceId("paper-observation", observation), observation.now);

      const result = this.options.execution.processTick({
        now: observation.now,
        market: observation.market.trim().toUpperCase(),
        price: observation.price,
        observedAt: observation.observedAt,
        mode: "PAPER",
        killSwitchActive: control.killSwitchActive,
        tradingAllowed: control.tradingAllowed,
        overallHealth: control.overallHealth,
        decisions,
        investmentPercent: this.investmentPercent,
        observedQuote: observation.observedQuote
      });
      this.lastExecutionStatus = result.status;
      this.lastReason = result.reason;

      if (result.status === "FILLED") {
        this.lastFill = result.fills[0];
        for (const fill of result.fills) this.options.evidence?.orderCompleted(evidenceId("paper-fill", observation, fill.id), fill.filledAt);
        this.options.research?.onMarketData({ market: observation.market.trim().toUpperCase(), price: observation.price, observedAt: observation.observedAt, now: observation.now });
      } else if (result.status === "DUPLICATE") {
        this.options.evidence?.duplicateOrderChecked(evidenceId("paper-duplicate", observation, result.reason ?? "duplicate"), observation.now);
      } else if (result.status === "FAILED") {
        this.fail(result.reason ?? "PAPER_EXECUTION_FAILED");
      } else if (result.status === "BLOCKED") {
        this.status = "HALTED";
      }
      return this.snapshot();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "PAPER_AUTO_LEARNING_FAILED");
      return this.snapshot();
    }
  }

  private validateObservation(observation: PaperAutoLearningObservation): void {
    if (!observation.trusted) throw new Error("PAPER_MARKET_INPUT_UNTRUSTED");
    const market = observation.market.trim().toUpperCase();
    if (!market) throw new Error("PAPER_MARKET_INVALID");
    if (!Number.isFinite(observation.price) || observation.price <= 0) throw new Error("PAPER_MARKET_PRICE_INVALID");
    if (!Number.isSafeInteger(observation.now) || !Number.isSafeInteger(observation.observedAt) || observation.now < 0 || observation.observedAt < 0 || observation.observedAt > observation.now) throw new Error("PAPER_MARKET_CLOCK_INVALID");
    if (this.lastChronologyObservationAt !== undefined && observation.observedAt < this.lastChronologyObservationAt) throw new Error("PAPER_MARKET_CHRONOLOGY_REGRESSION");
    if (this.lastChronologyNow !== undefined && observation.now < this.lastChronologyNow) throw new Error("PAPER_RUNTIME_CLOCK_REGRESSION");
    if (observation.now - observation.observedAt >= this.maxObservationAgeMs) throw new Error("PAPER_MARKET_INPUT_STALE");
    if (observation.observedQuote != null) {
      if (observation.observedQuote.market.trim().toUpperCase() !== market) throw new Error("PAPER_OBSERVED_QUOTE_MARKET_MISMATCH");
      if (observation.observedQuote.observedAt > observation.now || observation.now - observation.observedQuote.observedAt >= this.maxObservationAgeMs) throw new Error("PAPER_OBSERVED_QUOTE_STALE");
    }
    this.lastChronologyObservationAt = observation.observedAt;
    this.lastChronologyNow = observation.now;
  }

  private fail(message: string): void {
    this.status = "ERROR";
    this.lastError = message;
    this.lastReason = "PAPER_FAIL_CLOSED";
  }
}
