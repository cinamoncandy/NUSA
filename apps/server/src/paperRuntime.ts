import { ControlPlane, type ControlSnapshot } from "../../desktop/src/controlPlane";
import { DesktopPersistenceStore } from "../../desktop/src/desktopPersistenceStore";
import { PaperBroker, type PaperAccountSnapshot, type PaperOrder, type PaperSide } from "../../desktop/src/paperBroker";
import { buildPaperDashboardSections } from "../../desktop/src/paperDashboardProjection";
import { RuntimeCommandService, type RuntimePersistence } from "../../desktop/src/runtimeCommandService";
import { SmaCrossoverStrategy, StrategyEngine, type TradingStrategy } from "../../desktop/src/strategyEngine";
import { EmaCrossoverStrategy } from "./emaCrossoverStrategy";
import { fetchRecentMinuteCandles, LiveCandleFeed, mapUpbitMinuteCandlesToChartCandles, type LiveCandleFeedHealth, type UpbitMinuteCandle } from "./liveCandleFeed";
import { runBacktest, type BacktestMetrics } from "../../desktop/src/backtestEngine";
import { DefaultRiskEngine as ValueRiskEngine } from "../../../packages/core/src/risk/riskEngine";
import { DefaultOrderPlanner as ValueOrderPlanner } from "../../../packages/core/src/order/orderPlanner";
import { DefaultPortfolioLedger, type Portfolio } from "../../../packages/core/src/portfolio/portfolio";
import { DefaultPnLCalculator, type PnLSnapshot } from "../../../packages/core/src/pnl/pnl";
import { filledExecutionReport, rejectedExecutionReport, type ExecutionReport } from "../../../packages/core/src/execution/executionReport";
import type { SizingMode } from "../../../packages/core/src/position/positionSizer";
import { AutomaticTradingPipeline, type ReferenceAccounting } from "./pipeline/automaticTradingPipeline";
import { PositionSizerOrderPlanner } from "./pipeline/positionSizerAdapter";
import { PaperExecutor } from "./pipeline/paperExecutor";
import { RiskEngine } from "./pipeline/riskEngine";
import {
  loadStrategyChoice, saveStrategyChoice, loadStrategyPeriods, saveStrategyPeriods,
  loadPositionProtection, savePositionProtection, loadPositionSizing, savePositionSizing,
  loadLimitOrders, saveLimitOrders
} from "./runtimeSettingsStore";
import { reconcileReferenceAccounting, type ReconciliationResult } from "./referenceReconciliation";
import { EquityHistoryRecorder, type EquitySample } from "./equityHistory";
import { computeTradeStatistics, type TradeStatistics } from "./tradeStatistics";
import { computeDrawdownStatistics, type DrawdownStatistics } from "./drawdown";
import { ChampionChallengerSystem, CHAMPION_CHALLENGER_PRESETS, createChallengerStrategy, type ChampionStandings } from "./championSystem";

type CandleFetcher = (market: string, unitMinutes: number, count: number) => Promise<readonly UpbitMinuteCandle[]>;

export interface LimitOrder {
  readonly id: string;
  readonly side: PaperSide;
  readonly quantity: number;
  readonly limitPrice: number;
  readonly createdAt: string;
}

const INITIAL_CASH_DEFAULT = 10_000_000;
const FEE_RATE_DEFAULT = 0.0005;
// Same conservative defaults as apps/desktop/src/main.ts's RISK_POLICY/FILL_MODEL: minOrderNotional
// matches Upbit's documented 5,000 KRW minimum; priceTick is left unset (tiered by price range);
// slippage/spread bias results pessimistically rather than assuming perfect execution.
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };
const REQUIRED_WARMUP_SAMPLES = 20;
// A fixed placeholder id, independent of which trading strategy (SMA/EMA) is actually
// selected -- ControlPlane's persisted strategyId must stay constant across restarts for
// restoreState() to succeed regardless of which strategy the operator has picked; the real
// active strategy id/name is tracked here in PaperRuntime instead (see currentStrategyId()).
const CONTROL_PLANE_STRATEGY_ID = "web-runtime";

export type StrategyChoice = "sma-crossover" | "ema-crossover";
export interface StrategyPeriods {
  readonly shortPeriod: number;
  readonly longPeriod: number;
}
const DEFAULT_STRATEGY_PERIODS: StrategyPeriods = Object.freeze({ shortPeriod: 5, longPeriod: 20 });

// Both SmaCrossoverStrategy/EmaCrossoverStrategy validate (integer, shortPeriod >= 2,
// longPeriod > shortPeriod) in their own constructors and throw on violation -- reused as-is
// here rather than duplicating that rule, so an invalid setStrategyPeriods() call fails with
// the exact same message the strategy classes themselves already define.
const STRATEGY_FACTORIES: Readonly<Record<StrategyChoice, (periods: StrategyPeriods) => TradingStrategy>> = Object.freeze({
  "sma-crossover": (periods) => new SmaCrossoverStrategy(periods.shortPeriod, periods.longPeriod),
  "ema-crossover": (periods) => new EmaCrossoverStrategy(periods.shortPeriod, periods.longPeriod)
});

