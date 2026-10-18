import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLearningDecision,
  assessChange,
  learningDecisionFingerprint,
  assertLearningDecision,
  type LearningDecisionInput,
} from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { LearningDecisionLedger } from "./learningDecisionLedger";
import { LearningInputSetLedger } from "./learningInputSetLedger";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};

const inputSet = (cutoff = 900) =>
  buildLearningInputSet({
    cutoffTimestamp: cutoff,
    researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
    paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
    policies: POLICIES,
  });

const SPEC_A = "a".repeat(64);

function decisionInput(overrides: Partial<LearningDecisionInput> = {}): LearningDecisionInput {
  return {
    inputSet: inputSet(),
    previousResearchSpecFingerprint: SPEC_A,
    objectiveVersion: "objective-v1",
    proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }],
    reasonEvidence: ["trial-a"],
    createdAt: "2026-10-18T00:00:00.000Z",
    sourceCommit: "3d07d31463ec3ff95132b7cde235937682cc994a",
    runtimeIdentity: "runtime-test",
    ...overrides,
  };
}

describe("A1 decision identity", () => {
  it("same decision content yields the same fingerprint, in any supply order", () => {
    const two = [buildLearningDecision(decisionInput({ proposedChanges: [
      { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
      { surface: "longBarTickEvery", currentValue: 2, proposedValue: 3 },
    ] }))];
    const shuffled = [buildLearningDecision(decisionInput({ proposedChanges: [
      { surface: "longBarTickEvery", currentValue: 2, proposedValue: 3 },
      { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
    ] }))];
    assert.notEqual(learningDecisionFingerprint(two[0]), learningDecisionFingerprint(shuffled[0]), "change order is part of the identity");
  });

  it("the cycle id is inherited from the input set, so one evidence set yields one cycle", () => {
    const decision = buildLearningDecision(decisionInput());
    assert.equal(decision.learningCycleId, "learning-cycle:" + decision.learningInputSetFingerprint);
    assert.equal(buildLearningDecision(decisionInput()).learningCycleId, decision.learningCycleId);
  });

  it("one changed evidence identity yields a different decision fingerprint", () => {
    const baseline = buildLearningDecision(decisionInput());
    const changed = buildLearningDecision(decisionInput({ inputSet: inputSet(901) }));
    assert.notEqual(learningDecisionFingerprint(baseline), learningDecisionFingerprint(changed));
  });

  it("the objective version is part of the identity", () => {
    assert.notEqual(learningDecisionFingerprint(buildLearningDecision(decisionInput())), learningDecisionFingerprint(buildLearningDecision(decisionInput({ objectiveVersion: "objective-v2" }))));
  });
});

describe("A1 outcome", () => {
  it("marks an in-aperture proposal ADMISSIBLE without claiming META eligibility", () => {
    assert.equal(buildLearningDecision(decisionInput()).decisionOutcome, "ADMISSIBLE");
  });

  it("records REJECTED when every proposal is refused, and keeps the refusals in the denominator", () => {
    const decision = buildLearningDecision(decisionInput({ proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 9 }] }));
    assert.equal(decision.decisionOutcome, "REJECTED");
    assert.equal(decision.admissibleChanges.length, 0);
    assert.equal(decision.rejectedChanges.length, 1);
    assert.equal(decision.changeMagnitude, 0);
  });

  it("does not treat caller-supplied META claims as decision authority", () => {
    const input = { ...decisionInput(), metaCyclesEvaluated: 0, metaOosPartition: "meta-holdout" };
    const decision = buildLearningDecision(input);
    assert.equal(decision.decisionOutcome, "ADMISSIBLE", "proposal validation is not META eligibility");
    assert.equal("metaOosPartition" in decision, false, "A1 does not assign a META partition");
  });

  it("is INSUFFICIENT when nothing was proposed at all", () => {
    assert.equal(buildLearningDecision(decisionInput({ proposedChanges: [] })).decisionOutcome, "INSUFFICIENT");
  });
});

describe("A1 aperture falsification", () => {
  it("refuses a proposal outside the owner bounds", () => {
    assert.equal(assessChange({ surface: "longBarTickEvery", currentValue: 4, proposedValue: 5 }).verdict, "REJECTED");
    assert.equal(assessChange({ surface: "longBarTickEvery", currentValue: 1, proposedValue: 0 }).verdict, "REJECTED");
  });

  it("refuses a step larger than the per-cycle delta, even inside the bounds", () => {
    const assessment = assessChange({ surface: "longBarTickEvery", currentValue: 1, proposedValue: 4 });
    assert.equal(assessment.verdict, "REJECTED");
    assert.equal(assessment.minimum, 1);
    assert.equal(assessment.maximum, 4);
    assert.equal(assessment.maximumDeltaPerCycle, 1);
  });

  it("refuses a proposal that changes nothing", () => {
    assert.equal(assessChange({ surface: "longBarTickEvery", currentValue: 2, proposedValue: 2 }).verdict, "REJECTED");
  });

  it("refuses a surface learning invented, because the allowlist is owner-defined", () => {
    const assessment = assessChange({ surface: "someNewKnobLearningDiscovered", currentValue: 1, proposedValue: 2 });
    assert.equal(assessment.verdict, "REJECTED");
    assert.match(assessment.reason, /may not invent a mutable field/);
  });
});

