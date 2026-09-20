"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { prepareProductionExecution } = require("../dist/apps/autopilot/src/productionExecutionSpine.js");

/**
 * The spine accepts a mixed-case head SHA -- both SHA40 patterns on this path are /i -- and then
 * uses it to mint the dedupe key that suppresses a second execution for the same commit.
 * dispatchPlanner comments that it deliberately does not create "duplicate execution edges for the
 * same head SHA", which is exactly what an unnormalised key fails to deliver.
 */

const SHA = "a".repeat(39) + "f";
const REPOSITORY = "cinamoncandy/NUSA";

const plan = (headSha) => ({
  kind: "CI_SUCCEEDED",
  repository: REPOSITORY,
  headSha,
  prNumber: null,
  workflowRunId: 9001,
  workflowRunAttempt: 1,
  reason: "ci",
  mutationAllowed: false,
});

const options = (deliveryId) => ({
  deliveryId,
  origin: "AUTO_BACKGROUND",
  now: 1_787_000_000_000,
  allowedRepository: REPOSITORY,
});

test("the same commit yields one dedupe identity regardless of SHA case", () => {
  const lower = prepareProductionExecution(plan(SHA), options("delivery-1"));
  const upper = prepareProductionExecution(plan(SHA.toUpperCase()), options("delivery-2"));
  assert.ok(lower && upper);
  assert.equal(lower.state.dedupeKey, upper.state.dedupeKey, "a second execution for the same commit must be suppressible");
  assert.equal(lower.state.workItemId, upper.state.workItemId);
  assert.equal(lower.state.dedupeKey, `ci:9001:${SHA}`);
});

test("the evidence the envelope carries is the same normalised commit", () => {
  // If identity normalised but evidence did not, the audit trail would point at a SHA string the
  // dedupe key never used.
  const upper = prepareProductionExecution(plan(SHA.toUpperCase()), options("delivery-1"));
  assert.equal(upper.envelope.baseSha, SHA);
  assert.ok(upper.envelope.evidenceRefs.includes(`github:commit:${SHA}`));
  assert.equal(upper.request.headSha, SHA);
});

test("distinct commits still get distinct identities", () => {
  // Normalising must not collapse anything that genuinely differs.
  const other = "b".repeat(39) + "e";
  const first = prepareProductionExecution(plan(SHA), options("delivery-1"));
  const second = prepareProductionExecution(plan(other), options("delivery-1"));
  assert.notEqual(first.state.dedupeKey, second.state.dedupeKey);
  assert.notEqual(first.state.workItemId, second.state.workItemId);
});

test("a different delivery for the same commit keeps its own execution identity", () => {
  // dedupeKey suppresses the duplicate; executionId still identifies which delivery did the work.
  const first = prepareProductionExecution(plan(SHA), options("delivery-1"));
  const second = prepareProductionExecution(plan(SHA.toUpperCase()), options("delivery-2"));
  assert.equal(first.state.dedupeKey, second.state.dedupeKey);
  assert.notEqual(first.state.executionId, second.state.executionId);
});

test("an invalid head SHA is still refused rather than normalised into something valid", () => {
  for (const bad of ["", "abc", "z".repeat(40), `${SHA} `]) {
    assert.throws(() => prepareProductionExecution(plan(bad), options("delivery-1")), /PRODUCTION_EXECUTION_HEAD_SHA_INVALID/, JSON.stringify(bad));
  }
});
