/**
 * Research meta-learning policy (docs/NUSA_RECURSIVE_SELF_IMPROVEMENT.md): learns from every recorded experiment which data
 * types, timeframes, universes and method classes have been exhausted, ranks the next experiment, and reports how efficiently
 * research is producing valid knowledge. Import-free and pure, so the offline CLI (scripts/research-meta-learner.js) and the
 * runtime (/health) evaluate the same rules.
 *
 * It only orders and measures work. It never runs an experiment, changes a pass rule, threshold, holdout or risk setting, or grants
 * authority. Rules (fixed; a change is a reviewed code change):
 * 1. Lessons per dimension value: experiments, configurations, discovery passes, holdout passes.
 * 2. A value is EXHAUSTED at >= 50 configurations with 0 holdout passes.
 * 3. Candidates are untried combinations; one is eligible only if it contains no EXHAUSTED value in a dimension that still has a
 *    non-exhausted alternative.
 * 4. Score = untried values in the combination minus a collection cost for data with no history (TRADES, ORDERBOOK: 2).
 *    Ties keep the fixed order of DIMENSIONS.
 * 4b. Live PAPER/SHADOW outcomes and runtime Research evaluations are entries like any experiment.
 * 4c. An experiment with designFlaw: true leaves its combination re-triable ONCE (a retry records retryOf); its configurations
 *     still count.
 * 5. The next holdout bar is cumulative: alpha = 0.05 / (all configurations so far + the next experiment's).
 */
export type ResearchDataType = "CLOSE" | "OHLCV" | "TRADES" | "ORDERBOOK" | "EXTERNAL";
export type ResearchMethodClass = "RULE" | "ML";

export interface ResearchLedgerEntry {
  readonly id: string;
  readonly source?: "BACKTEST" | "PAPER_FORWARD" | "RUNTIME_RESEARCH";
  readonly dataType: ResearchDataType;
  /** e.g. "1m", "60m", "1d", "60m+1d", "1m-60m". */
  readonly timeframe: string;
  readonly universe: number;
  readonly methodClass: ResearchMethodClass;
  readonly configs: number;
  readonly discoveryPass: number;
  readonly holdoutPass: number;
  readonly designFlaw?: boolean;
  readonly retryOf?: string;
}

export const META_DIMENSIONS = Object.freeze({
  dataType: Object.freeze(["CLOSE", "OHLCV", "TRADES", "ORDERBOOK", "EXTERNAL"] as const),
  timeframe: Object.freeze(["INTRADAY", "DAILY"] as const),
  universe: Object.freeze(["FIVE", "ALL_KRW"] as const),
  methodClass: Object.freeze(["RULE", "ML"] as const),
});
// EXTERNAL history (Coinbase public candles, ECB USD/KRW) was verified reachable on 2026-10-13; TRADES and ORDERBOOK have none.
const COLLECTION_COST: Readonly<Record<string, number>> = Object.freeze({ TRADES: 2, ORDERBOOK: 2, EXTERNAL: 0 });
export const META_EXHAUSTED_CONFIGS = 50;

export interface MetaLearningReport {
  readonly experiments: number;
  readonly configurations: number;
  readonly discoveryPasses: number;
  readonly holdoutPasses: number;
  /** Discovery passes that failed on unseen data, in percent; undefined with no discovery pass. */
  readonly overfitRatePercent?: number;
  /** Holdout passes per 100 configurations (learning efficiency). */
  readonly validKnowledgePer100Configs: number;
  readonly exhausted: readonly string[];
  readonly untried: readonly string[];
  readonly ranked: readonly { readonly combination: string; readonly score: number; readonly prerequisites: readonly string[] }[];
  readonly recommended?: string;
  /** Holdout p-value bar for a next experiment with one configuration. */
  readonly nextHoldoutBar: number;
}

function classify(entry: ResearchLedgerEntry): Record<keyof typeof META_DIMENSIONS, readonly string[]> {
  const tf = entry.timeframe;
  const hasDaily = tf.includes("1d");
  const hasIntraday = /\d+m/.test(tf.replace("1d", ""));
  return {
    dataType: [entry.dataType],
    timeframe: hasDaily && hasIntraday ? ["INTRADAY", "DAILY"] : hasDaily ? ["DAILY"] : ["INTRADAY"],
    universe: [entry.universe <= 5 ? "FIVE" : "ALL_KRW"],
    methodClass: [entry.methodClass],
  };
}

