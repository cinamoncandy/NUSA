import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CLOSED_LEARNING_COST_MODEL_VERSION_V1,
  CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1,
  readClosedLearningProductionConfig,
} from "./closedLearningProductionConfig";
import {
  DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS,
  DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS,
} from "./closedLearningPaperPeriodLifecycleScheduler";

describe("closed-learning production config", () => {
  it("derives durable sibling evidence paths and conservative lifecycle defaults", () => {
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    const config = readClosedLearningProductionConfig({}, state);
    assert.equal(config.researchReplaySnapshotPath, path.join(path.dirname(state), "research-replay-snapshots.json"));
    assert.equal(config.qualifiedArtifactPath, path.join(path.dirname(state), "qualified-paper-challengers.json"));
    assert.deepEqual(config.executionQualityPolicy, CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1);
    assert.equal(config.paperPeriodWindowMs, DEFAULT_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS);
    assert.equal(config.lifecycleIntervalMs, DEFAULT_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS);
    assert.equal(CLOSED_LEARNING_COST_MODEL_VERSION_V1, "paper-canonical-outcome-cost-v1");
  });

  it("accepts explicit durable paths and operating cadence overrides", () => {
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    const config = readClosedLearningProductionConfig({
      NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: path.resolve("/srv/nusa/research.json"),
      NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH: path.resolve("/srv/nusa/challengers.json"),
      NUSA_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS: "3600000",
      NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS: "30000",
    }, state);
    assert.equal(config.researchReplaySnapshotPath, path.resolve("/srv/nusa/research.json"));
    assert.equal(config.qualifiedArtifactPath, path.resolve("/srv/nusa/challengers.json"));
    assert.equal(config.paperPeriodWindowMs, 3_600_000);
    assert.equal(config.lifecycleIntervalMs, 30_000);
  });

  it("fails closed for in-memory state, non-durable paths or unsafe cadence", () => {
    assert.throws(() => readClosedLearningProductionConfig({}, ":memory:"), /durable Cloud state database/);
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: ":memory:" }, state), /absolute durable path/);
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH: "relative.json" }, state), /absolute durable path/);
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS: "59999" }, state), /PAPER_PERIOD_WINDOW_MS/);
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS: "999" }, state), /LIFECYCLE_INTERVAL_MS/);
    assert.throws(() => readClosedLearningProductionConfig({
      NUSA_CLOSED_LEARNING_PAPER_PERIOD_WINDOW_MS: "60000",
      NUSA_CLOSED_LEARNING_LIFECYCLE_INTERVAL_MS: "60001",
    }, state), /cannot exceed/);
  });
});
