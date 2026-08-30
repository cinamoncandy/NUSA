"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectEvolutionDrift } = require("../dist/apps/cloud/src/evolutionDriftDetection.js");

const observation = (overrides = {}) => ({
  candidateId: "cand-1",
  strategyFamilyId: "fam-1",
  regime: "RISK_ON",
  observedAt: "2026-08-30T02:00:00.000Z",
  evidenceStatus: "VERIFIED",
  source: "PAPER",
  dataDrift: 0.05,
  calibrationDrift: 0.04,
  strategyDecay: 0.03,
  costSlippageDegradation: 0.02,
  turnoverInstability: 0.01,
  evidenceAgeMs: 3_600_000,
  ...overrides,
});

const input = (overrides = {}) => ({
  evaluatedAt: "2026-08-30T03:00:00.000Z",
  maximumEvidenceAgeMs: 86_400_000,
  watchThreshold: 0.1,
  materialThreshold: 0.2,
  criticalThreshold: 0.4,
  observation: observation(),
  ...overrides,
});

test("keeps eligibility unchanged when verified drift is immaterial", () => {
  const result = detectEvolutionDrift(input());
  assert.equal(result.severity, "NONE");
  assert.equal(result.action, "NO_CHANGE");
  assert.equal(result.maximumObservedDrift, 0.05);
  assert.equal(result.confidenceIncreaseAllowed, false);
  assert.equal(result.lifecycleMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("watches early degradation without increasing confidence", () => {
  const result = detectEvolutionDrift(input({ observation: observation({ calibrationDrift: 0.12 }) }));
  assert.equal(result.severity, "WATCH");
  assert.equal(result.action, "COLLECT_MORE_EVIDENCE");
});

test("reduces eligibility for material calibration, strategy or cost degradation", () => {
  const result = detectEvolutionDrift(input({ observation: observation({ calibrationDrift: 0.25, costSlippageDegradation: 0.22 }) }));
  assert.equal(result.severity, "MATERIAL");
  assert.equal(result.action, "REDUCE_ELIGIBILITY");
  assert.ok(result.reasons.includes("CALIBRATION_DRIFT"));
  assert.ok(result.reasons.includes("COST_SLIPPAGE_DEGRADATION"));
});

test("suspends eligibility for critical drift", () => {
  const result = detectEvolutionDrift(input({ observation: observation({ dataDrift: 0.45 }) }));
  assert.equal(result.severity, "CRITICAL");
  assert.equal(result.action, "SUSPEND_ELIGIBILITY");
  assert.ok(result.reasons.includes("DATA_DRIFT"));
});

test("stale, future or unverified evidence fails closed", () => {
  const stale = detectEvolutionDrift(input({ observation: observation({ evidenceAgeMs: 100_000_000 }) }));
  assert.equal(stale.severity, "CRITICAL");
  assert.equal(stale.action, "SUSPEND_ELIGIBILITY");
  assert.equal(stale.maximumObservedDrift, null);

  const future = detectEvolutionDrift(input({ observation: observation({ observedAt: "2026-08-30T04:00:00.000Z" }) }));
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));
  assert.equal(future.action, "SUSPEND_ELIGIBILITY");

  const unknown = detectEvolutionDrift(input({ observation: observation({ evidenceStatus: "UNKNOWN" }) }));
  assert.ok(unknown.reasons.includes("EVIDENCE_UNKNOWN"));
});

test("rejects non-PAPER evidence and invalid threshold ordering", () => {
  assert.throws(() => detectEvolutionDrift(input({ observation: observation({ source: "LIVE" }) })), /only PAPER/);
  assert.throws(() => detectEvolutionDrift(input({ materialThreshold: 0.05 })), /thresholds must be monotonic/);
});
