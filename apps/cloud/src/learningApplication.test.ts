import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApplicationRegistry,
  applyBoundedChange,
  assertLearningApplicationReceipt,
  applicationFingerprint,
  type ApplicationContext,
  type ApplicationPorts,
  type MetaOosEligibility,
} from "./learningApplication";
import { buildLearningDecision, type LearningChangeRequest } from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { LearningApplicationLedger } from "./learningApplicationLedger";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};

const SPEC_A = "a".repeat(64);

const CONTEXT: ApplicationContext = {
  applicationTimestamp: "2026-10-18T00:00:00.000Z",
  runtimeIdentity: "runtime-test",
  sourceCommit: "273d785df7b14c3a8e541ae45ea71fe3aacb49b4",
};

/** A3 does not exist yet, so this is the only eligibility a caller can honestly produce. */
const NOT_YET_ELIGIBLE: MetaOosEligibility = Object.freeze({ eligible: false, partition: "meta-holdout", cyclesEvaluated: 0, reason: "meta-OOS partition has no completed cycle" });
const ELIGIBLE: MetaOosEligibility = Object.freeze({ eligible: true, partition: "meta-holdout", cyclesEvaluated: 4, reason: "meta-holdout partition has completed cycles" });

function decisionWith(proposed: readonly LearningChangeRequest[], _currentValue: number) {
  return buildLearningDecision({
    inputSet: buildLearningInputSet({
      cutoffTimestamp: 900,
      researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
      paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
      policies: POLICIES,
      metaPartitionIdentity: "meta-train",
    }),
    previousResearchSpecFingerprint: SPEC_A,
    objectiveVersion: "objective-v1",
    proposedChanges: proposed,
    reasonEvidence: ["trial-a"],
    metaOosPartition: "meta-holdout",
    metaCyclesEvaluated: 4,
    createdAt: "2026-10-18T00:00:00.000Z",
    sourceCommit: CONTEXT.sourceCommit,
    runtimeIdentity: "runtime-test",
  });
}

/** A stand-in for the real steering surface: `longBarTickEvery`, defaulted to the fail-safe 1. */
function ports(current: { value: number }, failing = false): ApplicationPorts & { commits: number } {
  const tracker = { commits: 0 };
  return {
    get commits() {
      return tracker.commits;
    },
    readCurrent: () => current.value,
    commit: (_surface, value) => {
      tracker.commits += 1;
      if (failing) throw new Error("steering surface rejected the write");
      current.value = value;
    },
    failSafeValue: () => 1,
  };
}

describe("A4 - the meta-OOS eligibility gate is fail-closed (section 17)", () => {
  it("refuses to apply anything until meta-OOS eligibility exists", () => {
    const state = { value: 1 };
    const port = ports(state);
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);

    const receipt = applyBoundedChange(decision, NOT_YET_ELIGIBLE, port, CONTEXT, new ApplicationRegistry());

    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.match(receipt.rejectionReason ?? "", /meta-OOS eligibility not established/);
    assert.equal(state.value, 1, "the runtime value is untouched");
    assert.equal(port.commits, 0, "the setter was never reached");
    assert.equal(receipt.appliedValue, 1, "nothing is claimed as applied");
  });

  it("does not mutate research policy even for a perfectly admissible decision", () => {
    const state = { value: 1 };
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    assert.equal(decision.decisionOutcome, "APPLIED", "the decision itself is admissible");
    const receipt = applyBoundedChange(decision, NOT_YET_ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1);
  });
});

