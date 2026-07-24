import { ControlPlane, type ControlSnapshot } from "../../desktop/src/controlPlane";
import { DesktopPersistenceStore } from "../../desktop/src/desktopPersistenceStore";
import { PaperBroker, type PaperAccountSnapshot, type PaperOrder, type PaperSide } from "../../desktop/src/paperBroker";
import { buildPaperDashboardSections } from "../../desktop/src/paperDashboardProjection";
import { RuntimeCommandService, type RuntimePersistence } from "../../desktop/src/runtimeCommandService";
import { SmaCrossoverStrategy, StrategyEngine, type TradingStrategy } from "../../desktop/src/strategyEngine";
import { EmaCrossoverStrategy } from "./emaCrossoverStrategy";
import { fetchRecentMinuteCandles, LiveCandleFeed, type LiveCandleFeedHealth, type UpbitMinuteCandle } from "./liveCandleFeed";

type CandleFetcher = (market: string, unitMinutes: number, count: number) => Promise<readonly UpbitMinuteCandle[]>;

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

const STRATEGY_FACTORIES: Readonly<Record<StrategyChoice, () => TradingStrategy>> = Object.freeze({
  "sma-crossover": () => new SmaCrossoverStrategy(5, 20),
  "ema-crossover": () => new EmaCrossoverStrategy(5, 20)
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
  private readonly maximumMarketDataAgeMs: number;
  private readonly persistenceStore: DesktopPersistenceStore | undefined;
  private readonly broker: PaperBroker;
  private readonly control: ControlPlane;
  private readonly strategyEngine: StrategyEngine;
  private readonly runtime: RuntimeCommandService;
  private readonly candleFeed: LiveCandleFeed;
  private currentStrategyId: StrategyChoice = "sma-crossover";
  private paperTradingAvailable: boolean;

  constructor(options: PaperRuntimeOptions) {
    this.market = options.market ?? "KRW-BTC";
    this.initialCash = options.initialCash ?? INITIAL_CASH_DEFAULT;
    const feeRate = options.feeRate ?? FEE_RATE_DEFAULT;
    this.maximumMarketDataAgeMs = options.maximumMarketDataAgeMs ?? 60_000;

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

    this.strategyEngine = new StrategyEngine(STRATEGY_FACTORIES["sma-crossover"]());
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

    const persistenceAdapter: RuntimePersistence = {
      save: (paper, control) => {
        if (!this.persistenceStore) throw new Error("SQLite persistence is unavailable");
        this.persistenceStore.save(paper, control);
      }
    };
    this.runtime = new RuntimeCommandService(this.broker, this.control, this.strategyEngine, persistenceAdapter);

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
      options.candleFetcher ?? fetchRecentMinuteCandles
    );
  }

  start(): void { this.candleFeed.start(); }
  dispose(): void { this.candleFeed.stop(); this.persistenceStore?.close(); }

  private handleCandleUpdate(price: number): void {
    const timestamp = Date.now();
    const position = this.broker.snapshot(price).position.quantity;
    const signal = this.strategyEngine.onTick({ market: this.market, price, timestamp }, position);
    if (this.persistenceStore) {
      try { this.persistenceStore.saveStrategyPriceHistory(this.strategyEngine.getHistory()); } catch {
        // Best-effort continuity only; never affects paperTradingAvailable or the account/control write path.
      }
    }
    this.runtime.automaticSignal(this.market, price, position, signal);
    this.paperTradingAvailable = this.runtime.isAvailable();
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

  getAccountSnapshot(): PaperAccountSnapshot { return this.broker.snapshot(this.assertFreshPrice()); }

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

  placeOrder(side: PaperSide, quantity: number): { readonly order: PaperOrder; readonly account: PaperAccountSnapshot } {
    const price = this.assertFreshPrice();
    let order: PaperOrder;
    try { order = this.runtime.manualOrder(side, quantity, price); }
    finally { this.paperTradingAvailable = this.runtime.isAvailable(); }
    return { order, account: this.broker.snapshot(price) };
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
    this.strategyEngine.setStrategy(STRATEGY_FACTORIES[choice]());
    this.currentStrategyId = choice;
    return this.control.snapshot();
  }

  private runCommand(command: () => void): ControlSnapshot {
    try { command(); }
    finally { this.paperTradingAvailable = this.runtime.isAvailable(); }
    return this.control.snapshot();
  }
}
