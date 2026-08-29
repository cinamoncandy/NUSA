"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildResearchHypothesis,
} = require("../dist/apps/desktop/src/cloud/researchHypothesis.js");
const {
  buildResearchRunTimeline,
} = require("../dist/apps/desktop/src/cloud/researchRunTimeline.js");
const {
  buildResearchRunProvenancePlan,
  ResearchRunFactoryError,
} = require("../dist/apps/desktop/src/cloud/researchRunFactory.js");

const SNAPSHOT = Date.parse("2026-08-29T15:00:00.000Z");
const SOURCE_SHA = "a".repeat(40);
const DATASET_HASH = "b".repeat(64);

function inputs(overrides = {}) {
  const timeline = buildResearchRunTimeline(SNAPSHOT);
  const manifest = {
    schemaVersion: 1,
    datasetId: "upbit-KRW-BTC-1d-20260828",
    source: "upbit-public-api",
    market: "KRW-BTC",
    interval: "1d",
    candleCount: 200,
    startOpenTime: SNAPSHOT - 200 * 86_400_000,
    endCloseTime: SNAPSHOT - 86_400_000,
    timezone: "UTC",
    ordering: "OPEN_TIME_ASC",
    missingCandlePolicy: "REJECT",
    missingCandleCount: 0,
    createdAt: new Date(SNAPSHOT).toISOString(),
    contentSha256: DATASET_HASH,
  };
  const hypothesis = buildResearchHypothesis({
    hypothesisId: "real-run:upbit-KRW-BTC-1d-20260828:sma-crossover",
    familyId: "sma-crossover",
    market: "KRW-BTC",
    interval: "1d",
    direction: "LONG",
    thesis: "A precommitted SMA hypothesis for a cost-aware research run.",
    sourceDatasetId: manifest.datasetId,
    sourceObservationAsOf: SNAPSHOT - 86_400_000,
    generatedAt: timeline.hypothesisGeneratedAt,
  });
  return {
    manifest,
    hypothesis,
    timeline,
    sourceCommitSha: SOURCE_SHA,
    candidates: [
      {
        candidateId: "sma-5-20",
        familyId: "sma-crossover",
        lineageId: "sma-crossover-v1",
        parameters: { longPeriod: 20, shortPeriod: 5 },
        codeSha: SOURCE_SHA,
        costModelVersion: "wf-cost-v1",
      },
      {
        candidateId: "sma-8-20",
        familyId: "sma-crossover",
        lineageId: "sma-crossover-v1",
        parameters: { shortPeriod: 8, longPeriod: 20 },
        codeSha: SOURCE_SHA,
        costModelVersion: "wf-cost-v1",
      },
    ],
    ...overrides,
  };
}

test("builds a deterministic, immutable hypothesis-to-candidate provenance plan", () => {
  const first = buildResearchRunProvenancePlan(inputs());
  const second = buildResearchRunProvenancePlan(inputs());

  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.candidates));
  assert.ok(Object.isFrozen(first.candidates[0].specification));
  assert.deepEqual(Object.keys(first.candidates[0].parameters), ["longPeriod", "shortPeriod"]);
  assert.equal(first.candidates[0].specification.datasetId, first.dataset.datasetId);
  assert.equal(first.candidates[0].specification.generatedAt, first.candidates[0].specification.evaluationStartedAt.replace(/\\+2$/, ""));
});

test("binds every candidate to the precommitted hypothesis and one dataset", () => {
  const plan = buildResearchRunProvenancePlan(inputs());
  for (const candidate of plan.candidates) {
    assert.equal(candidate.familyId, plan.hypothesis.familyId);
    assert.equal(candidate.specification.familyId, plan.hypothesis.familyId);
    assert.equal(candidate.specification.datasetContentSha256, DATASET_HASH);
    assert.ok(Date.parse(candidate.specification.generatedAt) < Date.parse(candidate.specification.evaluationStartedAt));
    assert.ok(Date.parse(candidate.specification.evaluationStartedAt) < Date.parse(candidate.specification.evaluationEndedAt));
  }
});

test("rejects duplicate candidates and hypothesis-family drift", () => {
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      candidates: [inputs().candidates[0], inputs().candidates[0]],
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "DUPLICATE_CANDIDATE_ID",
  );
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      candidates: [{ ...inputs().candidates[0], familyId: "other-family" }],
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "HYPOTHESIS_FAMILY_MISMATCH",
  );
});

test("rejects malformed dataset, source, and non-snapshot chronology", () => {
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({ sourceCommitSha: "not-a-sha" })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "INVALID_SOURCE_COMMIT_SHA",
  );
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      manifest: { ...inputs().manifest, contentSha256: "invalid" },
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "INVALID_DATASET_MANIFEST",
  );
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      timeline: { ...inputs().timeline, generatedAt: "2026-08-29T15:00:00.009Z" },
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "NON_DETERMINISTIC_TIMELINE",
  );
});

test("rejects secret-like candidate parameters before they enter provenance", () => {
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      candidates: [{ ...inputs().candidates[0], parameters: { apiToken: "must-not-enter" } }],
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "FORBIDDEN_PARAMETER",
  );
});
