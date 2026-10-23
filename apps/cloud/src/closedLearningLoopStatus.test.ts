import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshClosedLearningProjections, type ClosedLearningMetaLearningStatus } from "./closedLearningLoopStatus";

const META: ClosedLearningMetaLearningStatus = Object.freeze({
  experiments: 4, configurations: 12, discoveryPasses: 2, holdoutPasses: 0,
  validKnowledgePer100Configs: 0, exhausted: "", recommendedPrerequisites: "", nextHoldoutBarMicros: 0,
  runtimeEntries: 0, liveForwardEntries: 0, steeringMode: "DEPRIORITIZE_EXHAUSTED", longBarTickEvery: 4, paperPeriodsConsumed: 0,
});

describe("closed-learning advisory projection isolation", () => {
  it("keeps research cadence when only the display-only learning status read fails", () => {
    let longBarTickEvery = 1;
    let observedMeta: ClosedLearningMetaLearningStatus | undefined;
    let learningStatus: unknown = "unset";
    refreshClosedLearningProjections({
      buildMetaLearning: () => META,
      readLearningStatus: () => { throw new Error("durable learning receipt unavailable"); },
      setLongBarTickEvery: (value) => { longBarTickEvery = value; },
      observeMetaLearning: (value) => { observedMeta = value; },
      observeLearning: (value) => { learningStatus = value; },
    });
    assert.equal(longBarTickEvery, 4);
    assert.equal(observedMeta, META);
    assert.equal(learningStatus, undefined, "malformed/unavailable learning status is withdrawn fail-closed");
  });

  it("retains the conservative cadence fallback when the meta-learning calculation itself fails", () => {
    let longBarTickEvery = 4;
    let observedMeta: ClosedLearningMetaLearningStatus | undefined = META;
    let learningStatus: unknown = undefined;
    refreshClosedLearningProjections({
      buildMetaLearning: () => { throw new Error("meta-learning calculation failed"); },
      readLearningStatus: () => ({ schemaVersion: 1 }),
      setLongBarTickEvery: (value) => { longBarTickEvery = value; },
      observeMetaLearning: (value) => { observedMeta = value; },
      observeLearning: (value) => { learningStatus = value; },
    });
    assert.equal(longBarTickEvery, 1);
    assert.equal(observedMeta, undefined);
    assert.deepEqual(learningStatus, { schemaVersion: 1 });
  });
});
