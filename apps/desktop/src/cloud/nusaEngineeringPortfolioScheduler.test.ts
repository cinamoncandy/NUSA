import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEngineeringWorkPortfolio,
  rankEngineeringOpportunities,
  scoreEngineeringOpportunity,
  type EngineeringOpportunityPriorityInput,
  type EngineeringWorkPackageInput,
} from "./nusaEngineeringPortfolioScheduler.js";

function opportunity(
  opportunityId: string,
  overrides: Partial<EngineeringOpportunityPriorityInput> = {},
): EngineeringOpportunityPriorityInput {
  return {
    opportunityId,
    expectedProductValue: 70,
    riskReduction: 50,
    evidenceGain: 60,
    criticalPathUnlock: 40,
    effortCost: 30,
    dependencyFanOut: 20,
    uncertainty: 10,
    ...overrides,
  };
}

test("ranks deterministic evidence scores highest first", () => {
  const ranked = rankEngineeringOpportunities([
    opportunity("low", { expectedProductValue: 20, criticalPathUnlock: 10 }),
    opportunity("high", { expectedProductValue: 90, criticalPathUnlock: 90 }),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["high", "low"]);
  assert.equal(ranked[0]?.classification, "RANKABLE");
  assert.equal(typeof ranked[0]?.score, "number");
});

test("fails closed when any priority input is unknown", () => {
  const result = scoreEngineeringOpportunity(opportunity("unknown-risk", { riskReduction: "UNKNOWN" }));

  assert.equal(result.classification, "INSUFFICIENT");
  assert.equal(result.score, null);
  assert.deepEqual(result.reasons, ["UNKNOWN_RISKREDUCTION"]);
});

test("keeps insufficient opportunities below rankable evidence", () => {
  const ranked = rankEngineeringOpportunities([
    opportunity("unknown", { effortCost: "UNKNOWN" }),
    opportunity("known"),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["known", "unknown"]);
});

test("uses opportunity id as stable tie breaker", () => {
  const ranked = rankEngineeringOpportunities([opportunity("b"), opportunity("a")]);
  assert.deepEqual(ranked.map((entry) => entry.opportunityId), ["a", "b"]);
});

test("rejects fabricated out-of-range confidence components", () => {
  assert.throws(
    () => scoreEngineeringOpportunity(opportunity("bad", { uncertainty: 101 })),
    /ENGINEERING_PRIORITY_INVALID_UNCERTAINTY/,
  );
});

test("fails closed on duplicate or unsafe opportunity identities", () => {
  assert.throws(
    () => rankEngineeringOpportunities([opportunity("same"), opportunity("same")]),
    /ENGINEERING_PRIORITY_DUPLICATE_OPPORTUNITY_ID/,
  );
  assert.throws(
    () => scoreEngineeringOpportunity(opportunity("unsafe id")),
    /ENGINEERING_PRIORITY_OPPORTUNITY_ID_INVALID/,
  );
});

function workPackage(
  packageId: string,
  overrides: Partial<EngineeringWorkPackageInput> = {},
): EngineeringWorkPackageInput {
  return {
    packageId,
    opportunityId: `${packageId}-opportunity`,
    priority: "P1",
    incident: false,
    lane: "FAST",
    evidenceState: "VERIFIED",
    repositoryControlled: true,
    dependencies: [],
    touchedFiles: [`apps/${packageId}.ts`],
    evidenceRequirements: ["exact-head-ci"],
    estimatedEffort: 20,
    risk: 10,
    blastRadius: 10,
    validationRequirements: ["targeted-test", "safety-gates"],
    duplicateOf: null,
    waitingReason: null,
    ...overrides,
  };
}

test("builds an evidence-bound work portfolio without discarding conflict or parked work", () => {
  const portfolio = buildEngineeringWorkPortfolio([
    workPackage("incident", { priority: "P0", incident: true, lane: "DEEP", touchedFiles: ["shared.ts"] }),
    workPackage("fast", { touchedFiles: ["fast.ts"] }),
    workPackage("deep", { lane: "DEEP", touchedFiles: ["shared.ts"] }),
    workPackage("verified-dependency", { dependencies: ["merged-base"] }),
    workPackage("unknown", { evidenceState: "UNKNOWN" }),
    workPackage("unknown-metadata", { estimatedEffort: "UNKNOWN" }),
    workPackage("human", { waitingReason: "HUMAN_ONLY" }),
    workPackage("external", { repositoryControlled: false }),
    workPackage("duplicate", { duplicateOf: "fast" }),
  ], {
    mergedPackageIds: ["merged-base"],
    activeTouchedFiles: ["active.ts"],
    activeWorkerCount: 2,
    activeClaimCount: 1,
  });

  assert.deepEqual(portfolio.ready.map((item) => item.packageId), ["incident", "fast", "verified-dependency", "deep"]);
  assert.equal(portfolio.metrics.candidateGapCount, 8);
  assert.equal(portfolio.metrics.validatedGapCount, 7);
  assert.equal(portfolio.metrics.readyBacklog, 4);
  assert.equal(portfolio.metrics.readyToWorkerRatio, 2);
  assert.equal(portfolio.metrics.activeClaimCount, 1);
  assert.equal(portfolio.metrics.waitingRealEvidenceCount, 2);
  assert.equal(portfolio.metrics.humanOnlyCount, 1);
  assert.equal(portfolio.metrics.externalOnlyCount, 1);
  assert.equal(portfolio.metrics.duplicateCount, 1);
  assert.equal(portfolio.metrics.conflictCount, 1);
  assert.deepEqual(portfolio.conflictEdges, [{
    packageId: "incident",
    conflictingPackageId: "deep",
    touchedFiles: ["shared.ts"],
    active: false,
  }]);
  assert.equal(portfolio.parked.find((item) => item.packageId === "unknown")?.disposition, "WAITING_REAL_EVIDENCE");
  assert.equal(portfolio.parked.find((item) => item.packageId === "unknown-metadata")?.disposition, "WAITING_REAL_EVIDENCE");
  assert.equal(portfolio.parked.find((item) => item.packageId === "duplicate")?.disposition, "DUPLICATE");
  assert.deepEqual(portfolio.dependencyEdges, [{ packageId: "verified-dependency", dependencyId: "merged-base" }]);

  const sameOpportunity = buildEngineeringWorkPortfolio([
    workPackage("canonical", { opportunityId: "same-opportunity" }),
    workPackage("same-opportunity-duplicate", { opportunityId: "same-opportunity", duplicateOf: "canonical" }),
  ]);
  assert.equal(sameOpportunity.metrics.duplicateCount, 1);

  const activeConflict = buildEngineeringWorkPortfolio([workPackage("active-conflict", { touchedFiles: ["active.ts"] })], {
    activeTouchedFiles: ["active.ts"],
  });
  assert.deepEqual(activeConflict.conflictEdges, [{
    packageId: "active-conflict",
    conflictingPackageId: null,
    touchedFiles: ["active.ts"],
    active: true,
  }]);
});

test("fails closed on portfolio identity, dependency cycle, and canonical path violations", () => {
  assert.throws(
    () => buildEngineeringWorkPortfolio([workPackage("same"), workPackage("same", { opportunityId: "other" })]),
    /ENGINEERING_WORK_PACKAGE_ID_DUPLICATE/,
  );
  assert.throws(
    () => buildEngineeringWorkPortfolio([workPackage("a", { dependencies: ["b"] }), workPackage("b", { dependencies: ["a"] })]),
    /ENGINEERING_WORK_DEPENDENCY_CYCLE/,
  );
  assert.throws(
    () => buildEngineeringWorkPortfolio([workPackage("unsafe", { touchedFiles: ["..\\secret"] })]),
    /ENGINEERING_WORK_TOUCHED_FILE_INVALID/,
  );
});
