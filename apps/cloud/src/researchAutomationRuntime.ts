import { createHash } from "node:crypto";
import type { CandidateLifecycleRecord, ResearchCandidateIdentity } from "../../../packages/contracts/src/candidatePromotion";
import type { ResearchComparisonEvidence, ResearchInputSnapshot } from "../../../packages/contracts/src/researchRuntime";
import type { ResearchRecoveryResult } from "../../../packages/contracts/src/researchRecovery";
import type { ResearchHealth, ResearchSessionMetrics, ResearchSessionRecord, ResearchSessionRepository, ResearchSessionState, ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { ResearchExperimentRecord, ResearchHypothesis, SqliteResearchMemoryRepository } from "../../../packages/storage/src/researchMemory";
import type { ResearchRuntimeCoordinator } from "./researchRuntimeCoordinator";
import { deriveResearchCandidateId, ResearchCandidateGate } from "./researchCandidateGate";
import { ResearchStreamNormalizer } from "./researchStreamNormalizer";
import { createResearchExperimentManifest, createResearchExperimentResult, researchHardeningHash } from "../../../packages/contracts/src/researchHardening";

export interface ResearchMemoryWriter {
  appendExperiment(record: ResearchExperimentRecord): ResearchExperimentRecord;
  appendHypothesis?(record: ResearchHypothesis): ResearchHypothesis;
  appendHypothesisEvent?(record: { readonly hypothesisId: string; readonly type: "CREATED"; readonly title: string; readonly statement: string; readonly occurredAt: string }): unknown;
}

export interface ResearchAutomationOptions {
  readonly coordinator: ResearchRuntimeCoordinator;
  readonly sessions: ResearchSessionRepository;
  readonly memory: ResearchMemoryWriter;
  readonly registerCandidate: (identity: ResearchCandidateIdentity) => CandidateLifecycleRecord;
  readonly listCandidates: () => readonly CandidateLifecycleRecord[];
  readonly recovery?: { recover(): ResearchRecoveryResult };
  readonly now?: () => number;
  readonly maxEvidenceAgeMs?: number;
  readonly buildInput?: (input: ResearchRuntimeMarketDataInput, session: ResearchSessionRecord) => ResearchInputSnapshot;
  readonly candidateGate?: ResearchCandidateGate;
  readonly streamNormalizer?: ResearchStreamNormalizer;
}

export interface ResearchSessionStartInput {
  readonly sessionId: string;
  readonly datasetId: string;
  readonly interval: string;
  readonly championStrategyId: string;
  readonly championStrategyVersion: string;
  readonly challengerStrategyId: string;
  readonly challengerStrategyVersion: string;
  readonly deterministicConfig: Readonly<Record<string, unknown>>;
  readonly maxExperiments: number;
  readonly hypothesis?: ResearchHypothesis;
}

export interface ResearchRuntimeMarketDataInput {
  readonly market: string;
  readonly price: number;
  readonly observedAt: number;
  readonly now: number;
}

const freeze = <T>(value: T): T => Object.freeze(value);
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const validText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const zeroMetrics = (): ResearchSessionMetrics => freeze({ experimentCount: 0, positiveEvaluationCount: 0, negativeEvaluationCount: 0, cumulativeNetReturn: 0, averageNetReturn: 0, costAdjustedEvidenceCount: 0, missingCostEvidenceCount: 0, unresolvedFaultCount: 0, dataQualityFailureCount: 0, tradeCount: 0, observationDays: 0, executionQuality: 0, riskAdjustedPerformance: 0 });

function requireStart(input: ResearchSessionStartInput): void {
  for (const [field, value] of Object.entries(input)) if (["deterministicConfig", "maxExperiments", "hypothesis"].includes(field) === false && !validText(value)) throw new Error(`research session ${field} is required`);
  if (!Number.isSafeInteger(input.maxExperiments) || input.maxExperiments <= 0) throw new Error("research session maxExperiments is invalid");
  if (input.championStrategyId === input.challengerStrategyId && input.championStrategyVersion === input.challengerStrategyVersion) throw new Error("champion and challenger must be distinct");
}

function metric(record: ResearchComparisonEvidence, current: ResearchSessionMetrics): ResearchSessionMetrics {
  const netReturn = record.challenger?.metrics.netReturn;
  const value = typeof netReturn === "number" && Number.isFinite(netReturn) ? netReturn : 0;
  const result = record.result;
  const count = current.experimentCount + 1;
  const nextMaxDrawdown = record.challenger?.metrics.maxDrawdown;
  const costAdjusted = record.challenger?.metrics.costAdjustedReturn;
  const hasVerifiedCostAdjustedValue = record.costEvidence != null && typeof costAdjusted === "number" && Number.isFinite(costAdjusted);
  const unresolvedFaultCount = record.challenger?.metrics.unresolvedFaultCount;
  const dataQualityFailureCount = record.challenger?.metrics.dataQualityFailures;
  const tradeCount = record.challenger?.metrics.tradeCount;
  const observationDays = record.challenger?.metrics.observationDays;
  const executionQuality = record.challenger?.metrics.executionQuality;
  const riskAdjustedPerformance = record.challenger?.metrics.sharpeRatio;
  return freeze({
    experimentCount: count,
    positiveEvaluationCount: current.positiveEvaluationCount + (value > 0 ? 1 : 0),
    negativeEvaluationCount: current.negativeEvaluationCount + (value < 0 ? 1 : 0),
    cumulativeNetReturn: current.cumulativeNetReturn + value,
    averageNetReturn: (current.cumulativeNetReturn + value) / count,
    ...(typeof nextMaxDrawdown === "number" && Number.isFinite(nextMaxDrawdown) ? { maxDrawdown: current.maxDrawdown == null ? nextMaxDrawdown : Math.max(current.maxDrawdown, nextMaxDrawdown) } : current.maxDrawdown == null ? {} : { maxDrawdown: current.maxDrawdown }),
    championBetterCount: current.championBetterCount + (result === "CHAMPION_BETTER" ? 1 : 0),
    challengerBetterCount: current.challengerBetterCount + (result === "CHALLENGER_BETTER" ? 1 : 0),
    equivalentCount: current.equivalentCount + (result === "EQUIVALENT" ? 1 : 0),
    inconclusiveCount: current.inconclusiveCount + (result === "INCONCLUSIVE" ? 1 : 0),
    ...(hasVerifiedCostAdjustedValue ? { costAdjustedPerformance: (current.costAdjustedPerformance ?? 0) + (costAdjusted as number) } : current.costAdjustedPerformance == null ? {} : { costAdjustedPerformance: current.costAdjustedPerformance }),
    costAdjustedEvidenceCount: (current.costAdjustedEvidenceCount ?? 0) + (hasVerifiedCostAdjustedValue ? 1 : 0),
    missingCostEvidenceCount: (current.missingCostEvidenceCount ?? 0) + (hasVerifiedCostAdjustedValue ? 0 : 1),
    unresolvedFaultCount: (current.unresolvedFaultCount ?? 0) + (typeof unresolvedFaultCount === "number" && Number.isFinite(unresolvedFaultCount) ? unresolvedFaultCount : 0),
    dataQualityFailureCount: (current.dataQualityFailureCount ?? 0) + (typeof dataQualityFailureCount === "number" && Number.isFinite(dataQualityFailureCount) ? dataQualityFailureCount : 0),
    tradeCount: (current.tradeCount ?? 0) + (typeof tradeCount === "number" && Number.isFinite(tradeCount) ? tradeCount : 0),
    observationDays: Math.max(current.observationDays ?? 0, typeof observationDays === "number" && Number.isFinite(observationDays) ? observationDays : 0),
    executionQuality: typeof executionQuality === "number" && Number.isFinite(executionQuality) ? executionQuality : current.executionQuality ?? 0,
    riskAdjustedPerformance: typeof riskAdjustedPerformance === "number" && Number.isFinite(riskAdjustedPerformance) ? riskAdjustedPerformance : current.riskAdjustedPerformance ?? 0,
    lastEvaluationTimestamp: record.evaluationTimestamp
  });
}

export class ResearchAutomationRuntime {
  private readonly now: () => number;
  private readonly maxEvidenceAgeMs: number;
  private recoveryStatus: "READY" | "FAIL_CLOSED" = "READY";
  private readonly candidateGate: ResearchCandidateGate;
  private readonly streamNormalizer: ResearchStreamNormalizer;
  public constructor(private readonly options: ResearchAutomationOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? 86_400_000;
    this.candidateGate = options.candidateGate ?? new ResearchCandidateGate({ nowMs: this.now(), clock: this.now });
    this.streamNormalizer = options.streamNormalizer ?? new ResearchStreamNormalizer();
  }

  public startSession(input: ResearchSessionStartInput): ResearchSessionRecord {
    requireStart(input);
    if (this.options.sessions.load(input.sessionId) != null) throw new Error("research session already exists");
    const startedAt = this.now();
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) throw new Error("research session clock is invalid");
    if (input.hypothesis != null && this.options.memory.appendHypothesisEvent != null) this.options.memory.appendHypothesisEvent({ hypothesisId: input.hypothesis.id, type: "CREATED", title: input.hypothesis.title, statement: input.hypothesis.statement, occurredAt: input.hypothesis.createdAt });
    else if (input.hypothesis != null && this.options.memory.appendHypothesis != null) this.options.memory.appendHypothesis(input.hypothesis);
    const record = freeze({
      sessionId: input.sessionId,
      state: "RUNNING" as const,
      datasetId: input.datasetId,
      interval: input.interval,
      championStrategyId: input.championStrategyId,
      championStrategyVersion: input.championStrategyVersion,
      challengerStrategyId: input.challengerStrategyId,
      challengerStrategyVersion: input.challengerStrategyVersion,
      ...(input.hypothesis == null ? {} : { hypothesisId: input.hypothesis.id }),
      experimentCount: 0,
      evaluationIds: freeze([] as string[]),
      deterministicConfigHash: hash(input.deterministicConfig),
      startedAt,
      updatedAt: startedAt,
      maxExperiments: input.maxExperiments,
      metrics: zeroMetrics()
    });
    return this.options.sessions.save(record);
  }

  public pause(sessionId: string): ResearchSessionRecord { return this.transition(sessionId, "PAUSED", ["RUNNING"]); }
  public resume(sessionId: string): ResearchSessionRecord { if (this.recoveryStatus !== "READY") throw new Error("research recovery is fail-closed"); return this.transition(sessionId, "RUNNING", ["PAUSED", "IDLE"]); }
  public stop(sessionId: string): ResearchSessionRecord { return this.transition(sessionId, "COMPLETED", ["RUNNING", "PAUSED", "IDLE"]); }
  public halt(sessionId: string): ResearchSessionRecord { return this.transition(sessionId, "HALTED", ["RUNNING", "PAUSED", "IDLE"]); }

  public runExperiment(input: ResearchInputSnapshot): ResearchComparisonEvidence {
    const session = this.requireSession(input.researchRunId);
    if (this.recoveryStatus !== "READY") throw new Error("research recovery is fail-closed");
    if (session.state !== "RUNNING") throw new Error("research session is not running");
    if (session.experimentCount >= session.maxExperiments) return this.options.coordinator.ledgerRecords().find((item) => item.evaluationId === input.evaluationId) ?? (() => { throw new Error("research session experiment limit reached"); })();
    const prior = this.options.coordinator.ledgerRecords().find((item) => item.evaluationId === input.evaluationId);
    if (prior != null) {
      if (session.evaluationIds.includes(input.evaluationId)) return prior;
      throw new Error("evaluation already belongs to another research session");
    }
    let evidence: ResearchComparisonEvidence;
    try { evidence = this.options.coordinator.evaluate(input); } catch (error) { this.failSession(session); throw error; }
    try {
      const provenance = evidence.provenance;
      const experimentId = provenance?.experimentId ?? `experiment-${hash({ sessionId: session.sessionId, evaluationId: evidence.evaluationId }).slice(0, 48)}`;
      const observationTimes = input.marketData.map((point) => point.observedAt);
      const experimentManifest = provenance == null ? null : createResearchExperimentManifest({ experimentId, researchRunId: provenance.researchRunId, sessionId: provenance.sessionId, hypothesisId: provenance.hypothesisId, datasetId: provenance.datasetId, datasetContentSha256: provenance.datasetContentSha256, splitIdentity: provenance.splitIdentity, splitHash: provenance.splitHash, windowId: provenance.windowId, windowRole: provenance.windowRole, startEventTime: provenance.startEventTime, endEventTime: provenance.endEventTime, featurePipelineHash: provenance.featurePipelineHash, strategyArtifactHash: provenance.strategyArtifactHash, strategyConfigHash: provenance.strategyConfigHash, sourceCommitSha: provenance.sourceCommitSha, evaluatorVersion: provenance.evaluatorVersion, modelVersion: provenance.modelVersion, fillModelVersion: provenance.fillModelVersion, feeModelVersion: provenance.feeModelVersion, slippageModelVersion: provenance.slippageModelVersion, randomSeed: provenance.randomSeed, walkForwardConfigHash: provenance.walkForwardConfigHash });
      const experimentResult = provenance == null ? null : createResearchExperimentResult({ experimentId, evaluationId: evidence.evaluationId, result: evidence.result, champion: evidence.champion?.metrics as never, challenger: evidence.challenger?.metrics as never, inconclusiveRate: evidence.result === "INCONCLUSIVE" ? 1 : 0, statisticalConfidence: evidence.challenger?.metrics.statisticalConfidence ?? 0, superiorityMargin: evidence.challenger?.metrics.superiorityMargin ?? 0, provenanceHash: researchHardeningHash(provenance) });
      this.options.memory.appendExperiment({
        id: experimentId,
        datasetId: session.datasetId,
        contentSha256: evidence.canonicalInputHash,
        manifestSchemaVersion: experimentManifest?.schemaVersion ?? 1,
        market: input.marketData.map((point) => point.market).sort().join(",") || "UNKNOWN",
        interval: session.interval,
        startOpenTime: Math.min(...observationTimes, input.marketDataTimestamp),
        endCloseTime: Math.max(...observationTimes, input.evaluationTimestamp),
        walkForwardConfigJson: experimentManifest == null ? canonicalResearchJson({ sessionId: session.sessionId, deterministicConfigHash: session.deterministicConfigHash }) : canonicalResearchJson(experimentManifest),
        resultJson: experimentResult == null ? canonicalResearchJson({ evaluationId: evidence.evaluationId, result: evidence.result, reason: evidence.reason, champion: evidence.champion?.metrics ?? null, challenger: evidence.challenger?.metrics ?? null }) : canonicalResearchJson(experimentResult),
        createdAt: new Date(this.now()).toISOString(),
        ...(session.hypothesisId == null ? {} : { hypothesisId: session.hypothesisId })
      });
      if (evidence.result === "CHALLENGER_BETTER" && evidence.challenger != null) {
        const decision = this.candidateGate.evaluate({ candidateId: deriveResearchCandidateId(session.sessionId, evidence.challenger.strategyId, evidence.challenger.strategyVersion), evidence: this.options.coordinator.ledgerRecords().filter((item) => item.researchRunId === session.sessionId && item.challenger?.strategyId === evidence.challenger?.strategyId && item.challenger?.strategyVersion === evidence.challenger?.strategyVersion), ledgerIntegrity: true });
        if (decision.status === "ELIGIBLE") this.registerCandidate(session, evidence);
      }
      const next: ResearchSessionRecord = freeze({ ...session, experimentCount: session.experimentCount + 1, evaluationIds: freeze([...session.evaluationIds, evidence.evaluationId]), lastEvaluationId: evidence.evaluationId, lastEvidenceAt: evidence.evaluationTimestamp, updatedAt: this.now(), metrics: metric(evidence, session.metrics), state: session.experimentCount + 1 >= session.maxExperiments ? "COMPLETED" : session.state });
      this.options.sessions.save(next);
      return evidence;
    } catch (error) {
      this.failSession(session);
      throw error;
    }
  }

  public onMarketData(input: ResearchRuntimeMarketDataInput): ResearchComparisonEvidence | undefined {
    const sessions = this.options.sessions.list().filter((session) => session.state === "RUNNING");
    if (sessions.length === 0) return undefined;
    if (sessions.length > 1) throw new Error("multiple running research sessions are not supported");
    const normalized = this.streamNormalizer.accept({ market: input.market, price: input.price, eventTime: input.observedAt, receivedAt: input.now });
    if (["DUPLICATE", "TOO_LATE", "OVERLOADED", "CLOCK_SKEW"].includes(normalized.disposition) || normalized.event == null) return undefined;
    if (this.options.buildInput == null) throw new Error("research market input builder is not configured");
    return this.runExperiment(this.options.buildInput({ market: normalized.event.market, price: normalized.event.price, observedAt: normalized.event.eventTime, now: normalized.event.receivedAt }, sessions[0]!));
  }

  public recover(): ResearchRecoveryResult {
    try {
      const result = this.options.recovery?.recover() ?? { status: "READY" as const, snapshot: null, reasons: [] as readonly string[] };
      if (result.status !== "READY") {
        this.recoveryStatus = "FAIL_CLOSED";
        for (const session of this.options.sessions.list()) if (session.state === "RUNNING") this.options.sessions.save(freeze({ ...session, state: "HALTED", updatedAt: this.now() }));
        return result;
      }
      this.recoveryStatus = "READY";
      for (const session of this.options.sessions.list()) if (session.state === "RUNNING") this.options.sessions.save(freeze({ ...session, state: "PAUSED", updatedAt: this.now() }));
      return result;
    } catch (error) {
      this.recoveryStatus = "FAIL_CLOSED";
      return Object.freeze({ status: "FAIL_CLOSED" as const, snapshot: null, reasons: Object.freeze([error instanceof Error ? error.message : "RESEARCH_AUTOMATION_RECOVERY_FAILED"]) });
    }
  }

  public status(sessionId: string): ResearchStatusProjection {
    const session = this.requireSession(sessionId);
    const now = this.now();
    const evidenceAgeMs = session.lastEvidenceAt == null ? undefined : Math.max(0, now - session.lastEvidenceAt);
    const health = this.health(session, evidenceAgeMs);
    let lastResult;
    if (this.recoveryStatus === "READY" && session.lastEvaluationId != null) {
      try { lastResult = this.options.coordinator.ledgerRecords().find((item) => item.evaluationId === session.lastEvaluationId)?.result; } catch { this.recoveryStatus = "FAIL_CLOSED"; }
    }
    return freeze({ sessionId, state: session.state, health, datasetId: session.datasetId, champion: freeze({ strategyId: session.championStrategyId, strategyVersion: session.championStrategyVersion, authority: "PAPER_ONLY" as const }), challenger: freeze({ strategyId: session.challengerStrategyId, strategyVersion: session.challengerStrategyVersion, authority: "ZERO_AUTHORITY" as const }), candidateCount: this.options.listCandidates().length, experimentCount: session.experimentCount, ...(lastResult == null ? {} : { lastResult }), metrics: session.metrics, ...(evidenceAgeMs == null ? {} : { evidenceAgeMs }), recoveryStatus: this.recoveryStatus === "READY" ? session.state === "PAUSED" ? "PAUSED" as const : "READY" as const : "FAIL_CLOSED" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const });
  }

  private health(session: ResearchSessionRecord, evidenceAgeMs: number | undefined): ResearchHealth {
    if (this.recoveryStatus !== "READY" || session.state === "HALTED" || session.state === "FAILED") return "FAIL_CLOSED";
    if (session.experimentCount === 0 || evidenceAgeMs == null) return "DEGRADED";
    if (evidenceAgeMs > this.maxEvidenceAgeMs) return "STALE";
    if (session.metrics.inconclusiveCount / session.metrics.experimentCount > 0.5) return "DEGRADED";
    return "HEALTHY";
  }

  private registerCandidate(session: ResearchSessionRecord, evidence: ResearchComparisonEvidence): CandidateLifecycleRecord {
    const challenger = evidence.challenger!;
    const supporting = this.options.coordinator.ledgerRecords().filter((item) => item.researchRunId === session.sessionId && item.challenger?.strategyId === challenger.strategyId && item.challenger?.strategyVersion === challenger.strategyVersion).sort((left, right) => left.evaluationId.localeCompare(right.evaluationId))[0] ?? evidence;
    const identity: ResearchCandidateIdentity = freeze({ candidateId: `candidate-${hash({ sessionId: session.sessionId, strategyId: challenger.strategyId, strategyVersion: challenger.strategyVersion, artifactHash: hash(challenger) }).slice(0, 48)}`, strategyId: challenger.strategyId, strategyVersion: challenger.strategyVersion, artifactHash: hash(challenger), configHash: hash({ modelVersion: evidence.modelVersion, fillModelVersion: evidence.fillModelVersion, feeModelVersion: evidence.feeModelVersion, slippageModelVersion: evidence.slippageModelVersion }), createdAt: this.now(), originatingEvaluationId: supporting.evaluationId, originatingInputHash: supporting.canonicalInputHash, authority: "PAPER_ONLY", paperOnly: true });
    return this.options.registerCandidate(identity);
  }

  private requireSession(sessionId: string): ResearchSessionRecord { const session = this.options.sessions.load(sessionId); if (session == null) throw new Error("research session not found"); return session; }
  private transition(sessionId: string, state: ResearchSessionState, allowed: readonly ResearchSessionState[]): ResearchSessionRecord { const session = this.requireSession(sessionId); if (!allowed.includes(session.state)) throw new Error(`research session transition ${session.state} -> ${state} rejected`); return this.options.sessions.save(freeze({ ...session, state, updatedAt: this.now() })); }
  private failSession(session: ResearchSessionRecord): void { try { this.options.sessions.save(freeze({ ...session, state: "FAILED", updatedAt: this.now() })); } catch { /* preserve the original failure; runtime remains fail-closed */ } }
}

export type { SqliteResearchMemoryRepository };
