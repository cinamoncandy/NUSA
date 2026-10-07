import { SqliteCandidatePromotionRepository, SqliteResearchCandleStore, SqliteResearchEvaluationLedger, SqliteResearchHoldoutLedger, SqliteResearchMemoryRepository, SqliteResearchSessionRepository, SqlitePaperMarketObservationRepository, type SqliteDatabase } from "../../../packages/storage/src/index";
import { BacktestResearchEvaluator, buildRsiResearchStrategy, buildSmaResearchStrategy } from "./backtestResearchEvaluator";
import { ResearchAutomationRuntime } from "./researchAutomationRuntime";
import { ResearchExperimentOrchestrator, type ResearchVariant, type TickReport } from "./researchExperimentOrchestrator";
import { ResearchRecoveryCoordinator } from "./researchRecoveryCoordinator";
import { ResearchRuntimeCoordinator } from "./researchRuntimeCoordinator";
import { collectClosedCandles } from "./researchCandleCollector";
import { backfillMarket, createUpbitMinuteCandleFetcher, fillRecentGaps, type BackfillResult, type GapFillResult } from "./researchCandleBackfill";
import { AggregatedResearchCandleSource } from "./researchCandleAggregation";

/**
 * Composition of the continuous research experiments. DISABLED unless NUSA_CLOUD_RESEARCH_EXPERIMENTS is exactly
 * "1". Any invalid setting, or a missing 40-character build commit, leaves it disabled and says why in one log
 * line (fail closed). Research evidence only: LIVE NONE, no orders, no capital/risk/execution change, no paid AI,
 * and nothing is promoted or registered here: when the existing candidate gate calls the registration port the event is
 * only logged, because new registrations require a canonical family binding that this research path never holds.
 */
const M = 60_000;
const DAY_MS = 86_400_000;
export const RESEARCH_FLAG = "NUSA_CLOUD_RESEARCH_EXPERIMENTS";
// Upbit KRW market fee is 0.05%; slippage is a fixed conservative 5 bps. Both are explicit by design.
export const RESEARCH_BACKTEST_COST = Object.freeze({ initialCash: 1_000_000, feeRate: 0.0005, slippageBps: 5 });
const CHAMPION_PROXY = Object.freeze({ fast: 5, slow: 20 }); // matches the owner-approved PAPER baseline parameters
const CHALLENGER_GRID: readonly (readonly [number, number])[] = Object.freeze([[3, 10], [5, 30], [10, 40], [8, 20]]);
// RSI mean-reversion grid [period, oversold threshold], fixed before any result was seen (no tuning on validation or holdout).
const RSI_CHALLENGER_GRID: readonly (readonly [number, number])[] = Object.freeze([[14, 30], [14, 25], [7, 20]]);
// RSI positions close after this many bars of the experiment's bar length if neither take-profit nor stop-loss hit. It must fit
// inside the shortest evaluation window after the RSI warm-up: 2-day validation/holdout at 60m is 48 bars, minus up to 14 warm-up bars.
export const RSI_TIMEOUT_BARS = 12;
/** Bar lengths research may compare (docs/PROPOSAL_RESEARCH_LONGER_TIMEFRAMES.md). Longer bars are built from stored 1m candles. */
export const RESEARCH_INTERVAL_MINUTES: readonly number[] = Object.freeze([1, 15, 60, 240]);

export interface ResearchExperimentSettings {
  readonly markets: readonly string[];
  readonly windows: { readonly intervalMs: number; readonly trainMs: number; readonly validationMs: number; readonly holdoutMs: number; readonly maxMissingRatio: number };
  readonly tickMs: number;
  readonly dailyBudgetPerVariant: number;
  readonly sourceCommitSha: string;
  /** Bar lengths to run the same experiment grid on, in minutes. Default [1] (unchanged behaviour). */
  readonly intervalsMinutes: readonly number[];
  /** Fill history from Upbit's public 1-minute candles at start. On unless NUSA_RESEARCH_BACKFILL is set to anything but ENABLED. */
  readonly backfill: boolean;
}

