import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEARNING_STATUS_FIELDS,
  LEARNING_STATUS_IDENTIFIERS,
  LEARNING_STATUS_VERSION,
  buildLearningLoopStatus,
  type LearningStatusSource,
} from "./learningLoopStatus";

const FULL: LearningStatusSource = Object.freeze({
  inputSet: Object.freeze({ fingerprint: "a".repeat(64), learningCycleId: "learning-cycle:" + "a".repeat(64) }),
  decision: Object.freeze({ fingerprint: "b".repeat(64) }),
  application: Object.freeze({ fingerprint: "c".repeat(64), applicationOutcome: "REJECTED" as const }),
  meta: Object.freeze({ eligible: false, partition: "train+validation+holdout", cyclesEvaluated: 2, reason: "meta-OOS has train 1/3, validation 1/3, holdout 0/3 completed cycle(s); all three partitions are required at 3 each" }),
  supersession: Object.freeze({ links: 4, lineageLength: 3, forked: false }),
  exploration: Object.freeze({ attempts: 9, allotted: 4, suppressed: 5, exhausted: true, allotmentRemaining: 0 }),
});

describe("M2 - display-only status projection (section 28)", () => {
  it("reports the required identities when they exist", () => {
    const status = buildLearningLoopStatus(FULL);
    assert.equal(status.schemaVersion, LEARNING_STATUS_VERSION);
    assert.equal(status.latestLearningInputSetFingerprint, "a".repeat(64));
    assert.equal(status.latestLearningCycleId, "learning-cycle:" + "a".repeat(64));
    assert.equal(status.latestLearningDecisionFingerprint, "b".repeat(64));
    assert.equal(status.latestApplicationFingerprint, "c".repeat(64));
    assert.equal(status.applicationOutcome, "REJECTED");
    assert.equal(status.metaScope, "train+validation+holdout", "the scope is reported, never a single partition's vote");
    assert.match(status.supersessionStatus ?? "", /links=4/, "supersession count is reported");
    assert.match(status.supersessionStatus ?? "", /lineage=3/);
    assert.match(status.supersessionStatus ?? "", /fork=NONE/);
    assert.match(status.explorationStatus ?? "", /EXHAUSTED/);
    assert.match(status.explorationStatus ?? "", /remaining=0/);
  });

  it("marks each absent source unknown rather than presenting an empty status as healthy", () => {
    const status = buildLearningLoopStatus({});
    assert.deepEqual(Object.keys(status), ["schemaVersion", "projectionScope", "componentAvailability"], "an empty status reports unknown sources, not zeroes");
    assert.equal(status.projectionScope, "UNVERIFIED_DISPLAY_ONLY_NOT_APPROVAL");
    assert.match(status.componentAvailability, /inputSet=UNKNOWN/);
    assert.match(status.componentAvailability, /meta=UNKNOWN/);
    assert.match(status.componentAvailability, /exploration=UNKNOWN/);
    assert.equal(status.latestLearningInputSetFingerprint, undefined);
    assert.equal(status.applicationOutcome, undefined);
    assert.equal(status.metaEligibility, undefined);
    assert.equal(status.supersessionStatus, undefined);
    assert.equal(status.explorationStatus, undefined);
  });

  it("carries only fields from the closed projection set", () => {
    for (const source of [{}, FULL, { inputSet: FULL.inputSet }, { exploration: FULL.exploration }]) {
      const status = buildLearningLoopStatus(source);
      for (const key of Object.keys(status)) assert.ok(LEARNING_STATUS_FIELDS.includes(key), "unexpected projection field " + key);
    }
  });

  it("holds only scalars, matching the shape the enclosing loop status accepts", () => {
    const status = buildLearningLoopStatus(FULL);
    for (const [key, value] of Object.entries(status)) {
      assert.ok(typeof value === "string" || typeof value === "number", key + " is a scalar rather than a nested structure");
    }
  });

  it("is frozen so a reader cannot edit a report into a directive", () => {
    const status = buildLearningLoopStatus(FULL);
    assert.ok(Object.isFrozen(status));
  });

  it("is deterministic for identical sources", () => {
    const first = buildLearningLoopStatus(FULL);
    const second = buildLearningLoopStatus(FULL);
    assert.deepEqual({ ...first }, { ...second }, "the same recorded state reports the same status");
  });

  it("never mutates the sources it reads", () => {
    const before = JSON.stringify(FULL);
    buildLearningLoopStatus(FULL);
    assert.equal(JSON.stringify(FULL), before, "the sources are byte-identical after the projection");
  });

  it("reports eligibility with the reason attached, never as a bare permission", () => {
    const status = buildLearningLoopStatus(FULL);
    assert.match(status.metaEligibility ?? "", /^UNVERIFIED_INPUT; claimed=INELIGIBLE/, "caller input is visibly unverified");
    assert.match(status.metaEligibility ?? "", /required/, "and always with the condition that produced it");
    assert.ok((status.metaEligibility ?? "").includes("-"), "verdict and reason are joined, so a reader cannot see one without the other");
  });
});