describe("A4 - bounded application", () => {
  it("applies an admitted change exactly once and reports what was applied", () => {
    const state = { value: 1 };
    const registry = new ApplicationRegistry();
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);

    const receipt = applyBoundedChange(decision, ELIGIBLE, ports(state), CONTEXT, registry);

    assert.equal(receipt.applicationOutcome, "APPLIED");
    assert.equal(receipt.previousValue, 1);
    assert.equal(receipt.requestedValue, 2);
    assert.equal(receipt.boundedValue, 2);
    assert.equal(receipt.appliedValue, 2);
    assert.equal(receipt.surface, "longBarTickEvery");
    assert.equal(state.value, 2, "the runtime surface actually moved");
    assert.equal(registry.size(), 1);
  });

  it("refuses a second application of the same decision and surface", () => {
    const state = { value: 1 };
    const registry = new ApplicationRegistry();
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    const port = ports(state);

    const first = applyBoundedChange(decision, ELIGIBLE, port, CONTEXT, registry);
    const commitsAfterFirst = port.commits;
    const second = applyBoundedChange(decision, ELIGIBLE, port, CONTEXT, registry);

    assert.equal(second.applicationFingerprint, first.applicationFingerprint, "the replay returns the identical receipt");
    assert.equal(state.value, 2, "no second side effect");
    assert.equal(port.commits, commitsAfterFirst, "the setter was not reached again");
  });

  it("replay across a fresh registry is stopped by the durable ledger, not by memory", () => {
    const state = { value: 1 };
    const ledgerRecords: Array<Record<string, unknown>> = [];
    const ledger = new LearningApplicationLedger(
      {
        append: (record: Record<string, unknown>) => {
          ledgerRecords.push(record);
          return record;
        },
        list: () => ledgerRecords as never,
      } as never,
      () => Date.parse(CONTEXT.applicationTimestamp),
    );
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);

    const first = applyBoundedChange(decision, ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    ledger.append(first);
    assert.equal(ledger.summary().applicationsRecorded, 1);

    // Simulate a restart: empty memory, same durable history.
    const afterRestart = new ApplicationRegistry();
    assert.equal(ledger.hydrate(afterRestart), 1, "the receipt is rehydrated from durable history");
    const replay = applyBoundedChange(decision, ELIGIBLE, ports({ value: 1 }), CONTEXT, afterRestart);
    assert.equal(replay.applicationFingerprint, first.applicationFingerprint, "same receipt, no new side effect");
    assert.equal(ledger.forDecision(first.learningDecisionFingerprint).length, 1, "no duplicate record");
  });

  it("treats a decision whose premise is false as stale, not as a harmless no-op", () => {
    // The runtime is already at 2, which happens to equal the decision's target. Returning NOOP here
    // would imply the decision was correctly targeted, when in fact its premise (`currentValue = 1`)
    // was overtaken by something else. The stale refusal is the honest answer, and it also stops the
    // same identity from being silently re-derived against a state it was never reviewed against.
    // With A1 refusing no-change proposals, a decision whose premise and target both match the
    // runtime cannot be admissible at all, so NOOP stays defensive rather than reachable.
    const state = { value: 2 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.match(receipt.rejectionReason ?? "", /stale previous value/);
    assert.equal(state.value, 2, "unchanged");
  });
});

describe("A4 falsification (section 18)", () => {
  it("refuses a stale decision instead of rebasing it onto the new value", () => {
    const state = { value: 3 };
    const port = ports(state);
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, port, CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 3, "the runtime was not moved to a value the decision never reviewed");
    assert.equal(port.commits, 0, "the setter was never reached");
    assert.equal(receipt.appliedValue, 3, "the receipt reports the true current value");
  });

  it("refuses an invented surface", () => {
    const state = { value: 1 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "someKnobLearningInvented", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1);
  });

  it("refuses an immutable surface again, independently of A1 (defense in depth)", () => {
    const state = { value: 1 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "liveAuthority", currentValue: 0, proposedValue: 1 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1, "no live authority was granted");
  });

  it("refuses an out-of-range value", () => {
    const state = { value: 4 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 4, proposedValue: 9 }], 4), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 4);
  });

  it("refuses a step larger than the per-cycle delta", () => {
    const state = { value: 1 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 4 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1);
  });

  it("refuses a decision that never admitted a change", () => {
    const state = { value: 1 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 9 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1);
  });

  it("reports FAILED and the fail-safe value when the setter throws, never as a success", () => {
    const state = { value: 1 };
    const port = ports(state, true);
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, port, CONTEXT, new ApplicationRegistry());

    assert.equal(receipt.applicationOutcome, "FAILED");
    assert.equal(receipt.requestedValue, 2, "requested is recorded separately");
    assert.equal(receipt.boundedValue, 2, "bounded is recorded separately");
    assert.equal(receipt.appliedValue, 1, "the fail-safe value is what actually applied");
    assert.match(receipt.fallbackReason ?? "", /rejected the write/);
    assert.equal(state.value, 1, "the preserved fail-safe reset holds");
  });

  it("receipts are self-verifying and a tampered one is rejected", () => {
    const state = { value: 1 };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.doesNotThrow(() => assertLearningApplicationReceipt(receipt));

    const tampered = { ...(JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>) };
    tampered.appliedValue = 4;
    assert.throws(() => assertLearningApplicationReceipt(tampered), /does not match its own fingerprint/);
  });

  it("the same content always yields the same application identity", () => {
    const fields = {
      learningDecisionFingerprint: "c".repeat(64),
      learningCycleId: "learning-cycle:" + "c".repeat(64),
      surface: "longBarTickEvery",
      previousValue: 1,
      requestedValue: 2,
      boundedValue: 2,
      appliedValue: 2,
      applicationOutcome: "APPLIED" as const,
      applicationTimestamp: CONTEXT.applicationTimestamp,
      runtimeIdentity: CONTEXT.runtimeIdentity,
      sourceCommit: CONTEXT.sourceCommit,
    };
    assert.equal(applicationFingerprint(fields), applicationFingerprint({ ...fields }));
    assert.notEqual(applicationFingerprint(fields), applicationFingerprint({ ...fields, appliedValue: 3 }));
  });
});
