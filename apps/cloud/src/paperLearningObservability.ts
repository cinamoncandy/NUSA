import { createHash } from "node:crypto";
import type { CioDecision } from "./cioDecisionEngine";
import type { PaperAccountState, PaperExecutionResult, PaperFillRecord } from "./paperTradingExecutionLoop";

export type PaperLearningStage = "MARKET_DATA" | "SIGNAL" | "CANDIDATE" | "DECISION" | "PERMISSION" | "RISK" | "ORDER_INTENT" | "FILL" | "PNL" | "LEARNING" | "HALT" | "ERROR" | "IDEMPOTENCY";
export interface PaperLearningGate { readonly name: string; readonly status: "PASS" | "FAIL" | "SKIP"; readonly reason: string; }
export interface PaperLearningRisk { readonly status: "PASS" | "FAIL" | "SKIP"; readonly reason: string; readonly limits?: Readonly<Record<string, number>>; }
export interface PaperLearningEvidence { readonly evidenceId?: string; readonly inputHash?: string; readonly score?: number; readonly outcome?: "PROMOTE" | "REJECT" | "PAUSE" | "UNCHANGED"; }
export interface PaperLearningEvent {
  readonly id: string;
  readonly cycleId: string;
  readonly mode: "PAPER";
  readonly stage: PaperLearningStage;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly reason?: string;
  readonly strategyId?: string;
  readonly candidateId?: string;
  readonly championId?: string;
  readonly signal?: { readonly action: "BUY" | "SELL" | "HOLD"; readonly confidence?: number };
  readonly gates?: readonly PaperLearningGate[];
  readonly risk?: PaperLearningRisk;
  readonly evidence?: PaperLearningEvidence;
  readonly decision?: Pick<CioDecision, "symbol" | "action" | "allocation" | "confidence" | "decidedAt">;
  readonly fill?: Pick<PaperFillRecord, "id" | "orderId" | "side" | "quantity" | "price" | "fee" | "filledAt"> & { readonly slippage?: number };
  readonly account?: Pick<PaperAccountState, "cash" | "equity" | "realizedPnL" | "unrealizedPnL" | "updatedAt">;
}

const stableId = (cycleId: string, stage: PaperLearningStage, suffix = "") => createHash("sha256").update(`${cycleId}:${stage}:${suffix}`, "utf8").digest("hex");
const freeze = <T>(value: T): T => Object.freeze(value);

export function paperLearningCycleId(market: string, observedAt: number): string {
  return `paper:${market.trim().toUpperCase()}:${observedAt}`;
}

export class PaperLearningEventRecorder {
  private readonly byId = new Map<string, PaperLearningEvent>();
  public record(input: Omit<PaperLearningEvent, "id" | "mode"> & { readonly idSuffix?: string }): PaperLearningEvent {
    const { idSuffix = "", ...rest } = input;
    const event = freeze({ ...rest, id: stableId(rest.cycleId, rest.stage, idSuffix), mode: "PAPER" as const });
    const existing = this.byId.get(event.id);
    if (existing) return existing;
    this.byId.set(event.id, event);
    return event;
  }
  public replay(): readonly PaperLearningEvent[] {
    return freeze([...this.byId.values()].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)));
  }
}

export function executionEvents(args: { readonly cycleId: string; readonly market: string; readonly occurredAt: number; readonly decision?: CioDecision; readonly before: PaperAccountState; readonly result: PaperExecutionResult }): readonly Omit<PaperLearningEvent, "id" | "mode">[] {
  const base = { cycleId: args.cycleId, occurredAt: args.occurredAt, market: args.market } as const;
  const out: Omit<PaperLearningEvent, "id" | "mode">[] = [];
  out.push({ ...base, stage: "DECISION", status: args.decision ? "PASS" : "SKIP", reason: args.decision ? undefined : "NO_DECISION", ...(args.decision ? { decision: args.decision } : {}) });
  out.push({ ...base, stage: "ORDER_INTENT", status: args.result.status === "FILLED" ? "PASS" : args.result.status === "FAILED" || args.result.status === "BLOCKED" ? "FAIL" : "SKIP", reason: args.result.reason });
  for (const fill of args.result.fills) out.push({ ...base, stage: "FILL", status: "PASS", fill });
  out.push({ ...base, stage: "PNL", status: "PASS", account: args.result.state, reason: `cash:${args.before.cash}->${args.result.state.cash};equity:${args.before.equity}->${args.result.state.equity}` });
  return freeze(out);
}
