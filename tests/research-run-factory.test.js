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
const { createResearchHypothesis } = require("../dist/packages/contracts/src/researchHypothesisContract.js");

const SNAPSHOT = Date.parse("2026-08-29T15:00:00.000Z");
const SOURCE_SHA = "a".repeat(40);
const DATASET_HASH = "b".repeat(64);

function canonicalHypothesis(candidateId, createdAt) {
  return createResearchHypothesis({
    hypothesisId: `canonical:${candidateId}`,
    candidateId,
    family: "MOMENTUM",
    rationale: "A precommitted directional persistence claim.",
    mechanism: "Delayed liquidity replenishment can preserve short-lived order-flow pressure.",
    targetMarket: "KRW-BTC",
    expectedRegime: "UNKNOWN",
    invalidationCondition: "The cost-adjusted out-of-sample effect is not reproducible.",
    holdingPeriodMs: 86_400_000,
    capacityAssumptions: { maxNotional: 10_000_000, maxParticipationRate: 0.05 },
    transactionCostSensitivity: 1,
    provenance: { author: "research-run", sourceReferences: ["dataset:upbit-KRW-BTC-1d-20260828"] },
    createdAt,
  });
}

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
        canonicalHypothesis: canonicalHypothesis("sma-5-20", new Date(SNAPSHOT).toISOString()),
      },
      {
        candidateId: "sma-8-20",
        familyId: "sma-crossover",
        lineageId: "sma-crossover-v1",
        parameters: { shortPeriod: 8, longPeriod: 20 },
        codeSha: SOURCE_SHA,
        costModelVersion: "wf-cost-v1",
        canonicalHypothesis: canonicalHypothesis("sma-8-20", new Date(SNAPSHOT).toISOString()),
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
  assert.equal(first.candidates[0].specification.generatedAt, new Date(SNAPSHOT + 1).toISOString());
  assert.match(first.candidates[0].canonicalHypothesisHash, /^[a-f0-9]{64}$/);
  assert.equal(first.candidates[0].canonicalHypothesis.candidateId, first.candidates[0].candidateId);
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

test("rejects a candidate compiled from a different source revision", () => {
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      candidates: [{ ...inputs().candidates[0], codeSha: "c".repeat(40) }],
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "CANDIDATE_SOURCE_MISMATCH",
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

test("requires a rich canonical hypothesis for every candidate", () => {
  const missing = { ...inputs().candidates[0] };
  delete missing.canonicalHypothesis;
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({ candidates: [missing] })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "INVALID_CANONICAL_HYPOTHESIS",
  );
});


test("fixed single-market research remains explicitly universe-not-applicable", () => {
  const plan = buildResearchRunProvenancePlan(inputs());
  assert.deepEqual(plan.universe, { applicability: "NOT_APPLICABLE_FIXED_SINGLE_MARKET" });
});

test("universe-selected research fails closed without point-in-time provenance", () => {
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      universeContext: { selectionMode: "POINT_IN_TIME_UNIVERSE" },
    })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "MISSING_UNIVERSE_PROVENANCE",
  );
});

test("universe-selected research binds exact historical constituent dataset", () => {
  const provenance = {
    schemaVersion: 1,
    universeId: "upbit-krw-active",
    version: "2026-08-29",
    asOf: inputs().manifest.startOpenTime,
    availableAt: inputs().manifest.startOpenTime,
    selectionPolicyId: "listed-krw-v1",
    source: "upbit-market-snapshot",
    constituents: [{
      market: "KRW-BTC",
      datasetId: inputs().manifest.datasetId,
      datasetContentSha256: DATASET_HASH,
      eligibleFrom: inputs().manifest.startOpenTime,
      evidenceRef: "upbit:snapshot:2026-08-29",
    }],
  };
  const plan = buildResearchRunProvenancePlan(inputs({
    universeContext: { selectionMode: "POINT_IN_TIME_UNIVERSE", provenance, manifests: [inputs().manifest] },
  }));
  assert.equal(plan.universe.applicability, "BOUND");
  assert.equal(plan.universe.universeId, "upbit-krw-active");
  assert.match(plan.universe.universeFingerprint, /^[a-f0-9]{64}$/);

  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({
      universeContext: {
        selectionMode: "POINT_IN_TIME_UNIVERSE",
        provenance: {
          ...provenance,
          constituents: [{ ...provenance.constituents[0], datasetId: "survivor-substitution" }],
        },
        manifests: [inputs().manifest],
      },
    })),
    (error) => error instanceof ResearchRunFactoryError
      && error.code === "INVALID_UNIVERSE_PROVENANCE"
      && /UNIVERSE_DATASET_BINDING_MISMATCH/.test(error.message),
  );
});

test("binds point-in-time universe identity and dataset membership", () => {
  const universe = {
    universeId: "upbit-research", universeVersion: "2026-08-29",
    asOf: SNAPSHOT, availableAt: SNAPSHOT,
    eligibilityPolicyId: "eligible-v1", selectionPolicyId: "selection-v1",
    constituents: [{ market: "KRW-BTC", datasetFingerprint: DATASET_HASH, listedAt: SNAPSHOT - 1 }],
  };
  const plan = buildResearchRunProvenancePlan(inputs({ universe }));
  assert.equal(plan.universe.universeId, universe.universeId);
  assert.equal(plan.universe.universeVersion, universe.universeVersion);
  assert.match(plan.universe.universeFingerprint, /^[a-f0-9]{64}$/);
});

test("fails closed when dataset is outside or mismatched with the PIT universe", () => {
  const baseUniverse = {
    universeId: "upbit-research", universeVersion: "2026-08-29",
    asOf: SNAPSHOT, availableAt: SNAPSHOT,
    eligibilityPolicyId: "eligible-v1", selectionPolicyId: "selection-v1",
  };
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({ universe: { ...baseUniverse, constituents: [{ market:"KRW-ETH", datasetFingerprint:DATASET_HASH, listedAt:SNAPSHOT - 1 }] } })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "DATASET_UNIVERSE_MISMATCH",
  );
  assert.throws(
    () => buildResearchRunProvenancePlan(inputs({ universe: { ...baseUniverse, constituents: [{ market:"KRW-BTC", datasetFingerprint:"c".repeat(64), listedAt:SNAPSHOT - 1 }] } })),
    (error) => error instanceof ResearchRunFactoryError && error.code === "DATASET_UNIVERSE_MISMATCH",
  );
});

test("fails closed when the universe was unavailable at evaluation time", () => {
  const universe = {
    universeId:"upbit-research", universeVersion:"future", asOf:SNAPSHOT + 10, availableAt:SNAPSHOT + 10,
    eligibilityPolicyId:"eligible-v1", selectionPolicyId:"selection-v1",
    constituents:[{market:"KRW-BTC",datasetFingerprint:DATASET_HASH,listedAt:SNAPSHOT - 1}],
  };
  assert.throws(() => buildResearchRunProvenancePlan(inputs({ universe })), /FUTURE_LEAKAGE/);
});
