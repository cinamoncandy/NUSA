import path from "node:path";
import type { CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";

export const CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1: CanonicalPaperExecutionQualityPolicy = Object.freeze({
  acceptableSlippageBps: 5,
  poorSlippageBps: 20,
  acceptableLatencyMs: 500,
  poorLatencyMs: 2_000,
});

export interface ClosedLearningProductionConfig {
  readonly evaluationPeriodMs: number;
  readonly researchReplaySnapshotPath: string;
  readonly qualifiedArtifactPath: string;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
}

function durableStatePath(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === ":memory:") throw new Error("closed learning production requires a durable Cloud state database path");
  const absolute = path.resolve(normalized);
  if (!path.isAbsolute(absolute)) throw new Error("closed learning production state database path is invalid");
  return absolute;
}

function optionalAbsolutePath(value: string | undefined, fallback: string, field: string): string {
  const normalized = value?.trim();
  const candidate = normalized || fallback;
  if (candidate === ":memory:" || !path.isAbsolute(candidate)) throw new Error(`${field} must be an absolute durable path`);
  return path.resolve(candidate);
}

/**
 * Closed-learning evidence is colocated beside the canonical durable Cloud SQLite state by default.
 * Operators may override either file with an explicit absolute path. No path may fall back to memory.
 */
export function readClosedLearningProductionConfig(env: NodeJS.ProcessEnv, cloudStateDbPath: string): ClosedLearningProductionConfig {
  const databasePath = durableStatePath(cloudStateDbPath);
  const directory = path.dirname(databasePath);
  const configuredPeriod = env.NUSA_CLOSED_LEARNING_EVALUATION_PERIOD_MS;
  const evaluationPeriodMs = configuredPeriod === undefined ? 3_600_000 : Number(configuredPeriod);
  if (!['3600000', '86400000'].includes(configuredPeriod ?? '3600000')) throw new Error("NUSA_CLOSED_LEARNING_EVALUATION_PERIOD_MS_INVALID");
  return Object.freeze({
    evaluationPeriodMs,
    researchReplaySnapshotPath: optionalAbsolutePath(
      env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH,
      path.join(directory, "research-replay-snapshots.json"),
      "NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH",
    ),
    qualifiedArtifactPath: optionalAbsolutePath(
      env.NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH,
      path.join(directory, "qualified-paper-challengers.json"),
      "NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH",
    ),
    executionQualityPolicy: CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1,
  });
}
