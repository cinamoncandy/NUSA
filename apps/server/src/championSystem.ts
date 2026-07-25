import { PaperBroker, type PaperAccountSnapshot, type PaperFillModel, type PaperRiskPolicy } from "../../desktop/src/paperBroker";
import { SmaCrossoverStrategy, StrategyEngine, type TradingStrategy } from "../../desktop/src/strategyEngine";
import { computeDrawdownStatistics, type DrawdownStatistics } from "./drawdown";
import { EmaCrossoverStrategy } from "./emaCrossoverStrategy";
import { EquityHistoryRecorder } from "./equityHistory";
import { computeTradeStatistics, type TradeStatistics } from "./tradeStatistics";
import type { StrategyChoice, StrategyPeriods } from "./paperRuntime";

export interface ChallengerConfig {
  readonly id: string;
  readonly label: string;
  readonly choice: StrategyChoice;
  readonly periods: StrategyPeriods;
}

/**
 * A small, fixed benchmark set (not the operator's freely-editable live 전략 선택/기간
 * settings) -- champion/challenger comparison needs a stable set of candidates to evaluate
 * against over time, not one that changes whenever the operator tweaks the live strategy.
 * Deliberately just 3: enough to show the pattern (a slower SMA variant, an EMA alternative)
 * without running an unbounded number of shadow StrategyEngine/PaperBroker pairs on every tick.
 */
export const CHAMPION_CHALLENGER_PRESETS: readonly ChallengerConfig[] = Object.freeze([
  Object.freeze({ id: "sma-5-20", label: "SMA(5,20)", choice: "sma-crossover" as const, periods: Object.freeze({ shortPeriod: 5, longPeriod: 20 }) }),
  Object.freeze({ id: "sma-10-30", label: "SMA(10,30)", choice: "sma-crossover" as const, periods: Object.freeze({ shortPeriod: 10, longPeriod: 30 }) }),
  Object.freeze({ id: "ema-5-20", label: "EMA(5,20)", choice: "ema-crossover" as const, periods: Object.freeze({ shortPeriod: 5, longPeriod: 20 }) })
]);

/** Exported so paperRuntime.ts's on-demand historical backtest can build the exact same
 * strategy instances for each preset, without a second copy of this if/else. */
export function createChallengerStrategy(choice: StrategyChoice, periods: StrategyPeriods): TradingStrategy {
  return choice === "sma-crossover"
    ? new SmaCrossoverStrategy(periods.shortPeriod, periods.longPeriod)
    : new EmaCrossoverStrategy(periods.shortPeriod, periods.longPeriod);
}

/** Same "TYPE(short,long)" format as the fixed presets' own labels, for the operator's current
 * (possibly custom, non-preset) strategy config -- see paperRuntime.ts's getChampionStandings()
 * and runBacktestComparison(). */
export function strategyLabel(choice: StrategyChoice, periods: StrategyPeriods): string {
  return `${choice === "sma-crossover" ? "SMA" : "EMA"}(${periods.shortPeriod},${periods.longPeriod})`;
}

interface ChallengerRuntime {
  readonly config: ChallengerConfig;
  readonly engine: StrategyEngine;
  readonly broker: PaperBroker;
  /** Same in-memory, resets-on-restart posture as PaperRuntime's own equityHistory -- lets the
   * champion table show each challenger's maxDrawdown next to the real account's, instead of
   * only exposing drawdown for the backtest table (which recomputes it per-run, not live). */
  readonly equityHistory: EquityHistoryRecorder;
}

export interface ChallengerStanding {
  readonly id: string;
  readonly label: string;
  readonly choice: StrategyChoice;
  readonly periods: StrategyPeriods;
  /** True when this preset's (choice, periods) exactly matches the strategy currently
   * controlling the real account -- i.e. this challenger *is* the champion right now. */
  readonly isChampion: boolean;
  readonly account: PaperAccountSnapshot;
  readonly stats: TradeStatistics;
  readonly drawdown: DrawdownStatistics;
}