export interface PaperRuntimeOptions {
  readonly databasePath: string;
  readonly market?: string;
  readonly initialCash?: number;
  readonly feeRate?: number;
  readonly candleUnitMinutes?: number;
  readonly candleCount?: number;
  readonly pollIntervalMs?: number;
  /** How stale the last successful candle poll may be before prices are considered unusable. */
  readonly maximumMarketDataAgeMs?: number;
  /** Test injection point: overrides the real Upbit network fetch (default: fetchRecentMinuteCandles). */
  readonly candleFetcher?: CandleFetcher;
  /** Where the selected strategy (SMA/EMA) is persisted across restarts. Defaults to `${databasePath}.strategy-choice.json`. */
  readonly strategyChoicePath?: string;
}

export interface MarketSnapshot extends LiveCandleFeedHealth {
  readonly price?: number;
}

/**
 * Single-user Paper-trading runtime for the web server: the same reusable business logic
 * apps/desktop/src/main.ts wires up for Electron (PaperBroker, StrategyEngine, ControlPlane,
 * RuntimeCommandService, the AI CIO dashboard projection), driven by LiveCandleFeed's polled
 * Upbit REST prices instead of a WebSocket ticker so this server needs no "ws" dependency.
 *
 * Single-user, single-account, independent of the Electron app's own SQLite file: this is a
 * new, separate product surface, not a replacement for or a shared-state peer of PR #1's
 * Electron desktop app. Multi-user accounts are an explicitly later phase, not built here.
 */
export class PaperRuntime {
  private readonly market: string;
  private readonly initialCash: number;
  private readonly feeRate: number;
  private readonly candleFetcher: CandleFetcher;
  private readonly maximumMarketDataAgeMs: number;
  private readonly persistenceStore: DesktopPersistenceStore | undefined;
  private readonly broker: PaperBroker;
  private readonly control: ControlPlane;
  private readonly strategyEngine: StrategyEngine;
  private readonly runtime: RuntimeCommandService;
  private readonly automaticPipeline: AutomaticTradingPipeline;
  private readonly candleFeed: LiveCandleFeed;
  /** Audit-only parallel reference (E02-T006/T007), never the real account's source of
   * truth -- see AutomaticTradingPipeline's ReferenceAccounting doc comment. */
  private referencePortfolio: Portfolio;
  private readonly referencePnlCalculator = new DefaultPnLCalculator();
  private readonly referenceLedger = new DefaultPortfolioLedger();
  private readonly equityHistory = new EquityHistoryRecorder();
  /** Shadow strategy comparison (see championSystem.ts) -- fully isolated from the real
   * account, never persisted (resets on restart, same posture as equityHistory/referencePortfolio
   * above), never read back into any real trading decision. Promotion is manual-only. */
  private readonly championSystem: ChampionChallengerSystem;
  /** Persisted best-effort to strategyChoicePath (see runtimeSettingsStore.ts); cleared once
   * triggered or the position is flat -- see setPositionProtection(). */
  private stopLossPrice: number | null = null;
  private takeProfitPrice: number | null = null;
  /** Mutually exclusive with stopLossPrice (see setPositionProtection's validation): when set,
   * the effective stop level ratchets up to trailingPeakPrice * (1 - trailingStopPercent) as
   * the price rises, and never down. trailingPeakPrice is the highest price observed since
   * trailing was enabled (or since the position was last flat); null until the first tick
   * after being enabled. */
  private trailingStopPercent: number | null = null;
  private trailingPeakPrice: number | null = null;
  /** Persisted best-effort (see runtimeSettingsStore.ts), same posture as position protection
   * above -- pending limit orders, checked and filled on candle ticks in checkLimitOrders(). */
  private readonly limitOrders: LimitOrder[] = [];
  private limitOrderSequence = 0;
  /** Persisted best-effort, same as the fields above. FIXED_FRACTIONAL sizes each automatic
   * trade to riskFraction * equity / price (packages/core's DefaultPositionSizer, E02-T004)
   * instead of ControlPlane's static order quantity -- see the policyFor closure passed into
   * AutomaticTradingPipeline below. Only affects automatic (strategy-driven) trades; manual
   * orders via placeOrder() always use the exact quantity the caller requests. */
  private sizingMode: SizingMode = "FIXED";
  private riskFraction = 0.1;
  private readonly strategyChoicePath: string;
  private currentStrategyId: StrategyChoice;
  private strategyPeriods: StrategyPeriods;
  private paperTradingAvailable: boolean;

