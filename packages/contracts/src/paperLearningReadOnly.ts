export type PaperLearningReadOnlyStage = "MARKET_DATA" | "SIGNAL" | "CANDIDATE" | "DECISION" | "PERMISSION" | "RISK" | "ORDER_INTENT" | "FILL" | "PNL" | "LEARNING" | "HALT" | "ERROR" | "IDEMPOTENCY";
export type PaperLearningReadOnlyStatus = "PASS" | "SKIP" | "FAIL";
export type PaperLearningRuntimeStatus = "RUNNING" | "PAUSED" | "HALTED" | "ERROR";

export interface PaperLearningReadOnlyGate {
  readonly name: string;
  readonly status: PaperLearningReadOnlyStatus;
  readonly reason: string;
}

export interface PaperLearningReadOnlyEvent {
  readonly id: string;
  readonly cycleId: string;
  readonly mode: "PAPER";
  readonly stage: PaperLearningReadOnlyStage;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: PaperLearningReadOnlyStatus;
  readonly reason?: string;
  readonly strategyId?: string;
  readonly candidateId?: string;
  readonly championId?: string;
  readonly signal?: Readonly<{ readonly action: "BUY" | "SELL" | "HOLD"; readonly confidence?: number }>;
  readonly gates?: readonly PaperLearningReadOnlyGate[];
  readonly risk?: Readonly<{ readonly status: PaperLearningReadOnlyStatus; readonly reason: string; readonly limits?: Readonly<Record<string, number>> }>;
  readonly evidence?: Readonly<{ readonly evidenceId?: string; readonly inputHash?: string; readonly score?: number; readonly outcome?: "PROMOTE" | "REJECT" | "PAUSE" | "UNCHANGED" }>;
  readonly decision?: Readonly<{ readonly action: "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE"; readonly allocation: number; readonly confidence: number }>;
  readonly fill?: Readonly<{ readonly side: "BUY" | "SELL"; readonly quantity: number; readonly price: number; readonly fee: number; readonly slippage?: number }>;
  readonly account?: Readonly<{ readonly cash: number; readonly equity: number; readonly realizedPnL: number; readonly unrealizedPnL: number }>;
}

export interface PaperLearningReadOnlySnapshot {
  readonly schemaVersion: 1;
  readonly mode: "PAPER";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly runtimeStatus: PaperLearningRuntimeStatus;
  readonly generatedAt: number;
  readonly events: readonly PaperLearningReadOnlyEvent[];
}

const stages = new Set<PaperLearningReadOnlyStage>(["MARKET_DATA", "SIGNAL", "CANDIDATE", "DECISION", "PERMISSION", "RISK", "ORDER_INTENT", "FILL", "PNL", "LEARNING", "HALT", "ERROR", "IDEMPOTENCY"]);
const statuses = new Set<PaperLearningReadOnlyStatus>(["PASS", "SKIP", "FAIL"]);
const runtimeStatuses = new Set<PaperLearningRuntimeStatus>(["RUNNING", "PAUSED", "HALTED", "ERROR"]);
const forbiddenKey = /(authorization|bearer|token|secret|api[_-]?key|access[_-]?key|account[_-]?id|order[_-]?id|fill[_-]?id)/i;

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertNoForbiddenKeys(value: unknown, path = "snapshot"): void {
  if (value == null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key)) throw new Error(`${path}.${key} is prohibited in PAPER learning read-only transport`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function validateEvent(event: PaperLearningReadOnlyEvent): void {
  if (event.mode !== "PAPER") throw new Error("PAPER learning event mode must be PAPER");
  if (!event.id.trim() || !event.cycleId.trim() || !event.market.trim()) throw new Error("PAPER learning event identity is invalid");
  if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("PAPER learning event timestamp is invalid");
  if (!stages.has(event.stage) || !statuses.has(event.status)) throw new Error("PAPER learning event state is invalid");
  if (event.signal?.confidence != null) finite(event.signal.confidence, "signal.confidence");
  if (event.decision != null) {
    finite(event.decision.allocation, "decision.allocation");
    finite(event.decision.confidence, "decision.confidence");
  }
  if (event.fill != null) {
    finite(event.fill.quantity, "fill.quantity");
    finite(event.fill.price, "fill.price");
    finite(event.fill.fee, "fill.fee");
    if (event.fill.quantity <= 0 || event.fill.price <= 0 || event.fill.fee < 0) throw new Error("PAPER learning fill values are invalid");
    if (event.fill.slippage != null) finite(event.fill.slippage, "fill.slippage");
  }
  if (event.account != null) {
    finite(event.account.cash, "account.cash"); finite(event.account.equity, "account.equity"); finite(event.account.realizedPnL, "account.realizedPnL"); finite(event.account.unrealizedPnL, "account.unrealizedPnL");
  }
  for (const gate of event.gates ?? []) if (!gate.name.trim() || !statuses.has(gate.status) || !gate.reason.trim()) throw new Error("PAPER learning gate is invalid");
  if (event.risk != null) {
    if (!statuses.has(event.risk.status) || !event.risk.reason.trim()) throw new Error("PAPER learning risk is invalid");
    for (const value of Object.values(event.risk.limits ?? {})) finite(value, "risk.limit");
  }
  if (event.evidence?.score != null) finite(event.evidence.score, "evidence.score");
  assertNoForbiddenKeys(event, "event");
}

const deepFreeze = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export function validatePaperLearningReadOnlySnapshot(snapshot: PaperLearningReadOnlySnapshot, maximumEvents = 250): PaperLearningReadOnlySnapshot {
  if (snapshot.schemaVersion !== 1 || snapshot.mode !== "PAPER" || snapshot.readOnly !== true || snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) throw new Error("PAPER learning transport authority invariant violated");
  if (!runtimeStatuses.has(snapshot.runtimeStatus)) throw new Error("PAPER learning runtime status is invalid");
  if (!Number.isSafeInteger(snapshot.generatedAt) || snapshot.generatedAt < 0) throw new Error("PAPER learning generatedAt is invalid");
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 1_000) throw new Error("PAPER learning transport limit is invalid");
  if (snapshot.events.length > maximumEvents) throw new Error("PAPER learning transport exceeds bounded event limit");
  const ids = new Set<string>();
  for (const event of snapshot.events) {
    validateEvent(event);
    if (ids.has(event.id)) throw new Error("PAPER learning transport contains duplicate event id");
    ids.add(event.id);
  }
  for (let index = 1; index < snapshot.events.length; index += 1) {
    const previous = snapshot.events[index - 1];
    const current = snapshot.events[index];
    if (previous.occurredAt < current.occurredAt || (previous.occurredAt === current.occurredAt && previous.id.localeCompare(current.id) > 0)) throw new Error("PAPER learning transport order is not deterministic newest-first");
  }
  assertNoForbiddenKeys(snapshot);
  return deepFreeze(structuredClone(snapshot));
}
