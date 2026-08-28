import { getLocalPaperLearningEvents } from "./localPaperLearningProjection";

/**
 * Why the PAPER learning timeline looks the way it does. Issue #755: an empty screen previously
 * collapsed five genuinely different conditions into one silent "no data", so a real device could
 * not tell "endpoint not configured" from "server projection missing" from "runtime produced
 * nothing yet". The caller knows which one it is; the screen must not have to guess from runtime
 * status alone.
 */
export type PaperLearningDataSource =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "PROJECTION_ABSENT"
  | "PROJECTION_EMPTY"
  | "LOCAL_FALLBACK"
  | "SERVER_STREAM";

export type PaperLearningUiStage = "MARKET_DATA" | "SIGNAL" | "CANDIDATE" | "DECISION" | "PERMISSION" | "RISK" | "ORDER_INTENT" | "FILL" | "PNL" | "LEARNING" | "HALT" | "ERROR" | "IDEMPOTENCY" | "PERIOD_OPEN" | "PERIOD_REALIZED_PERSISTED" | "PERIOD_REJECTED";
export interface PaperLearningGateUi { readonly name: string; readonly status: "PASS" | "FAIL" | "SKIP"; readonly reason: string; }
export interface PaperLearningUiEvent {
  readonly id: string;
  readonly cycleId: string;
  readonly stage: PaperLearningUiStage;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly reason?: string;
  readonly strategyId?: string;
  readonly candidateId?: string;
  readonly championId?: string;
  readonly signal?: { readonly action: "BUY" | "SELL" | "HOLD"; readonly confidence?: number };
  readonly gates?: readonly PaperLearningGateUi[];
  readonly risk?: { readonly status: "PASS" | "FAIL" | "SKIP"; readonly reason: string; readonly limits?: Readonly<Record<string, number>> };
  readonly evidence?: { readonly evidenceId?: string; readonly inputHash?: string; readonly score?: number; readonly outcome?: "PROMOTE" | "REJECT" | "PAUSE" | "UNCHANGED" };
  readonly decision?: { readonly action: "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE"; readonly allocation: number; readonly confidence: number };
  readonly fill?: { readonly side: "BUY" | "SELL"; readonly quantity: number; readonly price: number; readonly fee: number; readonly slippage?: number };
  readonly account?: { readonly cash: number; readonly equity: number; readonly realizedPnL: number; readonly unrealizedPnL: number };
}
export interface PaperLearningPerformance {
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly fees: number;
  readonly turnover: number;
  readonly completedCycles: number;
  readonly filledCycles: number;
  readonly winRate: number | null;
  readonly expectancy: number | null;
  readonly maxDrawdown: number;
}
export interface PaperLearningCycleSummary {
  readonly cycleId: string;
  readonly market: string;
  readonly occurredAt: number;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly decision: PaperLearningUiEvent["decision"] | null;
  readonly reason: string | null;
}
export interface PaperLearningScreenState {
  readonly readOnly: true;
  readonly mode: "PAPER";
  readonly currentCycle: string | null;
  readonly status: "RUNNING" | "PAUSED" | "HALTED" | "ERROR";
  /** Explicit provenance of `timeline`. Never inferred from `status`. */
  readonly dataSource: PaperLearningDataSource;
  readonly latestMarket: string | null;
  readonly latestStrategy: { readonly strategyId: string | null; readonly candidateId: string | null; readonly championId: string | null };
  readonly latestSignal: PaperLearningUiEvent["signal"] | null;
  readonly latestDecision: PaperLearningUiEvent["decision"] | null;
  readonly latestGates: readonly PaperLearningGateUi[];
  readonly latestRisk: PaperLearningUiEvent["risk"] | null;
  readonly latestFill: PaperLearningUiEvent["fill"] | null;
  readonly latestAccount: PaperLearningUiEvent["account"] | null;
  readonly latestEvidence: PaperLearningUiEvent["evidence"] | null;
  readonly timeline: readonly PaperLearningUiEvent[];
  readonly recentCycles: readonly PaperLearningCycleSummary[];
  readonly performance: PaperLearningPerformance;
  readonly entryPoints: readonly ["HOME", "TRADE", "PORTFOLIO"];
  readonly autoRefresh: true;
}

const freeze = <T>(value: T): T => Object.freeze(value);
const emptyPerformance = (): PaperLearningPerformance => ({ realizedPnL: 0, unrealizedPnL: 0, fees: 0, turnover: 0, completedCycles: 0, filledCycles: 0, winRate: null, expectancy: null, maxDrawdown: 0 });

