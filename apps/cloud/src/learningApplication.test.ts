import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ApplicationRegistry,
  applyBoundedChange as applyFromPorts,
  assertLearningApplicationReceipt,
  applicationFingerprint,
  learningApplicationIntentFingerprint,
  type ApplicationContext,
  type ApplicationPorts,
  type LearningApplicationJournal,
  type MetaOosEligibility,
} from "./learningApplication";
import { buildLearningDecision, learningDecisionFingerprint, type LearningChangeRequest } from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { LearningApplicationLedger } from "./learningApplicationLedger";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";

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

/** The production A3 owner is not wired, so the tests exercise an explicit fail-closed seam. */
const NOT_YET_ELIGIBLE: Omit<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint"> = Object.freeze({ eligible: false, partition: "meta-holdout", cyclesEvaluated: 0, reason: "meta-OOS partition has no completed cycle" });
const ELIGIBLE: Omit<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint"> = Object.freeze({ eligible: true, partition: "meta-holdout", cyclesEvaluated: 4, reason: "meta-holdout partition has completed cycles" });

function decisionWith(proposed: readonly LearningChangeRequest[], _currentValue: number) {
  return buildLearningDecision({
    inputSet: buildLearningInputSet({
      cutoffTimestamp: 900,
      researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
      paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
      policies: POLICIES,
    }),
    previousResearchSpecFingerprint: SPEC_A,
    objectiveVersion: "objective-v1",
    proposedChanges: proposed,
    reasonEvidence: ["trial-a"],
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
    readCurrentResearchSpec: () => ({ fingerprint: SPEC_A, values: { longBarTickEvery: current.value } }),
    commit: (_surface, value) => {
      tracker.commits += 1;
      if (failing && value !== 1) throw new Error("steering surface rejected the write");
      current.value = value;
    },
    failSafeValue: () => 1,
  };
}

/** Unit-test adapter stands in for the canonical A3 durable owner port. */
function memoryJournal(): LearningApplicationLedger {
  const records: Array<Record<string, unknown>> = [];
  return new LearningApplicationLedger({
    append: (record: Record<string, unknown>) => { records.push(record); return record; },
    list: () => records as never,
  } as never, () => Date.parse(CONTEXT.applicationTimestamp));
}

function applyBoundedChange(decision: ReturnType<typeof decisionWith>, eligibility: Omit<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint">, applicationPorts: ApplicationPorts, context: ApplicationContext, registry: ApplicationRegistry, journal: LearningApplicationJournal = memoryJournal()) {
  return applyFromPorts(decision, {
    ...applicationPorts,
    resolveMetaOosEligibility: (currentDecision, fingerprint) => ({
      ...eligibility,
      learningCycleId: currentDecision.learningCycleId,
      learningDecisionFingerprint: fingerprint,
    }),
  }, context, journal, registry);
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

  it("does not accept a caller-provided eligibility object; absent canonical owner stays ineligible", () => {
    const state = { value: 1 };
    const port = ports(state);
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    const receipt = applyFromPorts(decision, port, CONTEXT, memoryJournal(), new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.match(receipt.rejectionReason ?? "", /owner is not wired/);
    assert.equal(port.commits, 0);
  });

  it("does not mutate research policy even for a perfectly admissible decision", () => {
    const state = { value: 1 };
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    assert.equal(decision.decisionOutcome, "ADMISSIBLE", "the decision itself is admissible, not applied");
    const receipt = applyBoundedChange(decision, NOT_YET_ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(state.value, 1);
  });

  it("refuses a forged or mismatched META proof returned by a noncanonical port", () => {
    const state = { value: 1 };
    const base = ports(state);
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    const receipt = applyFromPorts(decision, {
      ...base,
      resolveMetaOosEligibility: (_decision, _fingerprint) => ({
        ...ELIGIBLE,
        learningCycleId: decision.learningCycleId,
        learningDecisionFingerprint: "f".repeat(64),
      }),
    }, CONTEXT, memoryJournal(), new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.equal(base.commits, 0);
  });

  it("a rejected eligibility attempt does not prevent a later durable eligibility retry", () => {
    const state = { value: 1 };
    const registry = new ApplicationRegistry();
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    const refused = applyBoundedChange(decision, NOT_YET_ELIGIBLE, ports(state), CONTEXT, registry);
    const accepted = applyBoundedChange(decision, ELIGIBLE, ports(state), CONTEXT, registry);
    assert.equal(refused.applicationOutcome, "REJECTED");
    assert.equal(accepted.applicationOutcome, "APPLIED");
    assert.equal(state.value, 2);
  });

  it("rechecks the full current research spec fingerprint even when the allowlisted value is unchanged", () => {
    const state = { value: 1 };
    const base = ports(state);
    const port: ApplicationPorts = { ...base, readCurrentResearchSpec: () => ({ fingerprint: "e".repeat(64), values: { longBarTickEvery: 1 } }) };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, port, CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "REJECTED");
    assert.match(receipt.rejectionReason ?? "", /current research spec/);
    assert.equal(base.commits, 0);
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

    const first = applyBoundedChange(decision, ELIGIBLE, ports(state), CONTEXT, new ApplicationRegistry(), ledger);
    assert.equal(ledger.summary().applicationsRecorded, 1);

    // Simulate a restart: empty memory, same durable history.
    const afterRestart = new ApplicationRegistry();
    assert.equal(ledger.hydrate(afterRestart), 1, "the receipt is rehydrated from durable history");
    const replay = applyBoundedChange(decision, ELIGIBLE, ports({ value: 1 }), CONTEXT, afterRestart, ledger);
    assert.equal(replay.applicationFingerprint, first.applicationFingerprint, "same receipt, no new side effect");
    assert.equal(ledger.forDecision(first.learningDecisionFingerprint).length, 1, "no duplicate record");
  });

  it("writes an intent to the durable learning ledger before invoking the mutation port", () => {
    const state = { value: 1 };
    const records: Array<Record<string, unknown>> = [];
    const ledger = new LearningApplicationLedger({
      append: (record: Record<string, unknown>) => { records.push(record); return record; },
      list: () => records as never,
    } as never, () => Date.parse(CONTEXT.applicationTimestamp));
    const base = ports(state);
    const port: ApplicationPorts = {
      ...base,
      resolveMetaOosEligibility: (decision, fingerprint) => ({ ...ELIGIBLE, learningCycleId: decision.learningCycleId, learningDecisionFingerprint: fingerprint }),
      commit: (surface, value) => {
        assert.equal(records.some((record) => record.validationStatus === "LEARNING_APPLICATION_INTENT"), true, "WAL intent precedes mutation");
        base.commit(surface, value);
      },
    };
    const result = applyFromPorts(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), port, CONTEXT, ledger, new ApplicationRegistry());
    assert.equal(result.applicationOutcome, "APPLIED");
    assert.deepEqual(records.map((record) => record.validationStatus), ["LEARNING_APPLICATION_INTENT", "LEARNING_APPLICATION"]);
  });

  it("reconciles an applied write-ahead intent after restart without issuing a second mutation", () => {
    const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
    const decisionFingerprint = learningDecisionFingerprint(decision);
    const intentFields = {
      learningDecisionFingerprint: decisionFingerprint,
      learningCycleId: decision.learningCycleId,
      previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
      surface: "longBarTickEvery",
      previousValue: 1,
      requestedValue: 2,
      boundedValue: 2,
      applicationTimestamp: CONTEXT.applicationTimestamp,
      runtimeIdentity: CONTEXT.runtimeIdentity,
      sourceCommit: CONTEXT.sourceCommit,
    };
    const intent = {
      ...intentFields,
      schemaVersion: 1 as const,
      intentFingerprint: learningApplicationIntentFingerprint(intentFields),
    };
    const records: Array<Record<string, unknown>> = [];
    const ledger = new LearningApplicationLedger({
      append: (record: Record<string, unknown>) => { records.push(record); return record; },
      list: () => records as never,
    } as never, () => Date.parse(CONTEXT.applicationTimestamp));
    ledger.appendIntent(intent);
    const state = { value: 2 };
    const base = ports(state);
    let commits = 0;
    const port: ApplicationPorts = {
      ...base,
      commit: () => { commits += 1; },
      reconcileIntent: (pending) => pending.intentFingerprint === intent.intentFingerprint ? "APPLIED" : "UNKNOWN",
    };
    const receipt = applyFromPorts(decision, port, CONTEXT, ledger, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "APPLIED");
    assert.equal(receipt.intentFingerprint, intent.intentFingerprint);
    assert.equal(commits, 0, "recovery records the verified prior application without repeating it");
    assert.equal(ledger.pendingIntentFor(decisionFingerprint, "longBarTickEvery"), undefined);
  });

  it("rehydrates a pending write-ahead intent from the real SQLite hash-chain after process restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "nusa-a4-intent-"));
    const databasePath = join(directory, "learning.sqlite");
    let database = new SqliteDatabase(databasePath);
    try {
      const decision = decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1);
      const decisionFingerprint = learningDecisionFingerprint(decision);
      const intentFields = {
        learningDecisionFingerprint: decisionFingerprint,
        learningCycleId: decision.learningCycleId,
        previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
        surface: "longBarTickEvery",
        previousValue: 1,
        requestedValue: 2,
        boundedValue: 2,
        applicationTimestamp: CONTEXT.applicationTimestamp,
        runtimeIdentity: CONTEXT.runtimeIdentity,
        sourceCommit: CONTEXT.sourceCommit,
      };
      const intent = { ...intentFields, schemaVersion: 1 as const, intentFingerprint: learningApplicationIntentFingerprint(intentFields) };
      const first = new LearningApplicationLedger(new SqliteEvolutionLearningLedger(database), () => Date.parse(CONTEXT.applicationTimestamp));
      first.appendIntent(intent);
      database.close();
      database = new SqliteDatabase(databasePath);
      const restarted = new LearningApplicationLedger(new SqliteEvolutionLearningLedger(database), () => Date.parse(CONTEXT.applicationTimestamp));
      assert.equal(restarted.pendingIntentFor(decisionFingerprint, "longBarTickEvery")?.intentFingerprint, intent.intentFingerprint);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
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
    assert.match(receipt.rejectionReason ?? "", /current research spec failed validation/);
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

  it("writes and reads back the fail-safe after a setter mutates then throws", () => {
    const state = { value: 1 };
    let commits = 0;
    const port: ApplicationPorts = {
      readCurrent: () => state.value,
      readCurrentResearchSpec: () => ({ fingerprint: SPEC_A, values: { longBarTickEvery: state.value === 2 ? 1 : state.value } }),
      resolveMetaOosEligibility: (decision, fingerprint) => ({ ...ELIGIBLE, learningCycleId: decision.learningCycleId, learningDecisionFingerprint: fingerprint }),
      commit: (_surface, value) => {
        commits += 1;
        state.value = value;
        if (value === 2) throw new Error("write applied but acknowledgment lost");
      },
      failSafeValue: () => 1,
    };
    const receipt = applyBoundedChange(decisionWith([{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }], 1), ELIGIBLE, port, CONTEXT, new ApplicationRegistry());
    assert.equal(receipt.applicationOutcome, "FAILED");
    assert.equal(state.value, 1);
    assert.equal(receipt.appliedValue, 1);
    assert.equal(commits, 2, "the fail-safe was committed after the partial write");
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
      previousResearchSpecFingerprint: SPEC_A,
      intentFingerprint: "d".repeat(64),
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

  it("binds provenance fields into the receipt fingerprint", () => {
    const fields = {
      learningDecisionFingerprint: "c".repeat(64),
      learningCycleId: "learning-cycle:" + "c".repeat(64),
      previousResearchSpecFingerprint: SPEC_A,
      intentFingerprint: "d".repeat(64),
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
    const receipt = { ...fields, schemaVersion: 1 as const, outcomeVersion: "learning-application-outcome-v1" as const, applicationFingerprint: applicationFingerprint(fields) };
    assert.throws(() => assertLearningApplicationReceipt({ ...receipt, runtimeIdentity: "runtime-other" }), /does not match its own fingerprint/);
    assert.throws(() => assertLearningApplicationReceipt({ ...receipt, sourceCommit: undefined }), /bounded identifier/);
  });
});