export type ResearchExperimentSettingsResult =
  | { readonly status: "DISABLED" }
  | { readonly status: "INVALID"; readonly reason: string }
  | { readonly status: "ENABLED"; readonly settings: ResearchExperimentSettings };

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number | undefined {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

export function readResearchExperimentSettings(env: NodeJS.ProcessEnv): ResearchExperimentSettingsResult {
  if (env[RESEARCH_FLAG] !== "1") return Object.freeze({ status: "DISABLED" });
  const commit = (env.NUSA_SOURCE_COMMIT_SHA ?? env.NUSA_SOURCE_COMMIT ?? "").trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) return Object.freeze({ status: "INVALID", reason: "SOURCE_COMMIT_MISSING_OR_MALFORMED" });
  const markets = (env.NUSA_RESEARCH_MARKETS ?? "KRW-BTC").split(",").map((m) => m.trim().toUpperCase()).filter((m) => m !== "");
  if (markets.length === 0 || markets.length > 5 || markets.some((m) => !/^KRW-[A-Z0-9-]+$/.test(m)) || new Set(markets).size !== markets.length) return Object.freeze({ status: "INVALID", reason: "MARKETS_INVALID" });
  const train = intIn(env.NUSA_RESEARCH_TRAIN_DAYS, 7, 1, 30);
  const validation = intIn(env.NUSA_RESEARCH_VALIDATION_DAYS, 2, 1, 14);
  const holdout = intIn(env.NUSA_RESEARCH_HOLDOUT_DAYS, 2, 1, 14);
  const tickMinutes = intIn(env.NUSA_RESEARCH_TICK_MINUTES, 30, 5, 360);
  const budget = intIn(env.NUSA_RESEARCH_DAILY_BUDGET, 48, 1, 288);
  if (train == null || validation == null || holdout == null || tickMinutes == null || budget == null) return Object.freeze({ status: "INVALID", reason: "NUMERIC_SETTING_INVALID" });
  const intervalsRaw = (env.NUSA_RESEARCH_INTERVAL_MINUTES ?? "1").split(",").map((value) => value.trim()).filter((value) => value !== "");
  const intervalsMinutes = intervalsRaw.map(Number);
  if (intervalsMinutes.length === 0 || intervalsMinutes.some((value) => !RESEARCH_INTERVAL_MINUTES.includes(value)) || new Set(intervalsMinutes).size !== intervalsMinutes.length) {
    return Object.freeze({ status: "INVALID", reason: "INTERVALS_INVALID" });
  }
  return Object.freeze({
    status: "ENABLED",
    settings: Object.freeze({
      markets: Object.freeze(markets),
      windows: Object.freeze({ intervalMs: M, trainMs: train * DAY_MS, validationMs: validation * DAY_MS, holdoutMs: holdout * DAY_MS, maxMissingRatio: 0.05 }),
      tickMs: tickMinutes * M,
      dailyBudgetPerVariant: budget,
      sourceCommitSha: commit,
      intervalsMinutes: Object.freeze(intervalsMinutes),
      backfill: env.NUSA_RESEARCH_BACKFILL === undefined || env.NUSA_RESEARCH_BACKFILL === "ENABLED",
    }),
  });
}

export interface ResearchExperimentComposition {
  readonly orchestrator: ResearchExperimentOrchestrator;
  /** One orchestrator per configured bar length, in settings order; `orchestrator` is the first. */
  readonly orchestrators: readonly ResearchExperimentOrchestrator[];
  /** Display only: each bar length's experiment tick summary, keyed "1m", "15m", ... */
  readonly experimentTicksByInterval: () => Readonly<Record<string, ReturnType<ResearchExperimentOrchestrator["experimentTicks"]>>>;
  readonly tickOnce: () => TickReport;
  readonly backfill: () => Promise<readonly BackfillResult[]>;
  /** Refills missing closed minutes inside the recent history from the public candle endpoint. */
  readonly fillGaps: () => Promise<readonly GapFillResult[]>;
  readonly start: () => void;
  readonly stop: () => void;
}