function buildPerformance(timeline: readonly PaperLearningUiEvent[]): PaperLearningPerformance {
  const accountEvents = [...timeline].filter((event) => event.account).sort((a, b) => a.occurredAt - b.occurredAt);
  const fillEvents = timeline.filter((event) => event.fill);
  if (!accountEvents.length) return freeze({ ...emptyPerformance(), fees: fillEvents.reduce((sum, event) => sum + (event.fill?.fee ?? 0), 0), turnover: fillEvents.reduce((sum, event) => sum + ((event.fill?.price ?? 0) * (event.fill?.quantity ?? 0)), 0) });
  const latest = accountEvents[accountEvents.length - 1].account!;
  let peak = accountEvents[0].account!.equity;
  let maxDrawdown = 0;
  for (const event of accountEvents) { peak = Math.max(peak, event.account!.equity); if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - event.account!.equity) / peak); }
  const cycleIds = [...new Set(timeline.map((event) => event.cycleId))];
  const completed = cycleIds.filter((cycleId) => timeline.some((event) => event.cycleId === cycleId && (event.stage === "LEARNING" || event.stage === "HALT" || event.stage === "ERROR")));
  const pnlDeltas = completed.map((cycleId) => {
    const pnlEvents = timeline.filter((event) => event.cycleId === cycleId && event.stage === "PNL" && event.account).sort((a, b) => a.occurredAt - b.occurredAt);
    return pnlEvents.length ? pnlEvents[pnlEvents.length - 1].account?.realizedPnL : undefined;
  }).filter((value): value is number => value !== undefined);
  const wins = pnlDeltas.filter((value) => value > 0).length;
  return freeze({ realizedPnL: latest.realizedPnL, unrealizedPnL: latest.unrealizedPnL, fees: fillEvents.reduce((sum, event) => sum + (event.fill?.fee ?? 0), 0), turnover: fillEvents.reduce((sum, event) => sum + ((event.fill?.price ?? 0) * (event.fill?.quantity ?? 0)), 0), completedCycles: completed.length, filledCycles: new Set(fillEvents.map((event) => event.cycleId)).size, winRate: pnlDeltas.length ? wins / pnlDeltas.length : null, expectancy: pnlDeltas.length ? pnlDeltas.reduce((sum, value) => sum + value, 0) / pnlDeltas.length : null, maxDrawdown });
}

/**
 * `serverSource` describes what the caller actually observed upstream. It is optional so existing
 * callers keep working, but when omitted the resulting dataSource can only be derived from what is
 * visible here -- which is exactly the ambiguity issue #755 is about. Callers that know the real
 * upstream condition should always pass it.
 */
export function buildPaperLearningScreen(
  events: readonly PaperLearningUiEvent[],
  runtimeStatus: PaperLearningScreenState["status"],
  serverSource: Exclude<PaperLearningDataSource, "LOCAL_FALLBACK" | "SERVER_STREAM"> | "SERVER_STREAM" = events.length > 0 ? "SERVER_STREAM" : "PROJECTION_EMPTY"
): PaperLearningScreenState {
  const localFallback = events.length === 0 ? getLocalPaperLearningEvents() : Object.freeze([] as PaperLearningUiEvent[]);
  const sourceEvents = events.length > 0 ? events : localFallback;
  // Substituting on-device events for an empty server projection is legitimate, but it must be
  // visible: a user looking at locally-derived rows should never believe they are seeing the
  // server's PAPER runtime.
  const dataSource: PaperLearningDataSource = events.length > 0
    ? "SERVER_STREAM"
    : localFallback.length > 0
      ? "LOCAL_FALLBACK"
      : serverSource;
  const deduped = new Map<string, PaperLearningUiEvent>();
  for (const event of sourceEvents) {
    if (!event.id.trim() || !event.cycleId.trim() || !event.market.trim()) throw new Error("invalid PAPER learning event identity");
    if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("invalid PAPER learning event timestamp");
    deduped.set(event.id, freeze({ ...event }));
  }
  const timeline = freeze([...deduped.values()].sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id)));
  const current = timeline[0] ?? null;
  const cycleIds = [...new Set(timeline.map((event) => event.cycleId))].slice(0, 20);
  const recentCycles = freeze(cycleIds.map((cycleId) => {
    const cycle = timeline.filter((event) => event.cycleId === cycleId);
    const decision = cycle.find((event) => event.decision)?.decision ?? null;
    const terminal = cycle.find((event) => event.stage === "ERROR" || event.stage === "HALT" || event.status === "FAIL") ?? cycle[0];
    return freeze({ cycleId, market: cycle[0]?.market ?? "UNKNOWN", occurredAt: cycle[0]?.occurredAt ?? 0, status: terminal?.status ?? "SKIP", decision, reason: terminal?.reason ?? null });
  }));
  const latestIdentity = timeline.find((event) => event.strategyId || event.candidateId || event.championId);
  return freeze({
    readOnly: true,
    mode: "PAPER",
    currentCycle: current?.cycleId ?? null,
    status: runtimeStatus,
    dataSource,
    latestMarket: current?.market ?? null,
    latestStrategy: freeze({ strategyId: latestIdentity?.strategyId ?? null, candidateId: latestIdentity?.candidateId ?? null, championId: latestIdentity?.championId ?? null }),
    latestSignal: timeline.find((event) => event.signal)?.signal ?? null,
    latestDecision: timeline.find((event) => event.decision)?.decision ?? null,
    latestGates: freeze([...(timeline.find((event) => event.gates?.length)?.gates ?? [])]),
    latestRisk: timeline.find((event) => event.risk)?.risk ?? null,
    latestFill: timeline.find((event) => event.fill)?.fill ?? null,
    latestAccount: timeline.find((event) => event.account)?.account ?? null,
    latestEvidence: timeline.find((event) => event.evidence)?.evidence ?? null,
    timeline,
    recentCycles,
    performance: buildPerformance(timeline),
    entryPoints: freeze(["HOME", "TRADE", "PORTFOLIO"] as const),
    autoRefresh: true
  });
}
