import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
  readonly decision?: Readonly<{
    readonly symbol?: string;
    readonly action: CioDecision["action"];
    readonly allocation: number;
    readonly confidence: number;
    readonly decidedAt?: number;
  }>;
  readonly fill?: Readonly<Pick<PaperFillRecord, "side" | "quantity" | "price" | "fee"> & {
    readonly id?: string;
    readonly orderId?: string;
    readonly filledAt?: number;
    readonly slippage?: number;
  }>;
  readonly account?: Pick<PaperAccountState, "cash" | "equity" | "realizedPnL" | "unrealizedPnL" | "updatedAt">;
}

export interface PaperLearningEventRecorderOptions {
  readonly persistencePath?: string;
  readonly maximumEvents?: number;
}

const PERSISTENCE_SCHEMA_VERSION = 1;
const DEFAULT_MAXIMUM_EVENTS = 250;
const MAXIMUM_EVENTS = 1_000;
const SECRET_PATTERN = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|account[_-]?id)\s*[:=]\s*[^,;\s]+/gi;
const MAX_TEXT_LENGTH = 500;
const stableId = (cycleId: string, stage: PaperLearningStage, suffix = "") => createHash("sha256").update(`${cycleId}:${stage}:${suffix}`, "utf8").digest("hex");
const freeze = <T>(value: T): T => Object.freeze(value);
const redactText = (value: string | undefined): string | undefined => value == null ? undefined : value.replace(SECRET_PATTERN, "$1=[REDACTED]").slice(0, MAX_TEXT_LENGTH);

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, MAX_TEXT_LENGTH) : undefined;
}

function sanitizedForPersistence(event: PaperLearningEvent): PaperLearningEvent {
  const gates = event.gates?.map((gate) => freeze({ name: gate.name.slice(0, 120), status: gate.status, reason: redactText(gate.reason) ?? "" }));
  const limits = event.risk?.limits == null ? undefined : freeze(Object.fromEntries(Object.entries(event.risk.limits).filter(([, value]) => Number.isFinite(value))));
  const risk = event.risk == null ? undefined : freeze({ status: event.risk.status, reason: redactText(event.risk.reason) ?? "", ...(limits == null ? {} : { limits }) });
  const evidence = event.evidence == null ? undefined : freeze({
    ...(safeString(event.evidence.evidenceId) == null ? {} : { evidenceId: safeString(event.evidence.evidenceId) }),
    ...(safeString(event.evidence.inputHash) == null ? {} : { inputHash: safeString(event.evidence.inputHash) }),
    ...(safeNumber(event.evidence.score) == null ? {} : { score: event.evidence.score }),
    ...(event.evidence.outcome == null ? {} : { outcome: event.evidence.outcome })
  });
  const fill = event.fill == null ? undefined : freeze({
    side: event.fill.side,
    quantity: event.fill.quantity,
    price: event.fill.price,
    fee: event.fill.fee,
    ...(event.fill.filledAt == null ? {} : { filledAt: event.fill.filledAt }),
    ...(event.fill.slippage == null ? {} : { slippage: event.fill.slippage })
  });
  const decision = event.decision == null ? undefined : freeze({
    ...(event.decision.symbol == null ? {} : { symbol: event.decision.symbol }),
    action: event.decision.action,
    allocation: event.decision.allocation,
    confidence: event.decision.confidence,
    ...(event.decision.decidedAt == null ? {} : { decidedAt: event.decision.decidedAt })
  });
  const account = event.account == null ? undefined : freeze({
    cash: event.account.cash,
    equity: event.account.equity,
    realizedPnL: event.account.realizedPnL,
    unrealizedPnL: event.account.unrealizedPnL,
    updatedAt: event.account.updatedAt
  });
  return freeze({
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
    ...(event.signal == null ? {} : { signal: freeze({ ...event.signal }) }),
    ...(gates == null ? {} : { gates: freeze(gates) }),
    ...(risk == null ? {} : { risk }),
    ...(evidence == null ? {} : { evidence }),
    ...(decision == null ? {} : { decision }),
    ...(fill == null ? {} : { fill }),
    ...(account == null ? {} : { account })
  });
}

function decodePersisted(value: unknown): PaperLearningEvent | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const id = safeString(raw.id);
  const cycleId = safeString(raw.cycleId);
  const market = safeString(raw.market);
  const stage = raw.stage;
  const status = raw.status;
  const occurredAt = safeNumber(raw.occurredAt);
  const stages: readonly PaperLearningStage[] = ["MARKET_DATA", "SIGNAL", "CANDIDATE", "DECISION", "PERMISSION", "RISK", "ORDER_INTENT", "FILL", "PNL", "LEARNING", "HALT", "ERROR", "IDEMPOTENCY"];
  if (raw.mode !== "PAPER" || id == null || cycleId == null || market == null || occurredAt == null || !Number.isSafeInteger(occurredAt) || occurredAt < 0 || !stages.includes(stage as PaperLearningStage) || !["PASS", "SKIP", "FAIL"].includes(String(status))) return undefined;
  try {
    return sanitizedForPersistence({ ...(raw as unknown as PaperLearningEvent), id, cycleId, market, occurredAt, stage: stage as PaperLearningStage, status: status as PaperLearningEvent["status"], mode: "PAPER" });
  } catch { return undefined; }
}