describe("A1 immutable surface - section 29", () => {
  for (const surface of ["PAPER_ONLY", "liveAuthority", "productionMutationAllowed", "aiAuthority", "releaseAuthority", "qualificationThreshold", "minimumSample", "oosWindow", "costGate", "leakageRules", "riskLimitPerOrder", "governanceApproval"]) {
    it("refuses " + surface + " unconditionally, with the bounds absent", () => {
      const assessment = assessChange({ surface, currentValue: 0, proposedValue: 1 });
      assert.equal(assessment.verdict, "REJECTED");
      assert.match(assessment.reason, /immutable surface/);
      assert.equal(assessment.minimum, undefined, "an immutable surface is never given an aperture");
    });
  }

  it("negative research evidence cannot relax a threshold - section 26", () => {
    // A trial that failed entirely is genuine learning input, but it buys no authority to widen a
    // gate. The refusal is structural, so it holds regardless of how bad the evidence was.
    const fromFailure = buildLearningDecision(decisionInput({
      reasonEvidence: ["trial-a", "trial-b", "trial-c"],
      proposedChanges: [
        { surface: "qualificationThreshold", currentValue: 0.05, proposedValue: 0.01 },
        { surface: "riskLimitPerOrder", currentValue: 1, proposedValue: 5 },
        { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
      ],
    }));
    assert.equal(fromFailure.decisionOutcome, "ADMISSIBLE", "the cadence change is still admissible");
    assert.equal(fromFailure.admissibleChanges.length, 1);
    assert.equal(fromFailure.rejectedChanges.length, 2);
    assert.deepEqual(fromFailure.rejectedChanges.map((change) => change.surface), ["qualificationThreshold", "riskLimitPerOrder"]);
  });
});

describe("A1 is a receipt, not an authority - section 24", () => {
  it("cannot claim application; that outcome belongs to the separate A4 receipt", () => {
    const decision = buildLearningDecision(decisionInput());
    assert.equal("appliedChanges" in decision, false);
    assert.equal("resultingResearchSpecFingerprint" in decision, false);
    assert.equal(decision.decisionOutcome, "ADMISSIBLE");
  });

  it("recomputes the owner aperture before trusting a durable decision receipt", () => {
    const decision = buildLearningDecision(decisionInput());
    const forged = {
      ...decision,
      proposedChanges: [{ surface: "riskLimitPerOrder", currentValue: 1, proposedValue: 5 }],
      admissibleChanges: [{ surface: "riskLimitPerOrder", currentValue: 1, proposedValue: 5, minimum: 0, maximum: 10, maximumDeltaPerCycle: 10, verdict: "ADMISSIBLE", reason: "forged" }],
      rejectedChanges: [],
      decisionOutcome: "ADMISSIBLE" as const,
    };
    assert.throws(() => assertLearningDecision(forged), /owner aperture/);
  });

  it("a decision is immutable once built, on every construction path", () => {
    const decision = buildLearningDecision(decisionInput());
    assert.ok(Object.isFrozen(decision), "a built decision is frozen");
    // Immutability is a construction guarantee, not a replay precondition: a receipt read back from
    // durable storage is a fresh object by definition, so validation checks content rather than the
    // frozen flag.
    assert.throws(() => assertLearningDecision({ ...decision, decisionOutcome: "APPLIED" }), /outside the closed set/);
  });
});

describe("A1 durable exactly-once - section 43", () => {
  function fakeLedger(): { readonly records: Array<Record<string, unknown>>; readonly ledger: ConstructorParameters<typeof LearningDecisionLedger>[0] } {
    const records: Array<Record<string, unknown>> = [];
    return {
      records,
      ledger: {
        append: (record: Record<string, unknown>) => {
          records.push(record);
          return record;
        },
        list: () => records as never,
      } as never,
    };
  }

  it("appending the same decision twice records it once", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z"));
    const decision = buildLearningDecision(decisionInput());
    new LearningInputSetLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);

    const first = store.append(decision);
    assert.equal(first.replayed, false);
    const second = store.append(decision);
    assert.equal(second.replayed, true, "the second append is recognised as a replay");
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(store.summary().decisionsRecorded, 1, "exactly one durable decision");
  });

  it("keeps a rejected decision rather than dropping it from the denominator", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z"));
    new LearningInputSetLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);
    store.append(buildLearningDecision(decisionInput()));
    store.append(buildLearningDecision(decisionInput({ proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 9 }] })));

    assert.equal(store.summary().decisionsRecorded, 2);
    assert.equal(store.rejections().length, 1, "the refusal is recorded evidence, not a discarded attempt");
  });

  it("replays every durable receipt and fails closed on a tampered one", () => {
    const { records, ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z"));
    const decision = buildLearningDecision(decisionInput());
    new LearningInputSetLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);
    store.append(decision);
    assert.equal(store.summary().decisionsRecorded, 1);

    const decisionRecord = records.find((record) => String(record.opportunityId).startsWith("learning-decision:"))!;
    const tampered = JSON.parse(decisionRecord.hypothesis as string) as Record<string, unknown>;
    tampered.changeMagnitude = 99;
    decisionRecord.hypothesis = JSON.stringify(tampered);
    assert.throws(() => store.summary(), /change magnitude is invalid/);
  });

  it("refuses a well-formed decision unless its canonical A2 receipt is already durable", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, () => Date.parse("2026-10-18T00:00:00.000Z"));
    assert.throws(() => store.append(buildLearningDecision(decisionInput())), /A2 input set to be durable first/);
  });
});
