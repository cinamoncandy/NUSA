import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";
import { completedMinuteCloses, PAPER_MINUTE_BAR_LOOKBACK, MINUTE_MS, type MinuteBarObservation } from "./paperMinuteBars";

/**
 * Replays the PAPER strategy's own rule over one closed PAPER period, on the same completed 1-minute closes the strategy reads
 * (persisted public tickers, same 60-bar lookback, same decision function). Comparing the replay with the period's realized PAPER
 * return separates "what the rule would have done" from what execution, Risk and the ledger actually produced. It is the
 * research-to-execution parity check of the self-verification capability (docs/NUSA_RECURSIVE_SELF_IMPROVEMENT.md).
 *
 * Measurement only: it places no order, writes no ledger, and feeds no Risk, Governance, qualification or Research decision.
 * One hypothetical position, entered at a BUY bar's close and left at a SELL bar's close, fee charged per side. A position still
 * open at the period end is valued at the last close and reported separately, so the replay never invents a realized exit.
 */
export interface PaperPeriodRuleReplayInput {
  readonly spec: PaperCandidateStrategySpec;
  readonly market: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly feeRate: number;
  readonly readWindow: (market: string, startAt: number, endAt: number) => readonly MinuteBarObservation[];
}

export interface PaperPeriodRuleReplay {
  /** Completed minute bars inside the period that the rule was evaluated on. */
  readonly bars: number;
  /** Closed hypothetical round trips. */
  readonly trades: number;
  /** Compounded net return of the closed round trips (fractions, after fees). */
  readonly closedNetReturn: number;
  /** Mark-to-last-close return of a position still open at the period end; 0 when flat. */
  readonly openMarkReturn: number;
  readonly openAtEnd: boolean;
}

export function replayPaperPeriodRule(input: PaperPeriodRuleReplayInput): PaperPeriodRuleReplay {
  const { periodStartAt: start, periodEndAt: end, feeRate: fee } = input;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) throw new Error("PAPER_RULE_REPLAY_WINDOW_INVALID");
  if (!Number.isFinite(fee) || fee < 0 || fee >= 0.1) throw new Error("PAPER_RULE_REPLAY_FEE_INVALID");
  const warmupStart = Math.max(0, start - (PAPER_MINUTE_BAR_LOOKBACK + 1) * MINUTE_MS);
  // Completed minutes strictly before the period end: the same "no partial bar, no look-ahead" rule as the live source.
  const closes = completedMinuteCloses(input.readWindow(input.market, warmupStart, end), end, Number.MAX_SAFE_INTEGER);
  let entry: number | undefined;
  let lastClose: number | undefined;
  let bars = 0;
  let trades = 0;
  let growth = 1;
  for (let index = 0; index < closes.length; index += 1) {
    const [at, close] = closes[index]!;
    if (at < start) continue;
    bars += 1;
    lastClose = close;
    const window = closes.slice(Math.max(0, index + 1 - PAPER_MINUTE_BAR_LOOKBACK), index + 1);
    const decision = evaluatePaperCandidateStrategy(input.spec, [], at, input.market, window);
    if (entry === undefined && decision.action === "BUY") entry = close;
    else if (entry !== undefined && decision.action === "SELL") {
      growth *= (close * (1 - fee)) / (entry * (1 + fee));
      trades += 1;
      entry = undefined;
    }
  }
  const openMarkReturn = entry !== undefined && lastClose !== undefined ? (lastClose * (1 - fee)) / (entry * (1 + fee)) - 1 : 0;
  return Object.freeze({ bars, trades, closedNetReturn: growth - 1, openMarkReturn, openAtEnd: entry !== undefined });
}
