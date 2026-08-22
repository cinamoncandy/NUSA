export type PaperLearningUiStage = "MARKET_DATA" | "DECISION" | "ORDER_INTENT" | "FILL" | "PNL" | "LEARNING" | "HALT" | "ERROR";
export interface PaperLearningUiEvent {
  readonly id: string;
  readonly cycleId: string;
  readonly stage: PaperLearningUiStage;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly reason?: string;
  readonly decision?: { readonly action: "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE"; readonly allocation: number; readonly confidence: number };
  readonly fill?: { readonly side: "BUY" | "SELL"; readonly quantity: number; readonly price: number; readonly fee: number };
  readonly account?: { readonly cash: number; readonly equity: number; readonly realizedPnL: number; readonly unrealizedPnL: number };
}
export interface PaperLearningScreenState {
  readonly readOnly: true;
  readonly mode: "PAPER";
  readonly currentCycle: string | null;
  readonly status: "RUNNING" | "PAUSED" | "HALTED" | "ERROR";
  readonly latestDecision: PaperLearningUiEvent["decision"] | null;
  readonly latestFill: PaperLearningUiEvent["fill"] | null;
  readonly latestAccount: PaperLearningUiEvent["account"] | null;
  readonly timeline: readonly PaperLearningUiEvent[];
  readonly recentCycles: readonly string[];
  readonly entryPoints: readonly ["HOME", "TRADE", "PORTFOLIO"];
}

const freeze = <T>(value: T): T => Object.freeze(value);
export function buildPaperLearningScreen(events: readonly PaperLearningUiEvent[], runtimeStatus: PaperLearningScreenState["status"]): PaperLearningScreenState {
  const deduped = new Map<string, PaperLearningUiEvent>();
  for (const event of events) {
    if (!event.id.trim() || !event.cycleId.trim() || !event.market.trim()) throw new Error("invalid PAPER learning event identity");
    if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("invalid PAPER learning event timestamp");
    deduped.set(event.id, freeze({ ...event }));
  }
  const timeline = freeze([...deduped.values()].sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id)));
  const recentCycles = freeze([...new Set(timeline.map((event) => event.cycleId))].slice(0, 20));
  return freeze({
    readOnly: true,
    mode: "PAPER",
    currentCycle: timeline[0]?.cycleId ?? null,
    status: runtimeStatus,
    latestDecision: timeline.find((event) => event.decision)?.decision ?? null,
    latestFill: timeline.find((event) => event.fill)?.fill ?? null,
    latestAccount: timeline.find((event) => event.account)?.account ?? null,
    timeline,
    recentCycles,
    entryPoints: freeze(["HOME", "TRADE", "PORTFOLIO"] as const)
  });
}
