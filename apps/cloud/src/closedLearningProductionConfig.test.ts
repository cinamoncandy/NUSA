import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1, readClosedLearningProductionConfig } from "./closedLearningProductionConfig";

describe("closed-learning production config", () => {
  it("derives durable sibling evidence paths from the canonical Cloud state database", () => {
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    const config = readClosedLearningProductionConfig({}, state);
    assert.equal(config.researchReplaySnapshotPath, path.join(path.dirname(state), "research-replay-snapshots.json"));
    assert.equal(config.qualifiedArtifactPath, path.join(path.dirname(state), "qualified-paper-challengers.json"));
    assert.deepEqual(config.executionQualityPolicy, CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1);
  });

  it("accepts explicit absolute durable evidence paths", () => {
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    const config = readClosedLearningProductionConfig({
      NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: path.resolve("/srv/nusa/research.json"),
      NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH: path.resolve("/srv/nusa/challengers.json"),
    }, state);
    assert.equal(config.researchReplaySnapshotPath, path.resolve("/srv/nusa/research.json"));
    assert.equal(config.qualifiedArtifactPath, path.resolve("/srv/nusa/challengers.json"));
  });

  it("fails closed for an in-memory production state database or non-durable overrides", () => {
    assert.throws(() => readClosedLearningProductionConfig({}, ":memory:"), /durable Cloud state database/);
    const state = path.resolve("/var/lib/nusa/state.sqlite");
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: ":memory:" }, state), /absolute durable path/);
    assert.throws(() => readClosedLearningProductionConfig({ NUSA_QUALIFIED_PAPER_CHALLENGER_ARTIFACT_PATH: "relative.json" }, state), /absolute durable path/);
  });
});