export interface ChampionStandings {
  /** null when the operator's real active strategy doesn't exactly match any preset
   * (e.g. custom periods) -- the challengers are still shown, just none is marked champion. */
  readonly championId: string | null;
  readonly challengers: readonly ChallengerStanding[];
}

/** Shadow BUY sizing: invests this fraction of the shadow account's current cash per BUY
 * signal, matching PaperRuntime's own FIXED_FRACTIONAL default (riskFraction = 0.1) so the
 * comparison isn't skewed by an arbitrarily different sizing rule. SELL always closes the
 * full shadow position (same simplification the real position-protection/limit-order paths
 * already use -- this app models no partial-exit strategy). */
const SHADOW_RISK_FRACTION = 0.1;

/**
 * Runs a small fixed set of alternate strategy configurations ("challengers") against the
 * exact same live price ticks the real strategy sees, each in its own fully isolated shadow
 * PaperBroker -- never the real account, never persisted, never read back into any real
 * trading decision (same "audit-only parallel state" posture as paperRuntime.ts's reference
 * ledger). Lets the operator compare the currently active ("champion") strategy's real
 * performance against alternatives before manually deciding whether to switch -- promotion
 * is always an explicit operator action (PaperRuntime.promoteChallenger), never automatic,
 * matching this project's standing "no automatic promotion" policy (docs/NEXT_TASK.md).
 */
export class ChampionChallengerSystem {
  private readonly challengers: readonly ChallengerRuntime[];

  constructor(market: string, initialCash: number, feeRate: number, riskPolicy: PaperRiskPolicy, fillModel: PaperFillModel) {
    this.challengers = CHAMPION_CHALLENGER_PRESETS.map((config) => {
      const engine = new StrategyEngine(createChallengerStrategy(config.choice, config.periods));
      // Always-on: shadow evaluation must not depend on whether the operator has started/
      // stopped the *real* strategy (StrategyEngine.onTick only emits real signals while
      // running() -- see strategyEngine.ts).
      engine.start();
      return {
        config,
        engine,
        broker: new PaperBroker(initialCash, market, feeRate, riskPolicy, undefined, fillModel),
        equityHistory: new EquityHistoryRecorder()
      };
    });
  }

  onCandleUpdate(market: string, price: number, timestamp: number): void {
    for (const { engine, broker, equityHistory } of this.challengers) {
      const position = broker.snapshot(price).position.quantity;
      const signal = engine.onTick({ market, price, timestamp }, position);
      if (signal.type !== "HOLD") {
        try {
          if (signal.type === "BUY" && position <= 0) {
            const quantity = (broker.snapshot(price).cash * SHADOW_RISK_FRACTION) / price;
            if (quantity > 0) broker.execute("BUY", quantity, price);
          } else if (signal.type === "SELL" && position > 0) {
            broker.execute("SELL", position, price);
          }
        } catch {
          // A shadow fill can fail the same real-world ways a live one can (below min notional,
          // risk-policy limits) -- skipped rather than retried, matching this app's existing
          // give-up-on-a-single-failed-attempt convention (see checkPositionProtection).
        }
      }
      // Recorded every tick (not just on a fill), same as PaperRuntime's own equityHistory --
      // a flat HOLD period must still show up as a flat line, not a gap.
      equityHistory.record(timestamp, broker.snapshot(price).equity);
    }
  }

  getStandings(activeChoice: StrategyChoice, activePeriods: StrategyPeriods, price: number): ChampionStandings {
    const championConfig = CHAMPION_CHALLENGER_PRESETS.find((config) =>
      config.choice === activeChoice
      && config.periods.shortPeriod === activePeriods.shortPeriod
      && config.periods.longPeriod === activePeriods.longPeriod);
    const championId = championConfig?.id ?? null;
    return {
      championId,
      challengers: this.challengers.map(({ config, broker, equityHistory }) => {
        const account = broker.snapshot(price);
        return {
          id: config.id,
          label: config.label,
          choice: config.choice,
          periods: config.periods,
          isChampion: config.id === championId,
          account,
          stats: computeTradeStatistics([...account.orders].reverse()),
          drawdown: computeDrawdownStatistics(equityHistory.history())
        };
      })
    };
  }
}