export function paperLearningCycleId(market: string, observedAt: number): string {
  return `paper:${market.trim().toUpperCase()}:${observedAt}`;
}

/**
 * Canonical PAPER observability recorder. Persistence is observability-only: it stores a bounded,
 * sanitized copy of events in the existing Cloud SQLite database and never replays into execution.
 * Raw simulator order/fill/account identifiers are deliberately omitted before durable write.
 */
export class PaperLearningEventRecorder {
  private readonly byId = new Map<string, PaperLearningEvent>();
  private readonly maximumEvents: number;
  private readonly persistencePath?: string;
  private persistence?: DatabaseSync;
  private hydrationAttempted = false;

  public constructor(options: PaperLearningEventRecorderOptions = {}) {
    this.maximumEvents = options.maximumEvents ?? DEFAULT_MAXIMUM_EVENTS;
    if (!Number.isSafeInteger(this.maximumEvents) || this.maximumEvents < 1 || this.maximumEvents > MAXIMUM_EVENTS) throw new Error("PAPER learning recorder limit is invalid");
    const configuredPath = options.persistencePath ?? process.env.NUSA_CLOUD_STATE_DB_PATH;
    this.persistencePath = configuredPath?.trim() || undefined;
  }

  public record(input: Omit<PaperLearningEvent, "id" | "mode"> & { readonly idSuffix?: string }): PaperLearningEvent {
    this.hydrate();
    const { idSuffix = "", ...rest } = input;
    const event = freeze({ ...rest, id: stableId(rest.cycleId, rest.stage, idSuffix), mode: "PAPER" as const });
    const existing = this.byId.get(event.id);
    if (existing) return existing;
    this.byId.set(event.id, event);
    this.pruneMemory();
    this.persist(event);
    return event;
  }

  public replay(): readonly PaperLearningEvent[] {
    this.hydrate();
    return freeze([...this.byId.values()].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)));
  }

  public close(): void {
    try { this.persistence?.close(); } catch { /* observability close is best-effort */ }
    this.persistence = undefined;
  }

  private hydrate(): void {
    if (this.hydrationAttempted) return;
    this.hydrationAttempted = true;
    if (this.persistencePath == null || this.persistencePath === ":memory:") return;
    try {
      const database = new DatabaseSync(this.persistencePath);
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = FULL");
      database.exec("CREATE TABLE IF NOT EXISTS paper_learning_observability_events (event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_paper_learning_observability_order ON paper_learning_observability_events(occurred_at DESC, event_id ASC)");
      const rows = database.prepare("SELECT event_id, payload_json FROM paper_learning_observability_events WHERE schema_version = ? ORDER BY occurred_at DESC, event_id ASC LIMIT ?").all(PERSISTENCE_SCHEMA_VERSION, this.maximumEvents) as Array<Record<string, unknown>>;
      for (const row of rows) {
        try {
          const decoded = decodePersisted(JSON.parse(String(row.payload_json ?? "")));
          if (decoded != null && decoded.id === String(row.event_id) && !this.byId.has(decoded.id)) this.byId.set(decoded.id, decoded);
        } catch { /* malformed monitoring history is ignored fail-closed */ }
      }
      this.persistence = database;
      this.pruneMemory();
      this.prunePersistence();
    } catch {
      try { this.persistence?.close(); } catch { /* no-op */ }
      this.persistence = undefined;
    }
  }

  private persist(event: PaperLearningEvent): void {
    if (this.persistence == null) return;
    try {
      const safe = sanitizedForPersistence(event);
      this.persistence.prepare("INSERT INTO paper_learning_observability_events (event_id, occurred_at, schema_version, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING").run(safe.id, safe.occurredAt, PERSISTENCE_SCHEMA_VERSION, JSON.stringify(safe));
      this.prunePersistence();
    } catch { /* observability persistence cannot mutate or halt PAPER execution */ }
  }

  private pruneMemory(): void {
    if (this.byId.size <= this.maximumEvents) return;
    const keep = [...this.byId.values()].sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id)).slice(0, this.maximumEvents);
    this.byId.clear();
    for (const event of keep) this.byId.set(event.id, event);
  }

  private prunePersistence(): void {
    if (this.persistence == null) return;
    this.persistence.prepare("DELETE FROM paper_learning_observability_events WHERE event_id NOT IN (SELECT event_id FROM paper_learning_observability_events WHERE schema_version = ? ORDER BY occurred_at DESC, event_id ASC LIMIT ?)").run(PERSISTENCE_SCHEMA_VERSION, this.maximumEvents);
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