export function evaluateMetaLearning(entries: readonly ResearchLedgerEntry[]): MetaLearningReport {
  const stats = new Map<string, { experiments: number; configs: number; discovery: number; holdout: number }>();
  for (const [dim, values] of Object.entries(META_DIMENSIONS)) for (const v of values) stats.set(`${dim}=${v}`, { experiments: 0, configs: 0, discovery: 0, holdout: 0 });
  const tried = new Set<string>();
  for (const entry of entries) {
    if (![entry.configs, entry.discoveryPass, entry.holdoutPass].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error(`META_LEDGER_ENTRY_INVALID:${entry.id}`);
    const c = classify(entry);
    for (const [dim, values] of Object.entries(c)) for (const v of values) {
      const s = stats.get(`${dim}=${v}`);
      if (s == null) throw new Error(`META_LEDGER_DIMENSION_UNKNOWN:${entry.id}:${dim}=${v}`);
      s.experiments += 1; s.configs += entry.configs; s.discovery += entry.discoveryPass; s.holdout += entry.holdoutPass;
    }
    const retried = entries.some((other) => other.retryOf === entry.id);
    if (entry.designFlaw === true && !retried) continue;
    for (const dt of c.dataType) for (const t of c.timeframe) for (const u of c.universe) for (const m of c.methodClass) tried.add([dt, t, u, m].join("+"));
  }
  const exhausted = (key: string): boolean => { const s = stats.get(key)!; return s.configs >= META_EXHAUSTED_CONFIGS && s.holdout === 0; };
  const ranked: { combination: string; score: number; prerequisites: string[] }[] = [];
  for (const dt of META_DIMENSIONS.dataType) for (const t of META_DIMENSIONS.timeframe) for (const u of META_DIMENSIONS.universe) for (const m of META_DIMENSIONS.methodClass) {
    const combo = { dataType: dt, timeframe: t, universe: u, methodClass: m } as Record<keyof typeof META_DIMENSIONS, string>;
    const name = [dt, t, u, m].join("+");
    if (tried.has(name)) continue;
    const blocked = (Object.entries(combo) as [keyof typeof META_DIMENSIONS, string][]).some(([dim, v]) => exhausted(`${dim}=${v}`) && (META_DIMENSIONS[dim] as readonly string[]).some((alt) => !exhausted(`${dim}=${alt}`)));
    if (blocked) continue;
    const novelty = (Object.entries(combo) as [string, string][]).filter(([dim, v]) => stats.get(`${dim}=${v}`)!.experiments === 0).length;
    const cost = Object.values(combo).reduce((a, v) => a + (COLLECTION_COST[v] ?? 0), 0);
    ranked.push({ combination: name, score: novelty - cost, prerequisites: Object.values(combo).filter((v) => (COLLECTION_COST[v] ?? 0) > 0).map((v) => `COLLECT_${v}`) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const configurations = entries.reduce((a, e) => a + e.configs, 0);
  const discoveryPasses = entries.reduce((a, e) => a + e.discoveryPass, 0);
  const holdoutPasses = entries.reduce((a, e) => a + e.holdoutPass, 0);
  return Object.freeze({
    experiments: entries.length,
    configurations,
    discoveryPasses,
    holdoutPasses,
    ...(discoveryPasses > 0 ? { overfitRatePercent: Math.round(((discoveryPasses - Math.min(holdoutPasses, discoveryPasses)) / discoveryPasses) * 100) } : {}),
    validKnowledgePer100Configs: configurations > 0 ? Math.round((holdoutPasses / configurations) * 10_000) / 100 : 0,
    exhausted: Object.freeze([...stats.keys()].filter(exhausted)),
    untried: Object.freeze([...stats.entries()].filter(([, s]) => s.experiments === 0).map(([k]) => k)),
    ranked: Object.freeze(ranked.map((r) => Object.freeze({ ...r, prerequisites: Object.freeze(r.prerequisites) }))),
    ...(ranked[0] == null ? {} : { recommended: ranked[0].combination }),
    nextHoldoutBar: 0.05 / (configurations + 1),
  });
}

/**
 * Turns the runtime Research experiment counters (per bar length, e.g. {"1m": {FAIL_NO_EDGE: 19, ...}}) into ledger entries:
 * every FAIL_/REPEAT_/PASS_ outcome is one evaluated configuration of the runtime grid (close-derived bars, five or fewer
 * markets, rule families). A PASS_ outcome is a discovery pass. The orchestrator itself names its wins VALIDATION_CHALLENGER_BETTER
 * (a challenger beat the champion on validation: one evaluated configuration and a discovery pass, because FAIL_ is only derived for
 * challengers that lost) and HOLDOUT_CHALLENGER_BETTER (it also won the single-use holdout: a holdout pass). Counting them keeps a
 * genuine win visible to the meta ledger; they only appear once a challenger really wins, so today's figures do not change.
 * Counters are per process, so these entries cover the current process only. Known limit: FAIL_/REPEAT_ are derived all-time from the
 * durable ledger while the win keys are per process, so after a restart an earlier win drops out (this can bias overfitRatePercent up and re-exhaust
 * a dimension a holdout win had un-exhausted; steering only orders ticks). Deriving wins from the ledger as well is a separate change.
 */
export function runtimeResearchEntries(byInterval: Readonly<Record<string, { readonly counts: Readonly<Record<string, number>> } | null>> | null | undefined, markets: number): readonly ResearchLedgerEntry[] {
  if (byInterval == null) return Object.freeze([]);
  const entries: ResearchLedgerEntry[] = [];
  for (const [interval, value] of Object.entries(byInterval)) {
    if (value == null || !/^\d+m$/.test(interval)) continue;
    let configs = 0; let discovery = 0; let holdout = 0;
    for (const [code, count] of Object.entries(value.counts)) {
      if (!Number.isSafeInteger(count) || count < 0) continue;
      if (/^(FAIL|REPEAT)_/.test(code)) configs += count;
      else if (/^PASS/.test(code) || code === "VALIDATION_CHALLENGER_BETTER") { configs += count; discovery += count; }
      else if (code === "HOLDOUT_CHALLENGER_BETTER") holdout += count;
    }
    // A holdout is only ever run for a validation winner, so it can never exceed the discoveries.
    if (configs > 0) entries.push(Object.freeze({ id: `RUNTIME_RESEARCH_${interval}`, source: "RUNTIME_RESEARCH" as const, dataType: "CLOSE" as const, timeframe: interval, universe: Math.max(1, markets), methodClass: "RULE" as const, configs, discoveryPass: discovery, holdoutPass: Math.min(holdout, discovery) }));
  }
  return Object.freeze(entries);
}

/**
 * Runtime steering (owner-approved 2026-10-13, WO-RESEARCH-20261013-META-STEERING). The runtime Research grid always evaluates
 * close-derived intraday bars with rule families. When EVERY one of its dimension values is EXHAUSTED and the policy recommends an
 * untried combination elsewhere, the longer-bar runtime orchestrators tick only every META_DEPRIORITIZED_TICK_EVERY-th scheduled
 * tick. Steering only orders work: the first bar length (which also collects candles) always ticks, nothing is ever stopped, and
 * no pass rule, threshold, holdout, budget cap, risk setting or authority changes. Any other state is NORMAL (every tick).
 */
export const META_DEPRIORITIZED_TICK_EVERY = 4;
export type MetaLearningSteeringMode = "NORMAL" | "DEPRIORITIZE_EXHAUSTED";
export interface MetaLearningSteering { readonly mode: MetaLearningSteeringMode; readonly longBarTickEvery: number }
export const META_STEERING_NORMAL: MetaLearningSteering = Object.freeze({ mode: "NORMAL" as const, longBarTickEvery: 1 });

export function metaLearningSteering(report: Pick<MetaLearningReport, "exhausted" | "recommended"> | undefined, runtimeMarkets: number): MetaLearningSteering {
  if (report == null || report.recommended === undefined) return META_STEERING_NORMAL;
  const grid = ["dataType=CLOSE", "timeframe=INTRADAY", `universe=${runtimeMarkets <= 5 ? "FIVE" : "ALL_KRW"}`, "methodClass=RULE"];
  return grid.every((value) => report.exhausted.includes(value))
    ? Object.freeze({ mode: "DEPRIORITIZE_EXHAUSTED" as const, longBarTickEvery: META_DEPRIORITIZED_TICK_EVERY })
    : META_STEERING_NORMAL;
}
