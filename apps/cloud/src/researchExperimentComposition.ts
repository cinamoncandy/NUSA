import { SqliteCandidatePromotionRepository, SqliteResearchCandleStore, SqliteResearchEvaluationLedger, SqliteResearchHoldoutLedger, SqliteResearchMemoryRepository, SqliteResearchSessionRepository, SqlitePaperMarketObservationRepository, type SqliteDatabase } from "../../../packages/storage/src/index";
import { BacktestResearchEvaluator, buildSmaResearchStrategy } from "./backtestResearchEvaluator";
import { ResearchAutomationRuntime } from "./researchAutomationRuntime";
import { ResearchExperimentOrchestrator, type ResearchVariant, type TickReport } from "./researchExperimentOrchestrator";
import { ResearchRecoveryCoordinator } from "./researchRecoveryCoordinator";
import { ResearchRuntimeCoordinator } from "./researchRuntimeCoordinator";
import { collectClosedCandles } from "./researchCandleCollector";

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

export interface ResearchExperimentSettings {
  readonly markets: readonly string[];
  readonly windows: { readonly intervalMs: number; readonly trainMs: number; readonly validationMs: number; readonly holdoutMs: number; readonly maxMissingRatio: number };
  readonly tickMs: number;
  readonly dailyBudgetPerVariant: number;
  readonly sourceCommitSha: string;
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
  return Object.freeze({
    status: "ENABLED",
    settings: Object.freeze({
      markets: Object.freeze(markets),
      windows: Object.freeze({ intervalMs: M, trainMs: train * DAY_MS, validationMs: validation * DAY_MS, holdoutMs: holdout * DAY_MS, maxMissingRatio: 0.05 }),
      tickMs: tickMinutes * M,
      dailyBudgetPerVariant: budget,
      sourceCommitSha: commit,
    }),
  });
}

export interface ResearchExperimentComposition {
  readonly orchestrator: ResearchExperimentOrchestrator;
  readonly tickOnce: () => TickReport;
  readonly start: () => void;
  readonly stop: () => void;
}

export function composeResearchExperiments(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly database: SqliteDatabase;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
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
  const proxy = (id: string, fast: number, slow: number) => buildSmaResearchStrategy({ strategyId: id, version: "1.0.0", market, fastPeriod: fast, slowPeriod: slow, takeProfitPercent: 3, stopLossPercent: 2, positionPercent: 50, maxPositionNotional: 500_000 });
  const champion = proxy("research-champion-sma", CHAMPION_PROXY.fast, CHAMPION_PROXY.slow);
  const evaluatorFor = <A extends "PAPER_ONLY" | "ZERO_AUTHORITY">(strategy: ReturnType<typeof proxy>, authority: A) => new BacktestResearchEvaluator<A>({
    strategyId: strategy.strategyId, strategyVersion: strategy.version, authority, evaluatorVersion: "backtest-eval-v1",
    strategy, candles: store, intervalMs: M, backtest: RESEARCH_BACKTEST_COST,
  });
  const variants: ResearchVariant[] = CHALLENGER_GRID.map(([fast, slow]) => {
    const variantId = `sma_${fast}_${slow}`;
    const challenger = proxy(`research-challenger-${variantId}`, fast, slow);
    const coordinator = new ResearchRuntimeCoordinator({ champion: evaluatorFor(champion, "PAPER_ONLY"), challenger: evaluatorFor(challenger, "ZERO_AUTHORITY"), ledger });
    const runtime = new ResearchAutomationRuntime({
      coordinator, sessions, memory, registerCandidate: (identity) => { log(`[research-experiments] candidate gate eligible (not registered, governed promotion paths unchanged): ${identity.strategyId}@${identity.strategyVersion}`); return Object.freeze({ identity, lifecycle: "RESEARCHING" as const }); }, listCandidates: () => candidates.listCandidates(),
      recovery, now, maxEvidenceAgeMs: 14 * DAY_MS,
    });
    return { variantId, champion: { strategy: champion, config: CHAMPION_PROXY }, challenger: { strategy: challenger, config: { fast, slow } }, runtime };
  });

  const orchestrator = new ResearchExperimentOrchestrator({
    variants, sessions, markets: settings.markets, intervalMs: M, windows: settings.windows, dailyBudgetPerVariant: settings.dailyBudgetPerVariant,
    collect: (nowMs) => { collectClosedCandles({ markets: settings.markets, nowMs, observations, sink: store }); },
    candles: store, holdout, now, sourceCommitSha: settings.sourceCommitSha,
    models: { fill: "fill-close-v1", fee: `fee-${RESEARCH_BACKTEST_COST.feeRate}-v1`, slippage: `slip-${RESEARCH_BACKTEST_COST.slippageBps}bps-v1` },
    evaluator: { version: "backtest-eval-v1", modelVersion: "dsl-backtest-v1" },
    featurePipeline: { version: "closed-candle-agg-v1", config: { intervalMs: M, maxInternalGapMs: 30_000, volume: 0 } },
    experimentFamilyPrefix: "sma-research",
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tickOnce = (): TickReport => {
    const report = orchestrator.tick();
    const completed = report.experiments.filter((e) => e.outcome.status === "COMPLETED").length;
    log(`[research-experiments] tick ${report.status} started=${report.started} resumed=${report.resumed} stopped=${report.stopped} experiments=${report.experiments.length} completed=${completed}`);
    return report;
  };
  return Object.freeze({
    orchestrator,
    tickOnce,
    start: () => {
      if (stopped || timer != null) return;
      first = setTimeout(() => { try { tickOnce(); } catch { /* isolated */ } }, 60_000);
      first.unref?.();
      timer = setInterval(() => { try { tickOnce(); } catch { /* isolated */ } }, settings.tickMs);
      timer.unref?.();
      log(`[research-experiments] enabled: markets=${settings.markets.join(",")} variants=${variants.length} tickMinutes=${settings.tickMs / M}`);
    },
    stop: () => { stopped = true; if (first != null) clearTimeout(first); if (timer != null) clearInterval(timer); },
  });
}
