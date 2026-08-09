import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { CioDecision } from "./cioDecisionEngine";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { PortfolioPlan } from "./portfolioOrchestrator";

const ACCOUNT_ID = "paper-default";
const SCHEMA_VERSION = 1;
const round8 = (value: number): number => Number(value.toFixed(8));
const finiteNonNegative = (value: number, name: string): void => { if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`); };

export interface PaperAccountPosition {
  readonly market: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly markPrice: number;
}
export interface PaperOrderRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly status: "FILLED";
  readonly createdAt: number;
  readonly filledAt: number;
  readonly requestFingerprint?: string;
}
export interface PaperFillRecord {
  readonly id: string;
  readonly orderId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: number;
}
export interface PaperAccountState {
  readonly version: 1;
  readonly initialCapital: number;
  readonly cash: number;
  readonly equity: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly positions: readonly PaperAccountPosition[];
  readonly orders: readonly PaperOrderRecord[];
  readonly fills: readonly PaperFillRecord[];
  readonly processedIdempotencyKeys: readonly string[];
  readonly updatedAt: number;
}
export interface PaperAccountRepository { save(state: PaperAccountState): void; loadLatest(): PaperAccountState | undefined; clear(): void; }

export class SqliteCloudPaperAccountRepository implements PaperAccountRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public save(state: PaperAccountState): void {
    validateState(state);
    const stateJson = JSON.stringify(state);
    this.db.transaction(() => {
      this.db.connection.prepare(`
        INSERT INTO cloud_paper_accounts (account_id, schema_version, updated_at, state_json, checksum, status)
        VALUES (?, ?, ?, ?, ?, 'VALID')
        ON CONFLICT(account_id) DO UPDATE SET schema_version=excluded.schema_version, updated_at=excluded.updated_at,
          state_json=excluded.state_json, checksum=excluded.checksum, status='VALID'
      `).run(ACCOUNT_ID, SCHEMA_VERSION, state.updatedAt, stateJson, accountChecksum(state));
    });
  }
  public loadLatest(): PaperAccountState | undefined {
    const row = this.db.connection.prepare("SELECT * FROM cloud_paper_accounts WHERE account_id = ? AND status = 'VALID'").get(ACCOUNT_ID) as Record<string, string | number | null> | undefined;
    if (row == null) return undefined;
    try {
      if (Number(row.schema_version) !== SCHEMA_VERSION) throw new Error("unsupported paper account schema");
      const state = JSON.parse(String(row.state_json)) as PaperAccountState;
      validateState(state);
      if (String(row.checksum) !== accountChecksum(state)) throw new Error("paper account checksum mismatch");
      return state;
    } catch (error) {
      this.db.connection.prepare("UPDATE cloud_paper_accounts SET status = 'CORRUPTED' WHERE account_id = ?").run(ACCOUNT_ID);
      throw error;
    }
  }
  public clear(): void { this.db.transaction(() => { this.db.connection.prepare("DELETE FROM cloud_paper_accounts WHERE account_id = ?").run(ACCOUNT_ID); }); }
}

function accountChecksum(state: PaperAccountState): string { return createHash("sha256").update(JSON.stringify(state), "utf8").digest("hex"); }
function validateState(state: PaperAccountState): void {
  if (state.version !== 1) throw new Error("unsupported paper account state version");
  for (const [name, value] of [["initialCapital", state.initialCapital], ["cash", state.cash], ["equity", state.equity], ["realizedPnL", state.realizedPnL], ["unrealizedPnL", state.unrealizedPnL]] as const) if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  if (state.initialCapital <= 0 || state.cash < 0 || state.equity < 0) throw new Error("paper account balance invariant failed");
  if (!Number.isSafeInteger(state.updatedAt) || state.updatedAt < 0) throw new Error("paper account updatedAt is invalid");
  for (const position of state.positions) {
    finiteNonNegative(position.quantity, "position.quantity"); finiteNonNegative(position.averageEntryPrice, "position.averageEntryPrice"); finiteNonNegative(position.markPrice, "position.markPrice");
  }
  for (const order of state.orders) {
    if (order.requestFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(order.requestFingerprint)) throw new Error("paper order request fingerprint is invalid");
  }
}

function manualCommandFingerprint(command: PersonalPaperOrderCommand): string {
  const canonical = JSON.stringify({
    schemaVersion: command.schemaVersion,
    authority: command.authority,
    productionMutationAllowed: command.productionMutationAllowed,
    idempotencyKey: command.idempotencyKey,
    market: command.market.trim().toUpperCase(),
    side: command.side,
    orderType: command.orderType,
    quantity: command.quantity,
    limitPrice: command.limitPrice ?? null
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface PaperExecutionTick {
  readonly now: number;
  readonly market: string;
  readonly price: number;
  readonly quantity?: number;
  readonly observedAt: number;
  readonly mode: MobileDashboardApiInput["mode"];
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: MobileDashboardApiInput["overallHealth"];
  readonly decisions: readonly CioDecision[];
}
export interface PaperManualOrderContext {
  readonly now: number;
  readonly marketPrice: number;
  readonly observedAt: number;
  readonly mode: MobileDashboardApiInput["mode"];
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: MobileDashboardApiInput["overallHealth"];
}
export interface PaperExecutionResult {
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "DUPLICATE" | "FAILED";
  readonly reason?: string;
  readonly orders: readonly PaperOrderRecord[];
  readonly fills: readonly PaperFillRecord[];
  readonly state: PaperAccountState;
}
export interface PaperExecutionSafetyState { readonly openP0: boolean; }
export interface PaperTradingExecutionLoopOptions {
  readonly initialCapital: number;
  readonly feeRate?: number;
  readonly staleWindowMs?: number;
  readonly repository?: PaperAccountRepository;
  readonly restoredState?: PaperAccountState;
  readonly readP0State?: () => PaperExecutionSafetyState;
}

export class PaperTradingExecutionLoop {
  private state: PaperAccountState;
  private readonly feeRate: number;
  private readonly staleWindowMs: number;
  private readonly repository?: PaperAccountRepository;
  private readonly readP0State?: () => PaperExecutionSafetyState;

  public constructor(options: PaperTradingExecutionLoopOptions) {
    if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) throw new Error("paper initial capital must be positive");
    this.feeRate = options.feeRate ?? 0.0005;
    this.staleWindowMs = options.staleWindowMs ?? 30_000;
    if (!Number.isFinite(this.feeRate) || this.feeRate < 0) throw new Error("paper fee rate must be non-negative");
    if (!Number.isSafeInteger(this.staleWindowMs) || this.staleWindowMs < 1_000) throw new Error("paper stale window is invalid");
    this.repository = options.repository;
    this.readP0State = options.readP0State;
    const restored = options.restoredState ?? this.repository?.loadLatest();
    this.state = restored == null ? initialState(options.initialCapital) : restored;
    if (Math.abs(this.state.initialCapital - options.initialCapital) > Number.EPSILON) throw new Error("paper initial capital mismatch");
    validateState(this.state);
  }

  public snapshot(): PaperAccountState { return this.state; }

  public submitManualOrder(command: PersonalPaperOrderCommand, context: PaperManualOrderContext): PaperExecutionResult {
    if (!command.idempotencyKey.trim() || command.authority !== "PAPER_ONLY" || command.productionMutationAllowed !== false) return this.result("FAILED", "invalid PAPER order authority");
    if (!command.market.trim() || !Number.isFinite(command.quantity) || command.quantity <= 0) return this.result("FAILED", "invalid PAPER order command");
    const requestFingerprint = manualCommandFingerprint(command);
    const prior = this.state.orders.find((order) => order.idempotencyKey === command.idempotencyKey);
    if (prior != null) {
      if (prior.requestFingerprint !== requestFingerprint) return this.result("REJECTED", "PAPER_IDEMPOTENCY_CONFLICT");
      const fills = this.state.fills.filter((fill) => fill.orderId === prior.id);
      return Object.freeze({ status: "DUPLICATE", reason: command.idempotencyKey, orders: Object.freeze([prior]), fills: Object.freeze(fills), state: this.state });
    }
    if (this.state.processedIdempotencyKeys.includes(command.idempotencyKey)) return this.result("REJECTED", "PAPER_IDEMPOTENCY_CONFLICT");
    const gate = this.executionGate(context);
    if (gate != null) return this.result("BLOCKED", gate);
    const market = command.market.trim().toUpperCase();
    if (command.orderType === "LIMIT") {
      const limit = command.limitPrice;
      if (!Number.isFinite(limit) || (limit ?? 0) <= 0) return this.result("FAILED", "invalid PAPER limit price");
      const marketable = command.side === "BUY" ? context.marketPrice <= limit! : context.marketPrice >= limit!;
      if (!marketable) return this.result("REJECTED", "PAPER_LIMIT_NOT_MARKETABLE");
    }
    let executed: ReturnType<typeof executeOrder>;
    try {
      executed = executeOrder(this.state, command.idempotencyKey, market, command.side, command.quantity, context.marketPrice, context.now, this.feeRate, requestFingerprint);
    } catch (error) {
      return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected");
    }
    const working = markToMarket(executed.state, market, context.marketPrice, context.now);
    try {
      this.repository?.save(working);
    } catch {
      return this.result("FAILED", "paper account persistence failed");
    }
    this.state = working;
    return Object.freeze({ status: "FILLED", orders: Object.freeze([executed.order]), fills: Object.freeze([executed.fill]), state: this.state });
  }

  public processTick(tick: PaperExecutionTick): PaperExecutionResult {
    const gate = this.executionGate({ now: tick.now, marketPrice: tick.price, observedAt: tick.observedAt, mode: tick.mode, killSwitchActive: tick.killSwitchActive, tradingAllowed: tick.tradingAllowed, overallHealth: tick.overallHealth });
    if (gate != null) return this.result(gate === "invalid tick" ? "FAILED" : "BLOCKED", gate);
    if (tick.quantity !== undefined && (!Number.isFinite(tick.quantity) || tick.quantity <= 0)) return this.result("FAILED", "invalid order quantity");
    const actionable = tick.decisions.filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"));
    if (actionable.length === 0) return this.result("WAIT", "no actionable paper decision");
    const existingKeys = new Set(this.state.processedIdempotencyKeys);
    const nextOrders: PaperOrderRecord[] = [];
    const nextFills: PaperFillRecord[] = [];
    let working = cloneState(this.state);
    for (const decision of actionable.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.action.localeCompare(b.action))) {
      const key = `paper:${tick.market}:${tick.observedAt}:${decision.action}:${decision.decidedAt}`;
      if (existingKeys.has(key)) return this.result("DUPLICATE", key);
      const position = working.positions.find((item) => item.market === tick.market);
      const quantity = round8(tick.quantity ?? (decision.action === "SELL" ? position?.quantity ?? 0 : working.cash * decision.allocation / tick.price));
      if (quantity <= 0) return this.result("REJECTED", decision.action === "SELL" ? "insufficient paper position" : "decision allocation is zero");
      const side = decision.action === "BUY" ? "BUY" : "SELL";
      let order: ReturnType<typeof executeOrder>;
      try { order = executeOrder(working, key, tick.market, side, quantity, tick.price, tick.now, this.feeRate); }
      catch (error) { return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected"); }
      working = order.state; nextOrders.push(order.order); nextFills.push(order.fill); existingKeys.add(key);
    }
    working = markToMarket(working, tick.market, tick.price, tick.now);
    try { this.repository?.save(working); } catch { return this.result("FAILED", "paper account persistence failed"); }
    this.state = working;
    return Object.freeze({ status: "FILLED", orders: Object.freeze(nextOrders), fills: Object.freeze(nextFills), state: this.state });
  }

  public applyToDashboard(base: MobileDashboardApiInput, now: number): MobileDashboardApiInput {
    const deployed = this.state.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0);
    const allocations = this.state.positions.filter((position) => position.quantity > 0).map((position) => Object.freeze({ symbol: position.market, instrument: "SPOT" as const, action: "HOLD" as const, capital: round8(position.quantity * position.markPrice), share: this.state.equity > 0 ? round8(position.quantity * position.markPrice / this.state.equity) : 0, leverage: 1, confidence: 0, risk: "LOW" as const }));
    const portfolio: PortfolioPlan = Object.freeze({ allocations: Object.freeze(allocations), deployedCapital: round8(deployed), cashCapital: round8(this.state.cash), reservedCapital: 0, grossShare: this.state.equity > 0 ? round8(deployed / this.state.equity) : 0, futuresShare: 0, decidedAt: now });
    return Object.freeze({ ...base, now, portfolio, paper: Object.freeze({ cash: this.state.cash, equity: this.state.equity, realizedPnL: this.state.realizedPnL, unrealizedPnL: this.state.unrealizedPnL, orders: Object.freeze(this.state.orders.slice(0, 20)), fills: Object.freeze(this.state.fills.slice(0, 20)) }) });
  }

  private executionGate(context: PaperManualOrderContext): string | null {
    if (!Number.isSafeInteger(context.now) || context.now < 0 || !Number.isFinite(context.marketPrice) || context.marketPrice <= 0) return "invalid tick";
    if (context.mode === "PAPER" && this.readP0State != null) {
      try { if (this.readP0State().openP0) return "OPEN_P0_ALERT"; }
      catch { return "P0_STATE_UNVERIFIABLE"; }
    }
    if (context.mode !== "PAPER" || context.killSwitchActive || !context.tradingAllowed || context.overallHealth !== "HEALTHY") return "paper execution gate is closed";
    if (!Number.isSafeInteger(context.observedAt) || context.observedAt < 0 || context.observedAt > context.now || context.now - context.observedAt >= this.staleWindowMs) return "market data is stale";
    return null;
  }

  private result(status: PaperExecutionResult["status"], reason: string): PaperExecutionResult { return Object.freeze({ status, reason, orders: Object.freeze([]), fills: Object.freeze([]), state: this.state }); }
}

function initialState(initialCapital: number): PaperAccountState { return Object.freeze({ version: 1, initialCapital, cash: initialCapital, equity: initialCapital, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: 0 }); }
function cloneState(state: PaperAccountState): PaperAccountState { return { ...state, positions: state.positions.map((item) => ({ ...item })), orders: [...state.orders], fills: [...state.fills], processedIdempotencyKeys: [...state.processedIdempotencyKeys] }; }

function executeOrder(state: PaperAccountState, key: string, market: string, side: "BUY" | "SELL", quantity: number, price: number, now: number, feeRate: number, requestFingerprint?: string): { state: PaperAccountState; order: PaperOrderRecord; fill: PaperFillRecord } {
  const positions = state.positions.map((item) => ({ ...item }));
  const index = positions.findIndex((item) => item.market === market);
  const previous = index < 0 ? { market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: price } : positions[index]!;
  const notional = round8(quantity * price);
  const fee = round8(notional * feeRate);
  let cash = state.cash;
  let position: PaperAccountPosition;
  let realizedPnL = state.realizedPnL;
  if (side === "BUY") {
    if (notional + fee > cash) throw new Error("insufficient paper cash");
    const nextQuantity = round8(previous.quantity + quantity);
    position = { ...previous, quantity: nextQuantity, averageEntryPrice: round8((previous.averageEntryPrice * previous.quantity + notional + fee) / nextQuantity), markPrice: price };
    cash = round8(cash - notional - fee);
  } else {
    if (quantity > previous.quantity + Number.EPSILON) throw new Error("insufficient paper position");
    const realized = round8((price - previous.averageEntryPrice) * quantity - fee);
    const nextQuantity = round8(previous.quantity - quantity);
    position = { ...previous, quantity: nextQuantity, averageEntryPrice: nextQuantity === 0 ? 0 : previous.averageEntryPrice, realizedPnL: round8(previous.realizedPnL + realized), markPrice: price };
    realizedPnL = round8(realizedPnL + realized);
    cash = round8(cash + notional - fee);
  }
  if (index < 0) positions.push(position); else positions[index] = position;
  const id = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 24);
  const order: PaperOrderRecord = Object.freeze({ id, idempotencyKey: key, market, side, quantity, price, fee, status: "FILLED", createdAt: now, filledAt: now, ...(requestFingerprint === undefined ? {} : { requestFingerprint }) });
  const fill: PaperFillRecord = Object.freeze({ id: `fill:${id}`, orderId: id, market, side, quantity, price, fee, filledAt: now });
  return { state: { ...state, cash, realizedPnL, positions, orders: [order, ...state.orders].slice(0, 1_000), fills: [fill, ...state.fills].slice(0, 1_000), processedIdempotencyKeys: [key, ...state.processedIdempotencyKeys].slice(0, 2_000), updatedAt: now }, order, fill };
}

function markToMarket(state: PaperAccountState, market: string, price: number, now: number): PaperAccountState {
  const positions = state.positions.map((position) => position.market === market ? { ...position, markPrice: price, unrealizedPnL: round8(position.quantity * (price - position.averageEntryPrice)) } : position);
  const unrealizedPnL = round8(positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  const equity = round8(state.cash + positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  return Object.freeze({ ...state, positions: Object.freeze(positions), equity, unrealizedPnL, updatedAt: now });
}