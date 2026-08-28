import assert from "node:assert/strict";
import test from "node:test";
import { validateOperationalProgressSnapshot } from "./operationalProgress";

const NOW = 1_800_000_000_000;
const valid = () => ({
  schemaVersion: 1 as const,
  scope: "OPERATIONAL_EVIDENCE_ONLY" as const,
  authority: "READ_ONLY" as const,
  headSha: "a".repeat(40),
  asOf: NOW - 1_000,
  level: 1,
  overallProgressRatio: 0.5,
  domains: [{ domain: "INFRASTRUCTURE_MODULE_HEALTH", completionRatio: 1 }],
  achievedCriteria: ["exact-head-repository-ci"],
  blockedCriteria: ["actual-paper-runtime"],
  reasons: ["runtime evidence required"],
  blockers: ["actual-paper-runtime:runtime evidence required"]
});

test("accepts a fresh read-only operational projection", () => {
  const snapshot = validateOperationalProgressSnapshot(valid(), NOW);
  assert.equal(snapshot.authority, "READ_ONLY");
  assert.equal(snapshot.scope, "OPERATIONAL_EVIDENCE_ONLY");
  assert.equal(snapshot.overallProgressRatio, 0.5);
});

test("rejects authority escalation and wrong scope", () => {
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), authority: "LIVE" }, NOW));
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), scope: "WHOLE_NUSA_EVIDENCE_BASELINE" }, NOW));
});

test("rejects stale, future, malformed sha, and invalid ratios", () => {
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), asOf: NOW - 16 * 60_000 }, NOW));
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), asOf: NOW + 61_000 }, NOW));
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), headSha: "stale" }, NOW));
  assert.throws(() => validateOperationalProgressSnapshot({ ...valid(), overallProgressRatio: 1.01 }, NOW));
});
