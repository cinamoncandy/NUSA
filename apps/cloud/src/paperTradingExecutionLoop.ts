import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { CioDecision } from "./cioDecisionEngine";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { PortfolioPlan } from "./portfolioOrchestrator";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";

const ACCOUNT_ID = "paper-default";
const SCHEMA_VERSION = 1;
const round8 = (value: number): number => Number(value.toFixed(8));
const finiteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
};

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

export interface PaperAccountRepository {
  save(state: PaperAccountState): void;
  loadLatest(): PaperAccountState | undefined;
  clear(): void;
}

export class SqliteCloudPaperAccountRepository implements PaperAccountRepository {
  private readonly db: SqliteDatabase;

  public constructor(db: SqliteDatabase) { this.db = db; }

  public save(state: PaperAccountState): void {
    validateState(state);
    const stateJson = JSON.stringify(state);
    this.db.transaction(() => {
      this.db.connection.prepare(`
        INSERT INTO cloud_paper_accounts (account_id, schema_version, updated_at, state_json, checksum, status)
        VALUES (?, ?, ?, ?, ?, 'VALID')
        ON CONFLICT(account_id) DO UPDATE SET
          schema_version=excluded.schema_version,
          updated_at=excluded.updated_at,
          state_json=excluded.state_json,
          checksum=excluded.checksum,
          status='VALID'
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

function accountChecksum(state: PaperAccountState): string {
  return createHash("sha256").update(JSON.stringify(state), "utf8").digest("hex");
}

function validateState(state: PaperAccountState): void {
  if (state.version !== 1) throw new Error("unsupported paper account state version");
  for (const [name, value] of [["initialCapital", state.initialCapital], ["cash", state.cash], ["equity", state.equity], ["realizedPnL", state.realizedPnL], ["unrealizedPnL", state.unrealizedPnL]] as const) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (state.initialCapital <= 0 || state.cash < 0 || state.equity < 0) throw new Error("paper account balance invariant failed");
  if (!Number.isSafeInteger(state.updatedAt) || state.updatedAt < 0) throw new Error("paper account updatedAt is invalid");
  for (const position of state.positions) {
    finiteNonNegative(position.quantity, "position.quantity");
    finiteNonNegative(position.averageEntryPrice, "position.averageEntryPrice");
    finiteNonNegative(position.markPrice, "position.markPrice");
  }
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

export interface PaperExecutionResult {
  readonly status: "FILLED" | "WAIT" | "BLOCKED" | "REJECTED" | "DUPLICATE" | "FAILED";
  readonly reason?: string;
  readonly orders: readonly PaperOrderRecord[];
  readonly fills: readonly PaperFillRecord[];
  readonly state: PaperAccountState;
}

export interface PaperExecutionSafetyState {
  readonly openP0: boolean;
}

/**
 * Bridges this loop's automated STRATEGY decisions to independentRiskGateway.ts's
 * evaluatePreTradeRisk(). The loop assembles the request (it owns the account state that
 * request needs: cash, position, order history); the caller supplies `evaluate`, which
 * already has identity (fingerprints, seen-id dedup sets) and limits closed over -- exactly
 * the split runtimeCommandService.ts's PaperCommandRiskGate uses on the desktop side. Before
 * this hook existed, this loop's tick processing called `broker.execute()`-equivalent order
 * placement directly from `state.decisions`, with only the coarse mode/killSwitch/health/P0
 * gate above -- none of independentRiskGateway's exposure, rate, drawdown, or consecutive-loss
 * circuit breakers ever ran on the automated cloud path.
 */
export interface PaperExecutionRiskGate {
  readonly fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>;
  evaluate(request: PreTradeRiskRequest): PreTradeRiskDecision;
}

export interface PaperTradingExecutionLoopOptions {
  readonly initialCapital: number;
  readonly feeRate?: number;
  readonly staleWindowMs?: number;
  readonly repository?: PaperAccountRepository;
  readonly restoredState?: PaperAccountState;
  /** Durable, independently verified P0 safety state. Read on every PAPER tick before any decision or fill. */
  readonly readP0State?: () => PaperExecutionSafetyState;
  /** Independent pre-trade risk check, run once per actionable decision before it can fill. */
  readonly riskGate?: PaperExecutionRiskGate;
}

function tradingDayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Same algorithm as paperRiskState.ts's computeOrderRateState, adapted to this loop's own
 * PaperOrderRecord (numeric `filledAt`, most-recent-first) instead of PaperBroker's PaperOrder. */
function computeOrderRateState(
  orders: readonly PaperOrderRecord[],
  nowMs: number,
  upcomingSide: "BUY" | "SELL"
): Readonly<{ ordersInLastSecond: number; ordersInLastMinute: number; sameSideStreak: number }> {
  let ordersInLastSecond = 0;
  let ordersInLastMinute = 0;
  for (const order of orders) {
    const age = nowMs - order.filledAt;
    if (age >= 0 && age < 1_000) ordersInLastSecond += 1;
    if (age >= 0 && age < 60_000) ordersInLastMinute += 1;
  }
  let sameSideStreak = 0;
  for (const order of orders) {
    if (order.side !== upcomingSide) break;
    sameSideStreak += 1;
  }
  return Object.freeze({ ordersInLastSecond, ordersInLastMinute, sameSideStreak });
}

function computeDailyNotional(
  orders: readonly PaperOrderRecord[],
  tradingDay: string
): Readonly<{ dailyBuyNotional: number; dailySellNotional: number }> {
  let dailyBuyNotional = 0;
  let dailySellNotional = 0;
  for (const order of orders) {
    if (tradingDayOf(order.filledAt) !== tradingDay) continue;
    const notional = order.quantity * order.price;
    if (order.side === "BUY") dailyBuyNotional += notional; else dailySellNotional += notional;
  }
  return Object.freeze({ dailyBuyNotional, dailySellNotional });
}

/** This loop's orders carry no per-fill running realizedPnL (unlike PaperBroker's ledger), so
 * a losing streak is read off order-level notional deltas instead: consecutive SELL fills
 * whose (price - the account's average entry price at the time) implied a loss. Orders are
 * most-recent-first, so this walks forward from the newest fill and stops at the first
 * non-loss or non-SELL entry. */
function computeConsecutiveLossCount(orders: readonly PaperOrderRecord[], positions: readonly PaperAccountPosition[]): number {
  let count = 0;
  for (const order of orders) {
    if (order.side !== "SELL") break;
    const position = positions.find((item) => item.market === order.market);
    const referenceEntry = position?.averageEntryPrice ?? order.price;
    if (order.price - referenceEntry >= 0) break;
    count += 1;
  }
  return count;
}

export class PaperTradingExecutionLoop {
  private state: PaperAccountState;
  private readonly feeRate: number;
  private readonly staleWindowMs: number;
  private readonly repository?: PaperAccountRepository;
  private readonly readP0State?: () => PaperExecutionSafetyState;
  private readonly riskGate?: PaperExecutionRiskGate;
  private sessionPeakEquity: number;

  public constructor(options: PaperTradingExecutionLoopOptions) {
    if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) throw new Error("paper initial capital must be positive");
    this.feeRate = options.feeRate ?? 0.0005;
    this.staleWindowMs = options.staleWindowMs ?? 30_000;
    if (!Number.isFinite(this.feeRate) || this.feeRate < 0) throw new Error("paper fee rate must be non-negative");
    if (!Number.isSafeInteger(this.staleWindowMs) || this.staleWindowMs < 1_000) throw new Error("paper stale window is invalid");
    this.repository = options.repository;
    this.readP0State = options.readP0State;
    this.riskGate = options.riskGate;
    const restored = options.restoredState ?? this.repository?.loadLatest();
    this.state = restored == null ? initialState(options.initialCapital) : restored;
    if (Math.abs(this.state.initialCapital - options.initialCapital) > Number.EPSILON) throw new Error("paper initial capital mismatch");
    validateState(this.state);
    this.sessionPeakEquity = this.state.equity;
  }

  public snapshot(): PaperAccountState { return this.state; }

  public processTick(tick: PaperExecutionTick): PaperExecutionResult {
    if (!Number.isSafeInteger(tick.now) || tick.now < 0 || !Number.isFinite(tick.price) || tick.price <= 0) return this.result("FAILED", "invalid tick");
    if (tick.mode === "PAPER" && this.readP0State != null) {
      try {
        if (this.readP0State().openP0) return this.result("BLOCKED", "OPEN_P0_ALERT");
      } catch {
        return this.result("BLOCKED", "P0_STATE_UNVERIFIABLE");
      }
    }
    if (tick.mode !== "PAPER" || tick.killSwitchActive || !tick.tradingAllowed || tick.overallHealth !== "HEALTHY") return this.result("BLOCKED", "paper execution gate is closed");
    if (!Number.isSafeInteger(tick.observedAt) || tick.observedAt < 0 || tick.observedAt > tick.now || tick.now - tick.observedAt >= this.staleWindowMs) return this.result("BLOCKED", "market data is stale");

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

      if (this.riskGate != null) {
        this.sessionPeakEquity = Number.isFinite(working.equity) && working.equity > this.sessionPeakEquity ? working.equity : this.sessionPeakEquity;
        const tradingDay = tradingDayOf(tick.now);
        const request: PreTradeRiskRequest = {
          schemaVersion: 1,
          requestId: key,
          signalId: `${tick.market}:${decision.decidedAt}`,
          commandId: key,
          clientOrderId: key,
          strategyFingerprint: this.riskGate.fingerprints.strategy,
          configFingerprint: this.riskGate.fingerprints.config,
          runtimeFingerprint: this.riskGate.fingerprints.runtime,
          riskPolicyFingerprint: this.riskGate.fingerprints.riskPolicy,
          symbol: tick.market,
          side,
          quantity,
          referencePrice: tick.price,
          requestedAt: tick.now,
          marketDataState: { status: "HEALTHY", price: tick.price },
          accountState: { cash: working.cash, positionQuantity: position?.quantity ?? 0, openOrderCount: working.orders.length },
          // killSwitch/health/mode/staleness are already fail-closed above (BLOCKED before this
          // point), and this loop has no live-trading or private-API capability to detect --
          // restating verified state here, not re-deciding it.
          controlState: { killSwitchActive: tick.killSwitchActive, liveCapabilityDetected: false, privateApiCapabilityDetected: false },
          approvalState: { approved: true, expiresAt: tick.now + 1, symbols: [tick.market] },
          persistenceState: { healthy: true },
          reconciliationState: { healthy: true, openP0: false },
          deploymentState: { integrityVerified: true },
          rateState: computeOrderRateState(working.orders, tick.now, side),
          exposureState: {
            symbolExposureNotional: (position?.quantity ?? 0) * tick.price,
            portfolioExposureNotional: working.positions.reduce((sum, item) => sum + item.quantity * item.markPrice, 0),
            ...computeDailyNotional(working.orders, tradingDay)
          },
          sessionState: {
            dailyRealizedPnL: working.realizedPnL,
            consecutiveLossCount: computeConsecutiveLossCount(working.orders, working.positions),
            sessionPeakEquity: this.sessionPeakEquity,
            sessionEquity: working.equity
          }
        };
        const riskDecision = this.riskGate.evaluate(request);
        if (riskDecision.status !== "ALLOW") {
          return this.result(riskDecision.status === "HALT" ? "BLOCKED" : "REJECTED", `risk gateway: ${riskDecision.reasonCodes.join(",") || riskDecision.status}`);
        }
      }

      let order: ReturnType<typeof executeOrder>;
      try {
        order = executeOrder(working, key, tick.market, side, quantity, tick.price, tick.now, this.feeRate);
      } catch (error) {
        return this.result("REJECTED", error instanceof Error ? error.message : "paper order rejected");
      }
      working = order.state;
      nextOrders.push(order.order);
      nextFills.push(order.fill);
      existingKeys.add(key);
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

  private result(status: PaperExecutionResult["status"], reason: string): PaperExecutionResult { return Object.freeze({ status, reason, orders: Object.freeze([]), fills: Object.freeze([]), state: this.state }); }
}

function initialState(initialCapital: number): PaperAccountState {
  return Object.freeze({ version: 1, initialCapital, cash: initialCapital, equity: initialCapital, realizedPnL: 0, unrealizedPnL: 0, positions: Object.freeze([]), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]), updatedAt: 0 });
}

function cloneState(state: PaperAccountState): PaperAccountState {
  return { ...state, positions: state.positions.map((item) => ({ ...item })), orders: [...state.orders], fills: [...state.fills], processedIdempotencyKeys: [...state.processedIdempotencyKeys] };
}

function executeOrder(state: PaperAccountState, key: string, market: string, side: "BUY" | "SELL", quantity: number, price: number, now: number, feeRate: number): { state: PaperAccountState; order: PaperOrderRecord; fill: PaperFillRecord } {
  const positions = state.positions.map((item) => ({ ...item }));
  const index = positions.findIndex((item) => item.market === market);
  const previous = index < 0 ? { market, quantity: 0, averageEntryPrice: 0, realizedPnL: 0, unrealizedPnL: 0, markPrice: price } : positions[index];
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
  const order: PaperOrderRecord = Object.freeze({ id, idempotencyKey: key, market, side, quantity, price, fee, status: "FILLED", createdAt: now, filledAt: now });
  const fill: PaperFillRecord = Object.freeze({ id: `fill:${id}`, orderId: id, market, side, quantity, price, fee, filledAt: now });
  return { state: { ...state, cash, realizedPnL, positions, orders: [order, ...state.orders].slice(0, 1_000), fills: [fill, ...state.fills].slice(0, 1_000), processedIdempotencyKeys: [key, ...state.processedIdempotencyKeys].slice(0, 2_000), updatedAt: now }, order, fill };
}

function markToMarket(state: PaperAccountState, market: string, price: number, now: number): PaperAccountState {
  const positions = state.positions.map((position) => position.market === market ? { ...position, markPrice: price, unrealizedPnL: round8(position.quantity * (price - position.averageEntryPrice)) } : position);
  const unrealizedPnL = round8(positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  const equity = round8(state.cash + positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  return Object.freeze({ ...state, positions: Object.freeze(positions), equity, unrealizedPnL, updatedAt: now });
}
