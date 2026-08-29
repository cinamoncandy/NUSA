"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildResearchRunTimeline,
  ResearchRunTimelineError,
} = require("../dist/apps/desktop/src/cloud/researchRunTimeline.js");

test("derives the full research chronology deterministically from one snapshot", () => {
  const first = buildResearchRunTimeline(1_735_689_600_000);
  const second = buildResearchRunTimeline(1_735_689_600_000);

  assert.deepEqual(first, second);
  assert.equal(Date.parse(first.hypothesisGeneratedAt), first.snapshotAt);
  assert.equal(
    Date.parse(first.specificationGeneratedAt) + 1,
    Date.parse(first.evaluationStartedAt),
  );
  assert.equal(
    Date.parse(first.evaluationStartedAt) + 1,
    Date.parse(first.evaluationEndedAt),
  );
  assert.equal(
    Date.parse(first.evaluationEndedAt) + 1,
    Date.parse(first.generatedAt),
  );
});

test("rejects timestamps that cannot safely anchor provenance", () => {
  assert.throws(
    () => buildResearchRunTimeline(-1),
    (error) => error instanceof ResearchRunTimelineError
      && error.code === "INVALID_SNAPSHOT_TIMESTAMP",
  );
  assert.throws(
    () => buildResearchRunTimeline(1.5),
    (error) => error instanceof ResearchRunTimelineError
      && error.code === "INVALID_SNAPSHOT_TIMESTAMP",
  );
});