export function composeResearchExperiments(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly database: SqliteDatabase;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}): ResearchExperimentComposition | undefined {
  const log = input.log ?? (() => undefined);
  const parsed = readResearchExperimentSettings(input.env);
  if (parsed.status === "DISABLED") return undefined;
  if (parsed.status === "INVALID") { log(`[research-experiments] disabled: ${parsed.reason}`); return undefined; }
  const settings = parsed.settings;
  const now = input.now ?? Date.now;
  const db = input.database;

  const store = new SqliteResearchCandleStore(db);
  const holdout = new SqliteResearchHoldoutLedger(db);
  const observations = new SqlitePaperMarketObservationRepository(db);
  const ledger = new SqliteResearchEvaluationLedger(db);
  const candidates = new SqliteCandidatePromotionRepository(db);
  const memory = new SqliteResearchMemoryRepository(db);
  const sessions = new SqliteResearchSessionRepository(db);
  const recovery = new ResearchRecoveryCoordinator({ repository: candidates, evaluationLedger: ledger, now });

  const market = settings.markets[0]!;
  const bars = new AggregatedResearchCandleSource(store, M);
  const proxy = (id: string, fast: number, slow: number) => buildSmaResearchStrategy({ strategyId: id, version: "1.0.0", market, fastPeriod: fast, slowPeriod: slow, takeProfitPercent: 3, stopLossPercent: 2, positionPercent: 50, maxPositionNotional: 500_000 });
  // One orchestrator per bar length. The 1m set keeps its original identities; longer bars carry the length in
  // every strategy id and experiment family so their evidence, sessions and holdouts never mix with 1m evidence.
  const buildOrchestrator = (minutes: number): { orchestrator: ResearchExperimentOrchestrator; variantCount: number } => {
    const intervalMs = minutes * M;
    const tag = minutes === 1 ? "" : `-${minutes}m`;
    const champion = proxy(`research-champion-sma${tag}`, CHAMPION_PROXY.fast, CHAMPION_PROXY.slow);
    const evaluatorFor = <A extends "PAPER_ONLY" | "ZERO_AUTHORITY">(strategy: ReturnType<typeof proxy>, authority: A) => new BacktestResearchEvaluator<A>({
      strategyId: strategy.strategyId, strategyVersion: strategy.version, authority, evaluatorVersion: "backtest-eval-v1",
      strategy, candles: bars, intervalMs, backtest: RESEARCH_BACKTEST_COST,
    });
    const variantFor = (variantId: string, challenger: ReturnType<typeof proxy>, config: unknown, experimentFamilyPrefix?: string): ResearchVariant => {
      const coordinator = new ResearchRuntimeCoordinator({ champion: evaluatorFor(champion, "PAPER_ONLY"), challenger: evaluatorFor(challenger, "ZERO_AUTHORITY"), ledger });
      const runtime = new ResearchAutomationRuntime({
        coordinator, sessions, memory, registerCandidate: (identity) => { log(`[research-experiments] candidate gate eligible (not registered, governed promotion paths unchanged): ${identity.strategyId}@${identity.strategyVersion}`); return Object.freeze({ identity, lifecycle: "RESEARCHING" as const }); }, listCandidates: () => candidates.listCandidates(),
        recovery, now, maxEvidenceAgeMs: 14 * DAY_MS,
      });
      return { variantId, champion: { strategy: champion, config: CHAMPION_PROXY }, challenger: { strategy: challenger, config }, runtime, ...(experimentFamilyPrefix == null ? {} : { experimentFamilyPrefix }) };
    };
    const smaVariants = CHALLENGER_GRID.map(([fast, slow]) => {
      const variantId = `sma_${fast}_${slow}${tag.replace("-", "_")}`;
      return variantFor(variantId, proxy(`research-challenger-${variantId}`, fast, slow), { fast, slow });
    });
    // RSI mean-reversion family (pre-committed grid): its own experiment family, compared against the same SMA 5/20 champion.
    const rsiVariants = RSI_CHALLENGER_GRID.map(([period, threshold]) => {
      const variantId = `rsi_${period}_${threshold}${tag.replace("-", "_")}`;
      const challenger = buildRsiResearchStrategy({ strategyId: `research-challenger-${variantId}`, version: "1.0.0", market, period, threshold, takeProfitPercent: 3, stopLossPercent: 2, timeoutMinutes: RSI_TIMEOUT_BARS * minutes, positionPercent: 50, maxPositionNotional: 500_000 });
      return variantFor(variantId, challenger, { family: "rsi", period, threshold, timeoutBars: RSI_TIMEOUT_BARS }, `rsi-research${tag}`);
    });
    const variants: ResearchVariant[] = [...smaVariants, ...rsiVariants];
    const orchestrator = new ResearchExperimentOrchestrator({
      variants, sessions, markets: settings.markets, intervalMs, windows: Object.freeze({ ...settings.windows, intervalMs }), dailyBudgetPerVariant: settings.dailyBudgetPerVariant,
      // Closed 1m candles are collected once per tick by the 1m-equivalent first orchestrator only.
      collect: (nowMs) => { if (minutes === settings.intervalsMinutes[0]) collectClosedCandles({ markets: settings.markets, nowMs, observations, sink: store }); },
      candles: bars, holdout, now, sourceCommitSha: settings.sourceCommitSha,
      models: { fill: "fill-close-v1", fee: `fee-${RESEARCH_BACKTEST_COST.feeRate}-v1`, slippage: `slip-${RESEARCH_BACKTEST_COST.slippageBps}bps-v1` },
      evaluator: { version: "backtest-eval-v1", modelVersion: "dsl-backtest-v1" },
      featurePipeline: { version: "closed-candle-agg-v1", config: { intervalMs, maxInternalGapMs: 30_000, volume: 0 } },
      experimentFamilyPrefix: `sma-research${tag}`,
      failureEvidence: () => ledger.list().filter((record) => record.provenance?.windowRole === "VALIDATION" && record.provenance.interval === `${minutes}m`),
    });
    return { orchestrator, variantCount: variants.length };
  };
  const built = settings.intervalsMinutes.map(buildOrchestrator);
  const orchestrators = Object.freeze(built.map((entry) => entry.orchestrator));
  const orchestrator = orchestrators[0]!;
  const variantCount = built.reduce((sum, entry) => sum + entry.variantCount, 0);

  const fetchPage = createUpbitMinuteCandleFetcher(input.fetchImpl ?? fetch);
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let backfillTimer: ReturnType<typeof setTimeout> | undefined;
  let backfilling = false;
  const w = settings.windows;
  const targetSpanMs = w.trainMs + w.validationMs + w.holdoutMs + DAY_MS; // one day of margin
  const backfill = async (): Promise<readonly BackfillResult[]> => {
    if (backfilling || stopped) return Object.freeze([]);
    backfilling = true;
    const results: BackfillResult[] = [];
    try {
      for (const market of settings.markets) {
        if (stopped) break;
        const result = await backfillMarket({ market, targetSpanMs, nowMs: now(), store, fetchPage, sleep });
        results.push(result);
        log(`[research-backfill] ${market} ${result.status} recorded=${result.recorded} rejected=${result.rejected} pages=${result.pages}${result.errorCode === undefined ? "" : ` error=${result.errorCode}`}`);
      }
    } catch (error) {
      log(`[research-backfill] failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      backfilling = false;
    }
    return Object.freeze(results);
  };
  // Restart and feed gaps inside the recent history are never revisited by the collector; longer bars need every
  // minute, so refill missing minutes from the same public source after the history fill and every 6 hours.
  let gapFilling = false;
  let gapTimer: ReturnType<typeof setInterval> | undefined;
  const fillGaps = async (): Promise<readonly GapFillResult[]> => {
    if (gapFilling || stopped) return Object.freeze([]);
    gapFilling = true;
    const results: GapFillResult[] = [];
    try {
      for (const market of settings.markets) {
        if (stopped) break;
        const result = await fillRecentGaps({ market, windowMs: targetSpanMs, nowMs: now(), store, fetchPage, sleep });
        results.push(result);
        log(`[research-gap-fill] ${market} ${result.status} missing=${result.missing} recorded=${result.recorded} rejected=${result.rejected} pages=${result.pages}${result.errorCode === undefined ? "" : ` error=${result.errorCode}`}`);
      }
    } catch (error) {
      log(`[research-gap-fill] failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      gapFilling = false;
    }
    return Object.freeze(results);
  };
  const scheduleBackfill = (attempt: number, delayMs: number): void => {
    if (stopped || !settings.backfill) return;
    backfillTimer = setTimeout(() => {
      void backfill().then((results) => {
        const done = results.length === settings.markets.length && results.every((r) => r.status === "COMPLETE");
        if (!done && attempt < 3) scheduleBackfill(attempt + 1, 10 * M);
        else void fillGaps();
      });
    }, delayMs);
    backfillTimer.unref?.();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tickOnce = (): TickReport => {
    let first: TickReport | undefined;
    settings.intervalsMinutes.forEach((minutes, index) => {
      try {
        const report = orchestrators[index]!.tick();
        if (index === 0) first = report;
        const completed = report.experiments.filter((e) => e.outcome.status === "COMPLETED").length;
        log(`[research-experiments] tick ${minutes === 1 ? "" : `${minutes}m `}${report.status} started=${report.started} resumed=${report.resumed} stopped=${report.stopped} experiments=${report.experiments.length} completed=${completed}`);
      } catch (error) {
        if (index === 0) throw error;
        log(`[research-experiments] tick ${minutes}m failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    });
    return first!;
  };
  return Object.freeze({
    orchestrator,
    orchestrators,
    experimentTicksByInterval: () => {
      const byInterval: Record<string, ReturnType<ResearchExperimentOrchestrator["experimentTicks"]>> = {};
      settings.intervalsMinutes.forEach((minutes, index) => { byInterval[`${minutes}m`] = orchestrators[index]!.experimentTicks(); });
      return Object.freeze(byInterval);
    },
    tickOnce,
    backfill,
    fillGaps,
    start: () => {
      if (stopped || timer != null) return;
      // The runtime recovers only the first orchestrator (it is the one handed to startCloudRuntime). Every
      // other bar length must recover here, before its first tick, or it stays RECOVERY_NOT_READY forever.
      orchestrators.slice(1).forEach((other, index) => {
        let status = "FAIL_CLOSED";
        try { status = other.recover().status; } catch { status = "FAIL_CLOSED"; }
        log(`[research-experiments] recover ${settings.intervalsMinutes[index + 1]}m ${status}`);
      });
      scheduleBackfill(1, 20_000);
      first = setTimeout(() => { try { tickOnce(); } catch { /* isolated */ } }, 60_000);
      first.unref?.();
      timer = setInterval(() => { try { tickOnce(); } catch { /* isolated */ } }, settings.tickMs);
      timer.unref?.();
      if (settings.backfill) { gapTimer = setInterval(() => { void fillGaps(); }, 6 * 60 * M); gapTimer.unref?.(); }
      log(`[research-experiments] enabled: markets=${settings.markets.join(",")} variants=${variantCount} intervals=${settings.intervalsMinutes.join(",")}m tickMinutes=${settings.tickMs / M} backfill=${settings.backfill ? "ENABLED" : "DISABLED"}`);
    },
    stop: () => { stopped = true; if (gapTimer != null) clearInterval(gapTimer); if (backfillTimer != null) clearTimeout(backfillTimer); if (first != null) clearTimeout(first); if (timer != null) clearInterval(timer); },
  });
}
