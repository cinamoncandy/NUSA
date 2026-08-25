import type { PaperLearningEvent } from "./paperLearningObservability";

export interface PaperLearningReadOnlyEvent {
  readonly id: string;
  readonly cycleId: string;
  readonly mode: "PAPER";
  readonly stage: PaperLearningEvent["stage"];
  readonly occurredAt: number;
  readonly market: string;
  readonly status: PaperLearningEvent["status"];
  readonly reason?: string;
  readonly strategyId?: string;
  readonly candidateId?: string;
  readonly championId?: string;
  readonly signal?: PaperLearningEvent["signal"];
  readonly gates?: PaperLearningEvent["gates"];
  readonly risk?: PaperLearningEvent["risk"];
  readonly evidence?: PaperLearningEvent["evidence"];
  readonly decision?: Readonly<{
    readonly action: "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE";
    readonly allocation: number;
    readonly confidence: number;
  }>;
  readonly fill?: Readonly<{
    readonly side: "BUY" | "SELL";
    readonly quantity: number;
    readonly price: number;
    readonly fee: number;
    readonly slippage?: number;
  }>;
  readonly account?: Readonly<{
    readonly cash: number;
    readonly equity: number;
    readonly realizedPnL: number;
    readonly unrealizedPnL: number;
  }>;
}

const SECRET_PATTERN = /(authorization|bearer|token|secret|api[_-]?key|access[_-]?key|account[_-]?id)\s*[:=]\s*[^,;\s]+/gi;
const MAX_REASON_LENGTH = 500;

function redactText(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  return value.replace(SECRET_PATTERN, "$1=[REDACTED]").slice(0, MAX_REASON_LENGTH);
}

function sanitizeEvent(event: PaperLearningEvent): PaperLearningReadOnlyEvent {
  if (event.mode !== "PAPER") throw new Error("PAPER learning projection received non-PAPER event");
  if (!event.id.trim() || !event.cycleId.trim() || !event.market.trim()) throw new Error("PAPER learning event identity is invalid");
  if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("PAPER learning event timestamp is invalid");

  const gates = event.gates?.map((gate) => Object.freeze({ ...gate, reason: redactText(gate.reason) ?? "" }));
  const risk = event.risk == null ? undefined : Object.freeze({ ...event.risk, reason: redactText(event.risk.reason) ?? "" });
  const decisionAction = event.decision != null && ["BUY", "SELL", "HOLD", "REDUCE", "INCREASE"].includes(event.decision.action) ? event.decision.action as "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE" : undefined;
  const decision = event.decision == null || decisionAction == null ? undefined : Object.freeze({ action: decisionAction, allocation: event.decision.allocation, confidence: event.decision.confidence });
  // Never expose simulator order/fill identifiers. They are unnecessary for the mobile learning
  // surface and could become linkable identifiers if an execution implementation changes later.
  const fill = event.fill == null ? undefined : Object.freeze({ side: event.fill.side, quantity: event.fill.quantity, price: event.fill.price, fee: event.fill.fee, ...(event.fill.slippage == null ? {} : { slippage: event.fill.slippage }) });
  const account = event.account == null ? undefined : Object.freeze({ cash: event.account.cash, equity: event.account.equity, realizedPnL: event.account.realizedPnL, unrealizedPnL: event.account.unrealizedPnL });

  return Object.freeze({
    id: event.id,
    cycleId: event.cycleId,
    mode: "PAPER" as const,
    stage: event.stage,
    occurredAt: event.occurredAt,
    market: event.market,
    status: event.status,
    ...(redactText(event.reason) == null ? {} : { reason: redactText(event.reason) }),
    ...(event.strategyId == null ? {} : { strategyId: event.strategyId }),
    ...(event.candidateId == null ? {} : { candidateId: event.candidateId }),
    ...(event.championId == null ? {} : { championId: event.championId }),
    ...(event.signal == null ? {} : { signal: Object.freeze({ ...event.signal }) }),
    ...(gates == null ? {} : { gates: Object.freeze(gates) }),
    ...(risk == null ? {} : { risk }),
    ...(event.evidence == null ? {} : { evidence: Object.freeze({ ...event.evidence }) }),
    ...(decision == null ? {} : { decision }),
    ...(fill == null ? {} : { fill }),
    ...(account == null ? {} : { account })
  });
}

/**
 * Builds a bounded, immutable, READ_ONLY mobile projection from the canonical PAPER event stream.
 * Duplicate deterministic event IDs collapse to the first canonical observation. No mutation
 * callback, account identifier, credential, order ID, or fill ID crosses this boundary.
 */
export function buildPaperLearningReadOnlyProjection(events: readonly PaperLearningEvent[], maximumEvents = 250): readonly PaperLearningReadOnlyEvent[] {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 1_000) throw new Error("PAPER learning projection limit is invalid");
  const deduplicated = new Map<string, PaperLearningEvent>();
  for (const event of events) if (!deduplicated.has(event.id)) deduplicated.set(event.id, event);
  return Object.freeze([...deduplicated.values()]
    .sort((left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id))
    .slice(0, maximumEvents)
    .map(sanitizeEvent));
}