describe("M2 - the projection stays an output", () => {
  it("holds identifiers as identifiers, and nothing that looks like an instruction", () => {
    const status = buildLearningLoopStatus(FULL);
    for (const field of LEARNING_STATUS_IDENTIFIERS) {
      const value = (status as Record<string, unknown>)[field];
      assert.equal(typeof value, "string", field + " is an identifier string");
    }
    // No field carries a mutation, a target value, or a command-like payload. Anchored at the start
    // so ordinary report names such as `latestLearningInputSetFingerprint` are not false positives.
    for (const key of Object.keys(status)) {
      assert.ok(!/^(apply|set|mutate|command|directive|approve|update|write|commit)/i.test(key), "projection field " + key + " reads as an instruction");
    }
  });

  it("reports a rejection outcome without ever changing what it describes", () => {
    const rejected = buildLearningLoopStatus({ application: { fingerprint: "c".repeat(64), applicationOutcome: "REJECTED" as const } });
    const applied = buildLearningLoopStatus({ application: { fingerprint: "c".repeat(64), applicationOutcome: "APPLIED" as const } });
    // Both are pure descriptions: differing only in the recorded value proves the projection carries
    // no independent behaviour of its own.
    assert.equal(rejected.applicationOutcome, "REJECTED");
    assert.equal(applied.applicationOutcome, "APPLIED");
    assert.equal(applied.projectionScope, "UNVERIFIED_DISPLAY_ONLY_NOT_APPROVAL");
    assert.notDeepEqual({ ...rejected }, { ...applied });
    assert.equal(Object.keys(rejected).length, Object.keys(applied).length, "same shape, different recorded fact");
  });

  it("does not present caller-claimed eligibility or application as verified when the evidence is absent", () => {
    const status = buildLearningLoopStatus({
      meta: { eligible: true, partition: "meta-train", cyclesEvaluated: 0, reason: "caller supplied claim" },
      application: { fingerprint: "c".repeat(64), applicationOutcome: "APPLIED" },
    });
    assert.match(status.metaEligibility ?? "", /^UNVERIFIED_INPUT; claimed=ELIGIBLE; cycles=0/);
    assert.equal(status.projectionScope, "UNVERIFIED_DISPLAY_ONLY_NOT_APPROVAL");
    assert.match(status.componentAvailability, /inputSet=UNKNOWN/);
    assert.match(status.componentAvailability, /meta=AVAILABLE/);
    assert.doesNotMatch(JSON.stringify(status), /LEARNING_LOOP_VERIFIED|VERIFIED=true/);
  });

  it("withdraws malformed counts and unsafe free text instead of formatting them as facts", () => {
    const status = buildLearningLoopStatus({
      meta: { eligible: true, partition: "meta-train", cyclesEvaluated: Number.NaN, reason: "bad\nreason" },
      supersession: { links: -1, lineageLength: 2, forked: false },
      exploration: { attempts: Number.NaN, allotted: 2, suppressed: 0, exhausted: false, allotmentRemaining: 2 },
    });
    assert.match(status.componentAvailability, /meta=INVALID/);
    assert.match(status.componentAvailability, /supersession=INVALID/);
    assert.match(status.componentAvailability, /exploration=INVALID/);
    assert.equal(status.metaEligibility, undefined);
    assert.equal(status.supersessionStatus, undefined);
    assert.equal(status.explorationStatus, undefined);
    const injected = buildLearningLoopStatus({
      meta: { eligible: true, partition: "meta-train", cyclesEvaluated: 0, reason: "<script>alert(1)</script>" },
    });
    assert.match(injected.componentAvailability, /meta=INVALID/);
    assert.equal(injected.metaEligibility, undefined);
  });

  it("survives an unexpected source shape without throwing", () => {
    assert.doesNotThrow(() => buildLearningLoopStatus(null as unknown as LearningStatusSource));
    assert.equal(buildLearningLoopStatus(null as unknown as LearningStatusSource).schemaVersion, LEARNING_STATUS_VERSION);
    assert.match(buildLearningLoopStatus(null as unknown as LearningStatusSource).componentAvailability, /inputSet=UNKNOWN/);
  });
});
