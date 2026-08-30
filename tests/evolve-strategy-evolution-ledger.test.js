"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { replayStrategyEvolutionLedger } = require("../dist/apps/cloud/src/strategyEvolutionLedger.js");

const entry = (overrides = {}) => ({
  entryId: "entry-1", candidateId: "cand-1", strategyFamilyId: "fam-1", strategyVersion: "v1",
  codeSha: "abc123", datasetProvenance: "paper-window-1", parameterFingerprint: "params-1", parentEntryId: null,
  regime: "RISK_ON", costModelFingerprint: "cost-1", evidenceId: "evidence-1", evidenceStatus: "VERIFIED",
  evaluatedAt: "2026-08-30T02:00:00.000Z", evidenceObservedAt: "2026-08-30T01:00:00.000Z",
  decision: "HOLD", decisionReasons: ["PAPER_EVIDENCE"], source: "PAPER", ...overrides,
});

test("replay reconstructs identical deterministic state regardless input ordering", () => {
  const child = entry({ entryId: "entry-2", strategyVersion: "v2", evidenceId: "evidence-2", parentEntryId: "entry-1", evaluatedAt: "2026-08-30T03:00:00.000Z", decision: "PROMOTE" });
  const a = replayStrategyEvolutionLedger([entry(), child]);
  const b = replayStrategyEvolutionLedger([child, entry()]);
  assert.equal(a.stateFingerprintSha256, b.stateFingerprintSha256);
  assert.deepEqual(a.entryFingerprints, b.entryFingerprints);
  assert.equal(a.liveAuthority, "NONE"); assert.equal(a.productionMutationAllowed, false); assert.equal(a.aiAuthority, "ZERO_AUTHORITY");
});

test("duplicate/replayed evidence fails closed", () => {
  assert.throws(() => replayStrategyEvolutionLedger([entry(), entry({ entryId: "entry-2" })]), /duplicate\/replayed evolution evidence/);
  assert.throws(() => replayStrategyEvolutionLedger([entry(), entry()]), /duplicate\/replayed evolution entry/);
});

test("future-derived and unverified evidence fail closed", () => {
  assert.throws(() => replayStrategyEvolutionLedger([entry({ evidenceObservedAt: "2026-08-30T04:00:00.000Z" })]), /future-derived/);
  assert.throws(() => replayStrategyEvolutionLedger([entry({ evidenceStatus: "UNKNOWN" })]), /VERIFIED/);
});

test("missing or mismatched lineage fails closed", () => {
  assert.throws(() => replayStrategyEvolutionLedger([entry({ entryId: "entry-2", parentEntryId: "missing" })]), /missing or out-of-order parent lineage/);
  const parent = entry();
  const child = entry({ entryId: "entry-2", evidenceId: "evidence-2", parentEntryId: "entry-1", candidateId: "cand-2", evaluatedAt: "2026-08-30T03:00:00.000Z" });
  assert.throws(() => replayStrategyEvolutionLedger([parent, child]), /candidate or family lineage mismatch/);
});

test("decision reason ordering is canonical", () => {
  const a = replayStrategyEvolutionLedger([entry({ decisionReasons: ["B", "A"] })]);
  const b = replayStrategyEvolutionLedger([entry({ decisionReasons: ["A", "B"] })]);
  assert.equal(a.stateFingerprintSha256, b.stateFingerprintSha256);
});
