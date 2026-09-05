import path from "node:path";
import type { CanonicalPaperExecutionQualityPolicy } from "./canonicalPaperCandidatePerformance";
import {
  DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS,
  DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS,
} from "./closedLearningPaperPeriodLifecycleScheduler";

export const CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1: CanonicalPaperExecutionQualityPolicy = Object.freeze({
  acceptableSlippageBps: 5,
  poorSlippageBps: 20,
  acceptableLatencyMs: 500,
  poorLatencyMs: 2_000,
});

export const CLOSED_LEARNING_COST_MODEL_VERSION_V1 = "paper-canonical-outcome-cost-v1";

export interface ClosedLearningProductionConfig {
  readonly researchReplaySnapshotPath: string;
  readonly qualifiedArtifactPath: string;
  readonly executionQualityPolicy: CanonicalPaperExecutionQualityPolicy;
  readonly paperPeriodWindowMs: number;
  readonly lifecycleIntervalMs: number;
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

function optionalInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  const normalized = value?.trim();
  if (normalized == null || normalized === "") return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${field} must be an integer in [${minimum}, ${maximum}]`);
  return parsed;
}

/**
 * Closed-learning evidence is colocated beside the canonical durable Cloud SQLite state by default.
 * Operators may override either file with an explicit absolute path. No path may fall back to memory.
 * PAPER evidence windows are an operating cadence only; they do not change Research/League scoring.
 */
export function readClosedLearningProductionConfig(env: NodeJS.ProcessEnv, cloudStateDbPath: string): ClosedLearningProductionConfig {
  const databasePath = durableStatePath(cloudStateDbPath);
  const directory = path.dirname(databasePath);
  const paperPeriodWindowMs = optionalInteger(
    env.NUSA_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS,
    DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS,
    60_000,
    2_592_000_000,
    "NUSA_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS",
  );
  const lifecycleIntervalMs = optionalInteger(
    env.NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS,
    DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS,
    1_000,
    86_400_000,
    "NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS",
  );
  if (lifecycleIntervalMs > paperPeriodWindowMs) throw new Error("NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS cannot exceed the PAPER period window");
  return Object.freeze({
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
    paperPeriodWindowMs,
    lifecycleIntervalMs,
  });
}
