const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperValidationEvidence } = require("../dist/apps/cloud/src/paperValidationEvidence.js");

const DAY = 86_400_000;
const thresholds = {
  minimumCalendarDays: 30,
  minimumObservedDays: 30,
  minimumAvailabilityRatio: 0.99,
  maximumFailureRatio: 0.01,
  maximumCriticalIncidents: 0,
  maximumSnapshotFailureRatio: 0.01
};

const makeDay = (index, overrides = {}) => ({
  date: `2026-07-${String(index + 1).padStart(2, "0")}`,
  startedAt: index * DAY,
  completedAt: (index + 1) * DAY - 1,
  plannedRuntimeMs: DAY - 1,
  actualRuntimeMs: DAY - 1,
  successfulRuns: 100,
  blockedRuns: 0,
  failedRuns: 0,
  incidents: 0,
  criticalIncidents: 0,
  snapshotFailures: 0,
  integrityChecksPassed: true,
  ...overrides
});

test("passes only when duration and quality thresholds are met", () => {
  const days = Array.from({ length: 30 }, (_, index) => makeDay(index));
  const report = buildPaperValidationEvidence(days, 30 * DAY, thresholds);
  assert.equal(report.status, "PASS");
  assert.equal(report.calendarDays, 30);
  assert.equal(report.observedDays, 30);
  assert.equal(report.qualifyingDays, 30);
  assert.equal(report.releaseReadinessPaperValidationDays, 30);
  assert.ok(Object.isFrozen(report));
});

test("fails closed on short or poor-quality evidence", () => {
  const short = Array.from({ length: 29 }, (_, index) => makeDay(index));
  assert.equal(buildPaperValidationEvidence(short, 29 * DAY, thresholds).status, "FAIL");

  const failed = Array.from({ length: 30 }, (_, index) => makeDay(index, index === 10 ? { failedRuns: 10, successfulRuns: 90 } : {}));
  const report = buildPaperValidationEvidence(failed, 30 * DAY, thresholds);
  assert.equal(report.status, "FAIL");
  assert.equal(report.releaseReadinessPaperValidationDays, 0);
});

test("critical incident or integrity failure blocks qualification", () => {
  const critical = Array.from({ length: 30 }, (_, index) => makeDay(index, index === 5 ? { incidents: 1, criticalIncidents: 1 } : {}));
  assert.equal(buildPaperValidationEvidence(critical, 30 * DAY, thresholds).status, "FAIL");

  const integrity = Array.from({ length: 30 }, (_, index) => makeDay(index, index === 2 ? { integrityChecksPassed: false } : {}));
  assert.equal(buildPaperValidationEvidence(integrity, 30 * DAY, thresholds).status, "FAIL");
});

test("rejects duplicate dates and future evidence", () => {
  const duplicate = [makeDay(0), makeDay(0, { startedAt: DAY, completedAt: 2 * DAY - 1 })];
  assert.throws(() => buildPaperValidationEvidence(duplicate, 3 * DAY, thresholds), /dates must be unique/);
  assert.throws(() => buildPaperValidationEvidence([makeDay(0)], DAY - 2, thresholds), /future/);
});