  constructor(options: PaperRuntimeOptions) {
    this.market = options.market ?? "KRW-BTC";
    this.initialCash = options.initialCash ?? INITIAL_CASH_DEFAULT;
    // Audit-only reference state; reset on every restart rather than persisted, since it
    // exists to cross-check the real account (which does survive restarts via
    // DesktopPersistenceStore), not to be a second durable ledger.
    this.referencePortfolio = { cash: this.initialCash, quantity: 0, averagePrice: 0, realizedPnl: 0 };
    const feeRate = options.feeRate ?? FEE_RATE_DEFAULT;
    this.feeRate = feeRate;
    this.candleFetcher = options.candleFetcher ?? fetchRecentMinuteCandles;
    this.maximumMarketDataAgeMs = options.maximumMarketDataAgeMs ?? 60_000;
    this.strategyChoicePath = options.strategyChoicePath ?? `${options.databasePath}.strategy-choice.json`;
    this.currentStrategyId = loadStrategyChoice(this.strategyChoicePath) ?? "sma-crossover";
    this.strategyPeriods = loadStrategyPeriods(this.strategyChoicePath) ?? DEFAULT_STRATEGY_PERIODS;

    const restoredProtection = loadPositionProtection(this.strategyChoicePath);
    if (restoredProtection) {
      this.stopLossPrice = restoredProtection.stopLossPrice;
      this.takeProfitPrice = restoredProtection.takeProfitPrice;
      this.trailingStopPercent = restoredProtection.trailingStopPercent;
      this.trailingPeakPrice = restoredProtection.trailingPeakPrice;
    }
    const restoredSizing = loadPositionSizing(this.strategyChoicePath);
    if (restoredSizing) {
      this.sizingMode = restoredSizing.mode;
      this.riskFraction = restoredSizing.riskFraction;
    }
    const restoredLimitOrders = loadLimitOrders(this.strategyChoicePath);
    if (restoredLimitOrders) {
      this.limitOrders.push(...restoredLimitOrders.orders);
      this.limitOrderSequence = restoredLimitOrders.sequence;
    }

    let diagnostic: string | undefined;
    let restored: ReturnType<DesktopPersistenceStore["load"]>;
    let store: DesktopPersistenceStore | undefined;
    try {
      store = new DesktopPersistenceStore(options.databasePath);
      restored = store.load();
    } catch (error) {
      diagnostic = `SQLite recovery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.persistenceStore = store;

    this.strategyEngine = new StrategyEngine(STRATEGY_FACTORIES[this.currentStrategyId](this.strategyPeriods));
    if (store) {
      try {
        const restoredHistory = store.loadStrategyPriceHistory();
        if (restoredHistory) this.strategyEngine.restoreHistory(restoredHistory);
      } catch {
        // Best-effort continuity only: fall back to warming up from empty history.
      }
    }

    this.broker = new PaperBroker(this.initialCash, this.market, feeRate, RISK_POLICY, restored?.paper, FILL_MODEL);
    this.control = new ControlPlane(CONTROL_PLANE_STRATEGY_ID, 200, restored?.control);
    this.championSystem = new ChampionChallengerSystem(this.market, this.initialCash, feeRate, RISK_POLICY, FILL_MODEL);

    const persistenceAdapter: RuntimePersistence = {
      save: (paper, control) => {
        if (!this.persistenceStore) throw new Error("SQLite persistence is unavailable");
        this.persistenceStore.save(paper, control);
      }
    };
    this.runtime = new RuntimeCommandService(this.broker, this.control, this.strategyEngine, persistenceAdapter);
    this.automaticPipeline = new AutomaticTradingPipeline(
      this.broker,
      this.control,
      this.strategyEngine,
      new RiskEngine(),
      // The pipeline's "PositionSizer" stage (E02-T004), reproducing the exact prior FIXED
      // quantity behavior (ControlPlane's static, operator-set order quantity) by default;
      // reads this.sizingMode/riskFraction at call time, so setPositionSizing() below takes
      // effect on the very next automatic trade without reconstructing the pipeline.
      new PositionSizerOrderPlanner((context) => this.sizingMode === "FIXED"
        ? { mode: "FIXED", fixedQuantity: context.fixedOrderQuantity }
        : { mode: "FIXED_FRACTIONAL", riskFraction: this.riskFraction }),
      new PaperExecutor(this.broker),
      (paper, control) => {
        if (!this.persistenceStore) throw new Error("SQLite persistence is unavailable");
        this.persistenceStore.save(paper, control);
      },
      () => { this.runtime.markUnavailable(); this.paperTradingAvailable = false; },
      new ValueRiskEngine(),
      // Reuses PaperBroker's own already-agreed limits (RISK_POLICY above) rather than a new
      // invented threshold: minOrderNotional as-is, maxPositionQuantity converted to a value
      // at the current price since PaperBroker's own limit is quantity-based.
      (price) => ({ minimumOrderValue: RISK_POLICY.minOrderNotional, maximumPositionValue: RISK_POLICY.maxPositionQuantity * price }),
      new ValueOrderPlanner(),
      // Reuses the exact same feeRate/effective-adverse-rate this app already computes for
      // the dashboard's executionCostBps (FILL_MODEL.slippageBps + spreadBps / 2), not a new
      // invented number, just converted from bps to a [0,1] rate.
      { feeRate, slippageRate: (FILL_MODEL.slippageBps + FILL_MODEL.spreadBps / 2) / 10_000 },
      {
        ledger: this.referenceLedger,
        pnlCalculator: this.referencePnlCalculator,
        getPortfolio: () => this.referencePortfolio,
        setPortfolio: (portfolio) => { this.referencePortfolio = portfolio; }
      } satisfies ReferenceAccounting
    );

    this.paperTradingAvailable = diagnostic === undefined;
    if (this.control.snapshot().status === "RUNNING") this.strategyEngine.start();
    if (diagnostic) this.control.fault(diagnostic);
    if (!this.paperTradingAvailable) this.runtime.markUnavailable();

    this.candleFeed = new LiveCandleFeed(
      this.market,
      options.candleUnitMinutes ?? 1,
      options.candleCount ?? 200,
      (candles) => this.handleCandleUpdate(candles[candles.length - 1]!.close),
      options.pollIntervalMs ?? 10_000,
      this.candleFetcher
    );
  }

  start(): void { this.candleFeed.start(); }
  dispose(): void { this.candleFeed.stop(); this.persistenceStore?.close(); }

  /**
   * The Candle -> Indicator -> TradingIntent -> RiskEngine -> OrderPlanner -> PaperExecutor
   * -> Position/Portfolio pipeline. StrategyEngine.onTick() covers Indicator+TradingIntent
   * (delegating to SmaCrossoverStrategy or EmaCrossoverStrategy, whichever is selected);
   * AutomaticTradingPipeline covers RiskEngine through PaperExecutor.
   */
  private handleCandleUpdate(price: number): void {
    const timestamp = Date.now();
    // Always runs, independent of the real account's availability -- fully isolated shadow
    // state (see championSystem.ts), so a real-account fault has no reason to pause it.
    this.championSystem.onCandleUpdate(this.market, price, timestamp);
    if (this.runtime.isAvailable()) {
      this.checkPositionProtection(price);
      this.checkLimitOrders(price);
    }
    const account = this.broker.snapshot(price);
    const intent = this.strategyEngine.onTick({ market: this.market, price, timestamp }, account.position.quantity);
    if (this.persistenceStore) {
      try { this.persistenceStore.saveStrategyPriceHistory(this.strategyEngine.getHistory()); } catch {
        // Best-effort continuity only; never affects paperTradingAvailable or the account/control write path.
      }
    }
    if (!this.runtime.isAvailable()) {
      this.equityHistory.record(timestamp, account.equity);
      return;
    }
    this.automaticPipeline.process(intent, this.market, price, account.equity);
    this.paperTradingAvailable = this.runtime.isAvailable();
    // Re-snapshot: a trade may have just fired this tick, so this captures post-trade equity.
    this.equityHistory.record(timestamp, this.broker.snapshot(price).equity);
  }

  /**
   * Stop-loss/take-profit: an independent safety exit for the *current* position, separate
   * from (and checked before) the strategy signal pipeline -- it must not depend on the
   * "Paper 자동매매" toggle, since it can be protecting a manually-opened position. Reuses
   * RuntimeCommandService.manualOrder() (the exact same tested snapshot/rollback/persistence
   * path a user's own manual sell takes) rather than the strategy pipeline's OrderPlanner,
   * since this always closes the *entire* position at market -- not a sized new entry, so
   * OrderPlanner's fixed/fractional sizing doesn't apply. Levels are in-memory only (reset on
   * restart, see setPositionProtection). A single order can be capped below the requested
   * quantity by PaperBroker's own fill model, so the level is only cleared once the position
   * is actually flat (retried on later ticks otherwise) or a sell attempt fails outright (a
   * leftover dust remainder can never fill, so protection is disabled rather than retried
   * forever) -- never cleared just because a trigger fired once.
   */
  private checkPositionProtection(price: number): void {
    if (this.stopLossPrice === null && this.takeProfitPrice === null && this.trailingStopPercent === null) return;
    const position = this.broker.snapshot(price).position;
    if (position.quantity <= 0) {
      // The position closed some other way (e.g. a manual sell) while a level was set --
      // nothing left to protect, so drop the now-meaningless level(s) instead of leaving them
      // dormant for whatever position is opened next.
      this.stopLossPrice = null;
      this.takeProfitPrice = null;
      this.trailingStopPercent = null;
      this.trailingPeakPrice = null;
      this.savePositionProtectionState();
      return;
    }

    let effectiveStopLoss = this.stopLossPrice;
    if (this.trailingStopPercent !== null) {
      this.trailingPeakPrice = Math.max(this.trailingPeakPrice ?? price, price);
      effectiveStopLoss = this.trailingPeakPrice * (1 - this.trailingStopPercent);
    }

    const label = effectiveStopLoss !== null && price <= effectiveStopLoss
      ? (this.trailingStopPercent !== null ? "trailing-stop" : "stop-loss")
      : this.takeProfitPrice !== null && price >= this.takeProfitPrice
        ? "take-profit"
        : null;
    if (!label) return;

    try {
      const order = this.runtime.manualOrder("SELL", position.quantity, price);
      this.control.record("RISK", `${label} triggered at ${price}: closed ${order.quantity} ${this.market}`, order);
      this.recordReferenceExecution(filledExecutionReport({
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        fee: order.fee,
        symbol: this.market
      }), price);
      // PaperBroker's fill model can cap a single order below the full requested quantity
      // (see FILL_MODEL.maxFillRatio) -- only clear once the position is actually flat;
      // otherwise leave the level(s) active so the next tick retries closing the remainder.
      if (this.broker.snapshot(price).position.quantity <= 0) {
        this.stopLossPrice = null;
        this.takeProfitPrice = null;
        this.trailingStopPercent = null;
        this.trailingPeakPrice = null;
      }
      this.savePositionProtectionState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Give up rather than retry forever: a leftover dust remainder (below the market's
      // minimum order notional/step) can never be sold via a normal order, so an unconditional
      // retry would just repeat this same failure on every future tick.
      this.stopLossPrice = null;
      this.takeProfitPrice = null;
      this.trailingStopPercent = null;
      this.trailingPeakPrice = null;
      this.savePositionProtectionState();
      this.control.record("RISK", `${label} trigger failed, protection disabled: ${message}`);
    } finally {
      this.paperTradingAvailable = this.runtime.isAvailable();
    }
  }

  /**
   * Fills a pending limit order at the current market price once its condition is met (BUY:
   * price <= limitPrice; SELL: price >= limitPrice) -- same simplification stop-loss/take-profit
   * already use (this app models no real order book, so "the price crossed the level" is the
   * fill signal, not a simulated matching engine). Reuses RuntimeCommandService.manualOrder()
   * for the same reason position protection does: it's the exact tested snapshot/rollback/
   * persistence path a real manual order takes. Checked on every candle tick, independent of
   * the "Paper 자동매매" toggle -- a limit order is the user's own explicit standing instruction,
   * not a strategy signal.
   */
  private checkLimitOrders(price: number): void {
    if (this.limitOrders.length === 0) return;
    for (const order of [...this.limitOrders]) {
      const triggered = order.side === "BUY" ? price <= order.limitPrice : price >= order.limitPrice;
      if (!triggered) continue;
      try {
        const filled = this.runtime.manualOrder(order.side, order.quantity, price);
        this.control.record("RISK", `limit order triggered at ${price}: ${order.side} ${filled.quantity} (limit ${order.limitPrice})`, filled);
        this.recordReferenceExecution(filledExecutionReport({
          side: filled.side,
          quantity: filled.quantity,
          price: filled.price,
          fee: filled.fee,
          symbol: this.market
        }), price);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Same give-up-rather-than-retry-forever posture as position protection: a limit order
        // that fails once (e.g. insufficient cash/position) will very likely keep failing, so
        // silently retrying every future tick would just repeat it.
        this.control.record("RISK", `limit order failed, cancelled: ${message}`, order);
      } finally {
        this.paperTradingAvailable = this.runtime.isAvailable();
      }
      const index = this.limitOrders.findIndex((pending) => pending.id === order.id);
      if (index >= 0) this.limitOrders.splice(index, 1);
      this.saveLimitOrdersState();
    }
  }

  getLimitOrders(): readonly LimitOrder[] { return [...this.limitOrders]; }

  createLimitOrder(side: PaperSide, quantity: number, limitPrice: number): LimitOrder {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be a positive number");
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error("limitPrice must be a positive number");
    this.limitOrderSequence += 1;
    const order: LimitOrder = Object.freeze({
      id: `${Date.now()}-${this.limitOrderSequence}`,
      side,
      quantity,
      limitPrice,
      createdAt: new Date().toISOString()
    });
    this.limitOrders.push(order);
    this.saveLimitOrdersState();
    this.control.record("STATUS", `limit order placed: ${side} ${quantity} @ ${limitPrice}`, order);
    return order;
  }

  cancelLimitOrder(id: string): void {
    const index = this.limitOrders.findIndex((order) => order.id === id);
    if (index < 0) throw new Error(`no pending limit order with id ${id}`);
    const [cancelled] = this.limitOrders.splice(index, 1);
    this.saveLimitOrdersState();
    this.control.record("STATUS", `limit order cancelled: ${cancelled!.side} ${cancelled!.quantity} @ ${cancelled!.limitPrice}`);
  }

  /** Best-effort persistence, same convention as selectStrategy()/setStrategyPeriods()'s own
   * save calls -- a failed write here only means the next restart falls back to defaults,
   * never an account/control fault. */
  private savePositionProtectionState(): void {
    try {
      savePositionProtection(this.strategyChoicePath, {
        stopLossPrice: this.stopLossPrice,
        takeProfitPrice: this.takeProfitPrice,
        trailingStopPercent: this.trailingStopPercent,
        trailingPeakPrice: this.trailingPeakPrice
      });
    } catch {
      // Best-effort continuity only.
    }
  }

  private savePositionSizingState(): void {
    try {
      savePositionSizing(this.strategyChoicePath, { mode: this.sizingMode, riskFraction: this.riskFraction });
    } catch {
      // Best-effort continuity only.
    }
  }

  private saveLimitOrdersState(): void {
    try {
      saveLimitOrders(this.strategyChoicePath, { orders: this.limitOrders, sequence: this.limitOrderSequence });
    } catch {
      // Best-effort continuity only.
    }
  }

  getPositionProtection(): {
    readonly stopLossPrice: number | null;
    readonly takeProfitPrice: number | null;
    readonly trailingStopPercent: number | null;
    /** The trailing stop's current effective sell level, for display -- null unless trailing
     * is active and at least one tick has priced it (trailingPeakPrice is set). */
    readonly currentTrailingStopPrice: number | null;
  } {
    return {
      stopLossPrice: this.stopLossPrice,
      takeProfitPrice: this.takeProfitPrice,
      trailingStopPercent: this.trailingStopPercent,
      currentTrailingStopPrice: this.trailingStopPercent !== null && this.trailingPeakPrice !== null
        ? this.trailingPeakPrice * (1 - this.trailingStopPercent)
        : null
    };
  }

  /**
   * All three fields are required on every call (idempotent full-replace, matching
   * setOrderQuantity's style) -- null clears that setting. stopLossPrice and
   * trailingStopPercent are mutually exclusive (both describe "the stop-loss level", just
   * fixed vs. ratcheting) -- setting both is rejected rather than silently picking one.
   * Validated here rather than in apiRouter.ts, same convention as ControlPlane's own domain
   * checks (e.g. setOrderQuantity).
   */
  setPositionProtection(input: {
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    trailingStopPercent: number | null;
  }): ReturnType<PaperRuntime["getPositionProtection"]> {
    const { stopLossPrice, takeProfitPrice, trailingStopPercent } = input;
    if (stopLossPrice !== null && (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0)) {
      throw new Error("stopLossPrice must be a positive number or null");
    }
    if (takeProfitPrice !== null && (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0)) {
      throw new Error("takeProfitPrice must be a positive number or null");
    }
    if (stopLossPrice !== null && takeProfitPrice !== null && stopLossPrice >= takeProfitPrice) {
      throw new Error("stopLossPrice must be less than takeProfitPrice");
    }
    if (trailingStopPercent !== null && (!Number.isFinite(trailingStopPercent) || trailingStopPercent <= 0 || trailingStopPercent >= 1)) {
      throw new Error("trailingStopPercent must be finite and within (0, 1) or null");
    }
    if (stopLossPrice !== null && trailingStopPercent !== null) {
      throw new Error("stopLossPrice and trailingStopPercent are mutually exclusive -- set only one");
    }
    this.stopLossPrice = stopLossPrice;
    this.takeProfitPrice = takeProfitPrice;
    if (trailingStopPercent !== this.trailingStopPercent) this.trailingPeakPrice = null;
    this.trailingStopPercent = trailingStopPercent;
    this.savePositionProtectionState();
    this.control.record(
      "STATUS",
      `position protection set: stopLoss=${stopLossPrice ?? "-"} takeProfit=${takeProfitPrice ?? "-"} trailingStopPercent=${trailingStopPercent ?? "-"}`
    );
    return this.getPositionProtection();
  }

  getPositionSizing(): { readonly mode: SizingMode; readonly riskFraction: number } {
    return { mode: this.sizingMode, riskFraction: this.riskFraction };
  }

  /**
   * riskFraction is required only when mode is FIXED_FRACTIONAL (fraction of equity risked
   * per automatic trade); FIXED keeps using ControlPlane's existing order-quantity setting
   * and ignores riskFraction entirely if one is passed. Only affects automatic trades -- see
   * the sizingMode field's own doc comment.
   */
  setPositionSizing(input: { mode: SizingMode; riskFraction?: number }): { readonly mode: SizingMode; readonly riskFraction: number } {
    if (input.mode !== "FIXED" && input.mode !== "FIXED_FRACTIONAL") {
      throw new Error("mode must be \"FIXED\" or \"FIXED_FRACTIONAL\"");
    }
    if (input.mode === "FIXED_FRACTIONAL") {
      if (input.riskFraction === undefined || !Number.isFinite(input.riskFraction) || input.riskFraction <= 0 || input.riskFraction > 1) {
        throw new Error("riskFraction must be finite and within (0, 1] when mode is FIXED_FRACTIONAL");
      }
      this.riskFraction = input.riskFraction;
    }
    this.sizingMode = input.mode;
    this.savePositionSizingState();
    this.control.record("STATUS", `position sizing set: mode=${input.mode}${input.mode === "FIXED_FRACTIONAL" ? ` riskFraction=${this.riskFraction}` : ""}`);
    return this.getPositionSizing();
  }

  private assertFreshPrice(): number {
    const health = this.candleFeed.health();
    const candles = this.candleFeed.latestCandles();
    if (health.status !== "CONNECTED" || candles.length === 0 || health.lastUpdatedAt === undefined) {
      throw new Error("market price is not available yet");
    }
    if (Date.now() - health.lastUpdatedAt > this.maximumMarketDataAgeMs) {
      throw new Error("market price is stale; waiting for a fresh update");
    }
    return candles[candles.length - 1]!.close;
  }

  getMarket(): MarketSnapshot {
    const health = this.candleFeed.health();
    const candles = this.candleFeed.latestCandles();
    return Object.freeze({ ...health, ...(candles.length > 0 ? { price: candles[candles.length - 1]!.close } : {}) });
  }

  getChartCandles() { return this.candleFeed.latestCandles(); }

  /** In-memory only (see EquityHistoryRecorder) -- resets on restart, same as referencePortfolio. */
  getEquityHistory(): readonly EquitySample[] { return this.equityHistory.history(); }

  getDrawdownStatistics(): DrawdownStatistics { return computeDrawdownStatistics(this.equityHistory.history()); }

  getAccountSnapshot(): PaperAccountSnapshot { return this.broker.snapshot(this.assertFreshPrice()); }

  /** account.orders is newest-first (PaperBroker.snapshot()); reversed for chronological replay. */
  getTradeStatistics(): TradeStatistics {
    const account = this.broker.snapshot(this.assertFreshPrice());
    return computeTradeStatistics([...account.orders].reverse());
  }

  getControlSnapshot(): ControlSnapshot & { readonly activeStrategyId: StrategyChoice } {
    return Object.freeze({ ...this.control.snapshot(), activeStrategyId: this.currentStrategyId });
  }

  getDashboard() {
    const price = this.assertFreshPrice();
    return buildPaperDashboardSections({
      account: this.broker.snapshot(price),
      control: this.control.snapshot(),
      markPrice: price,
      referenceEquity: this.initialCash,
      runtimeAvailable: this.paperTradingAvailable,
      generatedAt: Date.now(),
      strategyWarmup: { current: this.strategyEngine.getHistory().length, required: REQUIRED_WARMUP_SAMPLES },
      executionCostBps: FILL_MODEL.slippageBps + FILL_MODEL.spreadBps / 2
    });
  }

  /**
   * The audit-only parallel Portfolio/PnL built via packages/core (E02-T006/T007) --
   * exposed read-only for cross-checking against /api/account, never consulted by any
   * trading decision. See AutomaticTradingPipeline's ReferenceAccounting doc comment.
   */
  getReferenceAccounting(): { readonly portfolio: Portfolio; readonly pnl: PnLSnapshot; readonly reconciliation: ReconciliationResult } {
    const price = this.assertFreshPrice();
    const result = this.referencePnlCalculator.calculate(this.referencePortfolio, price);
    if (result.status !== "CALCULATED") throw new Error(`reference PnL calculation failed: ${result.code}`);
    const reconciliation = reconcileReferenceAccounting(this.broker.snapshot(price), this.referencePortfolio);
    return { portfolio: this.referencePortfolio, pnl: result.pnl, reconciliation };
  }

  placeOrder(side: PaperSide, quantity: number): { readonly order: PaperOrder; readonly account: PaperAccountSnapshot } {
    const price = this.assertFreshPrice();
    let order: PaperOrder;
    try {
      order = this.runtime.manualOrder(side, quantity, price);
    } catch (error) {
      this.paperTradingAvailable = this.runtime.isAvailable();
      this.recordReferenceExecution(rejectedExecutionReport(error instanceof Error ? error.message : String(error)), price);
      throw error;
    }
    this.paperTradingAvailable = this.runtime.isAvailable();
    this.recordReferenceExecution(filledExecutionReport({
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      fee: order.fee,
      symbol: this.market
    }), price);
    return { order, account: this.broker.snapshot(price) };
  }

  /**
   * Sells the entire current position at market, in one call -- the same "close everything now"
   * action checkPositionProtection() already performs automatically on a trigger, exposed here
   * as an explicit manual command (e.g. an operator's own "전량 매도" button) rather than
   * requiring them to read the exact position quantity off the account panel and retype it into
   * the manual order form. Reuses placeOrder() as-is, so it goes through the exact same
   * validated/audited/reference-ledger path a typed manual sell does; also clears any active
   * position protection level, matching checkPositionProtection()'s own "nothing left to
   * protect" cleanup when a position closes some other way.
   *
   * A single order can be capped below its full requested quantity by PaperBroker's own fill
   * model (FILL_MODEL.maxFillRatio: every order fills at most 90% of what it requests, by
   * design -- see PaperBroker.execute()), so this retries immediately with whatever remains,
   * bounded rather than unbounded. Because each retry again only fills 90% of the (now
   * smaller) remainder, this converges toward flat but can never reach mathematically exact
   * zero -- in practice it is stopped well before that anyway, either by the attempt bound or
   * by the remainder dropping below the market's minimum order notional (unsellable dust,
   * same as checkPositionProtection()'s own give-up case). Either way protection is cleared
   * once the attempts are exhausted: a lingering stop-loss/take-profit on a dust remainder
   * that can never trade further protects nothing.
   */
  closePosition(): { readonly order: PaperOrder; readonly account: PaperAccountSnapshot } {
    const price = this.assertFreshPrice();
    const initialQuantity = this.broker.snapshot(price).position.quantity;
    if (initialQuantity <= 0) throw new Error("no open position to close");
    let result = this.placeOrder("SELL", initialQuantity);
    for (let attempt = 0; attempt < 9 && result.account.position.quantity > 0; attempt += 1) {
      try {
        result = this.placeOrder("SELL", result.account.position.quantity);
      } catch {
        break;
      }
    }
    this.stopLossPrice = null;
    this.takeProfitPrice = null;
    this.trailingStopPercent = null;
    this.trailingPeakPrice = null;
    this.savePositionProtectionState();
    return result;
  }

  /**
   * Folds a manual order's outcome into the same audit-only reference ledger the automatic
   * pipeline feeds (AutomaticTradingPipeline.recordExecutionReport) -- so /api/reference-accounting
   * mirrors the *whole* account (manual + automatic), not just automatic-strategy fills. Never
   * read back into any real decision; PaperBroker remains the sole source of truth. Reconciles
   * against the real account immediately after folding, same as the automatic pipeline does,
   * and records a RISK event if they've diverged.
   */
  private recordReferenceExecution(report: ExecutionReport, price: number): void {
    const updateResult = this.referenceLedger.apply(this.referencePortfolio, report);
    if (updateResult.status !== "UPDATED") return;
    this.referencePortfolio = updateResult.portfolio;
    this.control.record("SYSTEM", "execution report (manual)", report);
    const reconciliation = reconcileReferenceAccounting(this.broker.snapshot(price), updateResult.portfolio);
    if (!reconciliation.consistent) {
      this.control.record("RISK", `reference accounting diverged from the real account: ${reconciliation.discrepancies.join(", ")}`);
    }
  }

  startStrategy(): ControlSnapshot { return this.runCommand(() => this.runtime.start()); }
  stopStrategy(): ControlSnapshot { return this.runCommand(() => this.runtime.stop()); }
  setAutoTrade(enabled: boolean): ControlSnapshot {
    if (enabled) this.assertFreshPrice();
    return this.runCommand(() => this.runtime.setAutoTrade(enabled));
  }
  setOrderQuantity(quantity: number): ControlSnapshot { return this.runCommand(() => this.runtime.setOrderQuantity(quantity)); }

  selectStrategy(choice: StrategyChoice): ControlSnapshot {
    if (!(choice in STRATEGY_FACTORIES)) throw new Error(`unknown strategy: ${choice}`);
    this.strategyEngine.setStrategy(STRATEGY_FACTORIES[choice](this.strategyPeriods));
    this.currentStrategyId = choice;
    try { saveStrategyChoice(this.strategyChoicePath, choice); } catch {
      // Best-effort continuity only: a failed write here only means the next restart falls
      // back to the previously persisted (or default SMA) choice, never an account/control fault.
    }
    return this.control.snapshot();
  }

  getStrategyPeriods(): StrategyPeriods { return this.strategyPeriods; }

  /**
   * Applies to whichever strategy (SMA/EMA) is currently selected -- validated by
   * SmaCrossoverStrategy/EmaCrossoverStrategy's own constructors (thrown on invalid periods,
   * propagated as-is rather than re-validated here). Swapping periods resets the strategy's
   * warm-up, same as selectStrategy() switching SMA<->EMA does (StrategyEngine.setStrategy()
   * clears price history and calls the strategy's own reset()).
   */
  setStrategyPeriods(periods: StrategyPeriods): StrategyPeriods {
    this.strategyEngine.setStrategy(STRATEGY_FACTORIES[this.currentStrategyId](periods));
    this.strategyPeriods = periods;
    try { saveStrategyPeriods(this.strategyChoicePath, periods); } catch {
      // Best-effort continuity only, same convention as selectStrategy()'s own save call.
    }
    this.control.record("STATUS", `strategy periods set: short=${periods.shortPeriod} long=${periods.longPeriod}`);
    return this.getStrategyPeriods();
  }

  /** See championSystem.ts's own doc comment -- fully isolated shadow comparison, read-only. */
  getChampionStandings(): ChampionStandings {
    const price = this.assertFreshPrice();
    return this.championSystem.getStandings(this.currentStrategyId, this.strategyPeriods, price);
  }

  /**
   * Switches the *real* active strategy to match a challenger preset -- reuses
   * selectStrategy()/setStrategyPeriods() as-is (the exact same validated/persisted path the
   * operator's own dropdown takes), so this only ever changes *which* strategy governs the
   * real account; it never touches cash/position/orders. Always an explicit operator action
   * (this method itself is never called automatically) -- promotion has no autonomous trigger,
   * matching this project's standing "no automatic promotion" policy (docs/NEXT_TASK.md).
   */
  promoteChallenger(id: string): ChampionStandings {
    const config = CHAMPION_CHALLENGER_PRESETS.find((candidate) => candidate.id === id);
    if (!config) throw new Error(`unknown challenger id: ${id}`);
    this.selectStrategy(config.choice);
    this.setStrategyPeriods(config.periods);
    this.control.record("STATUS", `champion promoted: ${config.label}`);
    return this.getChampionStandings();
  }

  /**
   * On-demand historical comparison, independent of the live shadow ChampionChallengerSystem
   * (which needs real elapsed time to accumulate trades): fetches up to 200 recent real
   * 1-minute Upbit candles -- the exchange's own per-request maximum, so this is "recent
   * history" rather than an arbitrarily deep backtest, no pagination attempted -- and runs
   * each champion/challenger preset through apps/desktop's existing, already-tested
   * backtestEngine.runBacktest() as-is. No new backtest/metrics logic invented here; reuses
   * this runtime's own real feeRate/RISK_POLICY/FILL_MODEL costs for consistency with the
   * real account's execution assumptions.
   */
  async runBacktestComparison(): Promise<readonly { readonly id: string; readonly label: string; readonly metrics: BacktestMetrics }[]> {
    const raw = await this.candleFetcher(this.market, 1, 200);
    const candles = mapUpbitMinuteCandlesToChartCandles(raw, 1);
    const points = candles.map((candle) => ({ timestamp: candle.openTime, close: candle.close }));
    return CHAMPION_CHALLENGER_PRESETS.map((config) => ({
      id: config.id,
      label: config.label,
      metrics: runBacktest(points, () => createChallengerStrategy(config.choice, config.periods), {
        market: this.market,
        initialCash: this.initialCash,
        feeRate: this.feeRate,
        riskPolicy: RISK_POLICY,
        executionCosts: { spreadBps: FILL_MODEL.spreadBps, slippageBps: FILL_MODEL.slippageBps }
      }).metrics
    }));
  }

  private runCommand(command: () => void): ControlSnapshot {
    try { command(); }
    finally { this.paperTradingAvailable = this.runtime.isAvailable(); }
    return this.control.snapshot();
  }
}
