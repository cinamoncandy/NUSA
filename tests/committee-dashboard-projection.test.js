const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPersistedCommitteeDashboardSection } = require("../dist/apps/desktop/src/cloud/committeeDashboardProjection.js");

const decision = (overrides = {}) => ({ outcome: "WAIT", confidence: 0.7, edge: 0.01, risk: 0.02, reasons: ["paper only"], decidedAt: 1_000, ...overrides });

test("committee ledger is projected only when its source is verified", () => {
  const result = buildPersistedCommitteeDashboardSection({ decision: decision(), integrity: "VALID", generatedAt: 1_500, maximumAgeMs: 1_000 });
  assert.equal(result.status, "HEALTHY");
  assert.equal(result.decision, "WAIT");
  assert.deepEqual(result.reasons, ["COMMITTEE_LEDGER_VERIFIED"]);
});

test("missing or invalid committee source remains unavailable or blocked", () => {
  assert.equal(buildPersistedCommitteeDashboardSection({ decision: null, integrity: "UNAVAILABLE", generatedAt: 1, maximumAgeMs: 1_000 }).availability, "UNAVAILABLE");
  assert.equal(buildPersistedCommitteeDashboardSection({ decision: null, integrity: "INVALID", generatedAt: 1, maximumAgeMs: 1_000 }).availability, "INVALID");
});

test("stale committee decision is visible but never presented as healthy", () => {
  const result = buildPersistedCommitteeDashboardSection({ decision: decision({ decidedAt: 1 }), integrity: "VALID", generatedAt: 2_000, maximumAgeMs: 100 });
  assert.equal(result.status, "CAUTION");
  assert.equal(result.availability, "STALE");
  assert.deepEqual(result.reasons, ["COMMITTEE_DECISION_STALE"]);
});
