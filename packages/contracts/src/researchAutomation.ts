import type { CandidateLifecycleRecord } from "./candidatePromotion";
import type { ResearchComparisonResult } from "./researchRuntime";

export type ResearchSessionState = "IDLE" | "RUNNING" | "PAUSED" | "HALTED" | "COMPLETED" | "FAILED";
export type ResearchHealth = "HEALTHY" | "STALE" | "DEGRADED" | "FAIL_CLOSED";

export interface ResearchSessionMetrics {
  readonly experimentCount: number;
  readonly positiveEvaluationCount: number;
  readonly negativeEvaluationCount: number;
  readonly cumulativeNetReturn: number;
  readonly averageNetReturn: number;
  readonly maxDrawdown?: number;
  readonly championBetterCount: number;
  readonly challengerBetterCount: number;
  readonly equivalentCount: number;
  readonly inconclusiveCount: number;
  /** Cumulative value from verified explicit cost evidence only. Omitted when no such evidence exists. */
  readonly costAdjustedPerformance?: number;
  /** Number of experiments with verified explicit cost evidence. */
  readonly costAdjustedEvidenceCount?: number;
  /** Number of experiments whose explicit cost evidence was unavailable or unusable. */
  readonly missingCostEvidenceCount?: number;
  readonly unresolvedFaultCount?: number;
  readonly dataQualityFailureCount?: number;
  readonly tradeCount?: number;
  readonly observationDays?: number;
  readonly executionQuality?: number;
  readonly riskAdjustedPerformance?: number;
  readonly lastEvaluationTimestamp?: number;
}

export interface ResearchSessionRecord {
  readonly sessionId: string;
  readonly state: ResearchSessionState;
  readonly datasetId: string;
  readonly interval: string;
  readonly championStrategyId: string;
  readonly championStrategyVersion: string;
  readonly challengerStrategyId: string;
  readonly challengerStrategyVersion: string;
  readonly hypothesisId?: string;
  readonly experimentCount: number;
  readonly evaluationIds: readonly string[];
  readonly lastEvaluationId?: string;
  readonly lastEvidenceAt?: number;
  readonly deterministicConfigHash: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly maxExperiments: number;
  readonly metrics: ResearchSessionMetrics;
}

export interface ResearchStatusProjection {
  readonly sessionId: string;
  readonly state: ResearchSessionState;
  readonly health: ResearchHealth;
  readonly datasetId: string;
  readonly champion: { readonly strategyId: string; readonly strategyVersion: string; readonly authority: "PAPER_ONLY" };
  readonly challenger: { readonly strategyId: string; readonly strategyVersion: string; readonly authority: "ZERO_AUTHORITY" };
  readonly candidateCount: number;
  readonly experimentCount: number;
  readonly lastResult?: ResearchComparisonResult;
  readonly metrics: ResearchSessionMetrics;
  readonly evidenceAgeMs?: number;
  readonly recoveryStatus: "READY" | "PAUSED" | "FAIL_CLOSED";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface ResearchSessionSnapshot {
  readonly schemaVersion: 1;
  readonly session: ResearchSessionRecord;
  readonly checksum: string;
}

export interface ResearchSessionRepository {
  save(record: ResearchSessionRecord): ResearchSessionRecord;
  load(sessionId: string): ResearchSessionRecord | undefined;
  list(): readonly ResearchSessionRecord[];
}

export type ResearchCandidateRegistrar = (identity: {
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly artifactHash: string;
  readonly configHash: string;
  readonly createdAt: number;
  readonly originatingEvaluationId: string;
  readonly originatingInputHash: string;
  readonly authority: "PAPER_ONLY";
  readonly paperOnly: true;
}) => CandidateLifecycleRecord;
