/**
 * Governs the 6 AI research assistant call sites with per-assistant call caps and
 * request deduplication (cache), so a single session cannot silently run unbounded
 * AI inference cost across:
 *   - aiRegimeExplainer.ts     (explainRegime)
 *   - aiRiskCommentary.ts      (explainRisk)
 *   - aiSessionSummary.ts      (summarizeSession)
 *   - aiSignalExplainer.ts     (explainStrategySignal / answerSignalFollowUp)
 *   - scenarioCounterfactualEvaluator.ts (evaluateScenarioCounterfactual)
 *   - aiStrategyOptimizer.ts   (optimizeStrategy)
 *
 * This module has no dependency on any of the six -- each call site opts in by
 * checking canAdmitCall() before invoking its client and calling recordCall()
 * (or recordCacheHit()) after, so it can be adopted incrementally without a
 * breaking change to any of the six modules' existing signatures.
 */

export type ResearchAssistantId =
  | "REGIME_EXPLAINER"
  | "RISK_COMMENTARY"
  | "SESSION_SUMMARY"
  | "SIGNAL_EXPLAINER"
  | "SCENARIO_COUNTERFACTUAL"
  | "STRATEGY_OPTIMIZER";

export interface ResearchAssistantCallRecord {
  readonly assistantId: ResearchAssistantId;
  readonly inputHash: string;
  readonly requestedAt: number;
}

export interface ResearchAssistantGovernorPolicy {
  /** Per-assistant call cap within one governed session (e.g. one app run). */
  readonly maxCallsPerAssistant: number;
  /** Identical (assistantId, inputHash) pairs within this window are served from cache, not re-called. */
  readonly cacheWindowMs: number;
  /** Hard ceiling across all six assistants combined. */
  readonly totalMaxCalls: number;
}

export interface ResearchAssistantGovernorSnapshot {
  readonly policy: ResearchAssistantGovernorPolicy;
  readonly totalCalls: number;
  readonly cacheHits: number;
  readonly callsByAssistant: Readonly<Record<ResearchAssistantId, number>>;
  readonly activeCacheEntries: number;
  readonly snapshotAt: number;
}

const DEFAULT_POLICY: ResearchAssistantGovernorPolicy = Object.freeze({
  maxCallsPerAssistant: 10,
  cacheWindowMs: 120_000, // 2 minutes
  totalMaxCalls: 40
});

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}

const EMPTY_COUNTS: Record<ResearchAssistantId, number> = Object.freeze({
  REGIME_EXPLAINER: 0,
  RISK_COMMENTARY: 0,
  SESSION_SUMMARY: 0,
  SIGNAL_EXPLAINER: 0,
  SCENARIO_COUNTERFACTUAL: 0,
  STRATEGY_OPTIMIZER: 0
});

export class ResearchAssistantGovernor {
  private readonly policy: ResearchAssistantGovernorPolicy;
  private totalCalls = 0;
  private cacheHits = 0;
  private readonly callsByAssistant: Record<ResearchAssistantId, number> = { ...EMPTY_COUNTS };
  private cache: ResearchAssistantCallRecord[] = [];

  constructor(policy: Partial<ResearchAssistantGovernorPolicy> = {}) {
    const merged = { ...DEFAULT_POLICY, ...policy };
    assertPositiveInteger(merged.maxCallsPerAssistant, "maxCallsPerAssistant");
    assertPositiveInteger(merged.cacheWindowMs, "cacheWindowMs");
    assertPositiveInteger(merged.totalMaxCalls, "totalMaxCalls");
    this.policy = Object.freeze(merged);
  }

  private findCacheEntry(assistantId: ResearchAssistantId, inputHash: string, now: number): ResearchAssistantCallRecord | undefined {
    return this.cache.find((entry) => entry.assistantId === assistantId && entry.inputHash === inputHash && now - entry.requestedAt < this.policy.cacheWindowMs);
  }

  private evictExpired(now: number): void {
    const expiry = now - this.policy.cacheWindowMs;
    this.cache = this.cache.filter((entry) => entry.requestedAt > expiry);
  }

  /**
   * Call before invoking an assistant. Returns "CACHE_HIT" if an identical request was
   * already served within the cache window (caller should reuse the prior result and
   * skip the network call), "ADMITTED" if a fresh call is allowed, or "BLOCKED" if the
   * per-assistant or total cap has been reached.
   */
  check(assistantId: ResearchAssistantId, inputHash: string, now: number): "CACHE_HIT" | "ADMITTED" | "BLOCKED" {
    this.evictExpired(now);
    if (this.findCacheEntry(assistantId, inputHash, now) != null) return "CACHE_HIT";
    if (this.callsByAssistant[assistantId] >= this.policy.maxCallsPerAssistant) return "BLOCKED";
    if (this.totalCalls >= this.policy.totalMaxCalls) return "BLOCKED";
    return "ADMITTED";
  }

  /** Record a fresh call that was actually made (after check() returned "ADMITTED"). */
  recordCall(assistantId: ResearchAssistantId, inputHash: string, now: number): void {
    this.callsByAssistant[assistantId] += 1;
    this.totalCalls += 1;
    this.cache.push(Object.freeze({ assistantId, inputHash, requestedAt: now }));
    this.evictExpired(now);
  }

  /** Record that a request was served from cache instead of calling out (after check() returned "CACHE_HIT"). */
  recordCacheHit(): void {
    this.cacheHits += 1;
  }

  snapshot(now: number): ResearchAssistantGovernorSnapshot {
    this.evictExpired(now);
    return Object.freeze({
      policy: this.policy,
      totalCalls: this.totalCalls,
      cacheHits: this.cacheHits,
      callsByAssistant: Object.freeze({ ...this.callsByAssistant }),
      activeCacheEntries: this.cache.length,
      snapshotAt: now
    });
  }

  reset(): void {
    this.totalCalls = 0;
    this.cacheHits = 0;
    for (const id of Object.keys(this.callsByAssistant) as ResearchAssistantId[]) this.callsByAssistant[id] = 0;
    this.cache = [];
  }
}
