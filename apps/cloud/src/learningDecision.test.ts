import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildLearningDecision,
  assessChange,
  learningDecisionFingerprint,
  assertLearningDecision,
  assertLearningDecisionPremisesMatchCurrentSpec,
  type LearningDecisionInput,
} from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { LearningDecisionLedger } from "./learningDecisionLedger";
import { LearningInputSetLedger } from "./learningInputSetLedger";
import { createLearningEvidenceAuthorityFromReaders } from "./learningEvidenceAuthority";
import { SqliteDatabase, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/index";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};

const inputSet = (cutoff = 900) =>
  buildLearningInputSet({
    cutoffTimestamp: cutoff,
    researchEvidence: ["trial-a", "trial-b", "trial-c"].map((recordId, index) => ({ recordId, recordedAt: 100 + index })),
    paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
    policies: POLICIES,
  });

const testEvidenceAuthority = (fixture = inputSet()) => {
  const research = new Map(fixture.researchEvidenceRecordIds.map((recordId, index) => [recordId, { recordId, recordedAt: fixture.researchEvidenceObservedAt[index] }]));
  const paper = new Map(fixture.paperEvidenceRecordIds.map((recordId, index) => [recordId, { recordId, recordedAt: fixture.paperEvidenceObservedAt[index] }]));
  return createLearningEvidenceAuthorityFromReaders({
    readResearch: (recordId) => research.get(recordId),
    readPaper: (recordId) => paper.get(recordId),
    readResearchSnapshot: () => [...research.values()],
    readPaperSnapshot: () => [...paper.values()],
  });
};

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
  it("canonicalizes proposal and reason-reference order", () => {
    const ordered = buildLearningDecision(decisionInput({
      proposedChanges: [
        { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
        { surface: "unlistedCadence", currentValue: 1, proposedValue: 2 },
      ],
      reasonEvidence: ["trial-a", "p1"],
    }));
    const shuffled = buildLearningDecision(decisionInput({
      proposedChanges: [
        { surface: "unlistedCadence", currentValue: 1, proposedValue: 2 },
        { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
      ],
      reasonEvidence: ["p1", "trial-a"],
    }));
    assert.equal(learningDecisionFingerprint(ordered), learningDecisionFingerprint(shuffled));
  });

  it("rejects duplicate proposals for the same surface", () => {
    assert.throws(() => buildLearningDecision(decisionInput({ proposedChanges: [
      { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
      { surface: "longBarTickEvery", currentValue: 2, proposedValue: 3 },
    ] })), /only one proposal per surface/);
  });

  it("the cycle id is inherited from the input set, so one evidence set yields one cycle", () => {
    const decision = buildLearningDecision(decisionInput());
    assert.equal(decision.learningCycleId, "learning-cycle:" + decision.learningInputSetFingerprint);
    assert.equal(buildLearningDecision(decisionInput()).learningCycleId, decision.learningCycleId);
  });

  it("carries an immutable full A2 input set and rejects a mismatched embedded identity", () => {
    const input = decisionInput();
    const decision = buildLearningDecision(input);
    assert.deepEqual(decision.learningInputSet, input.inputSet);
    assert.notEqual(decision.learningInputSet, input.inputSet, "A1 owns a canonical immutable copy");
    assert.equal(Object.isFrozen(decision.learningInputSet), true);
    assert.equal(Object.isFrozen(decision.learningInputSet.researchEvidenceRecordIds), true);
    assert.throws(() => assertLearningDecision({
      ...decision,
      learningInputSet: { ...decision.learningInputSet, cutoffTimestamp: decision.learningInputSet.cutoffTimestamp + 1 },
    }), /does not match the decision fingerprint/);
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

  it("refuses fractional cadence premises and proposals", () => {
    for (const request of [
      { surface: "longBarTickEvery", currentValue: 1, proposedValue: 1.5 },
      { surface: "longBarTickEvery", currentValue: 1.5, proposedValue: 2 },
    ]) {
      const assessment = assessChange(request);
      assert.equal(assessment.verdict, "REJECTED");
      assert.match(assessment.reason, /safe integers/);
    }
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

  it("refuses a caller premise whose current value is outside owner bounds", () => {
    assert.equal(assessChange({ surface: "longBarTickEvery", currentValue: 0, proposedValue: 1 }).verdict, "REJECTED");
    assert.match(assessChange({ surface: "longBarTickEvery", currentValue: 0, proposedValue: 1 }).reason, /current value is outside/);
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

  it("rejects unbounded, duplicate, or non-A2 reason evidence", () => {
    assert.throws(() => buildLearningDecision(decisionInput({ proposedChanges: Array.from({ length: 33 }, () => ({ surface: "unknown", currentValue: 1, proposedValue: 2 })) })), /bounded receipt limit/);
    assert.throws(() => buildLearningDecision(decisionInput({ reasonEvidence: Array.from({ length: 65 }, () => "trial-a") })), /bounded receipt limit/);
    assert.throws(() => buildLearningDecision(decisionInput({ reasonEvidence: ["not-in-a2"] })), /durable A2 input set/);
    assert.throws(() => buildLearningDecision(decisionInput({ reasonEvidence: ["trial-a", "trial-a"] })), /may not repeat/);
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

  it("rejects a reordered proposal list even when each proposal assessment is valid", () => {
    const decision = buildLearningDecision(decisionInput({ proposedChanges: [
      { surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 },
      { surface: "unknownFutureSurface", currentValue: 1, proposedValue: 2 },
    ] }));
    assert.throws(() => assertLearningDecision({ ...decision, proposedChanges: [...decision.proposedChanges].reverse() }), /canonical ordering/);
  });

  it("fails closed when the actual current spec value differs from the proposal premise", () => {
    const decision = buildLearningDecision(decisionInput());
    assert.throws(() => assertLearningDecisionPremisesMatchCurrentSpec(decision, {
      fingerprint: SPEC_A,
      values: { longBarTickEvery: 4 },
    }), /does not match the canonical current research spec/);
    assert.throws(() => assertLearningDecisionPremisesMatchCurrentSpec(decision, {
      fingerprint: "b".repeat(64),
      values: { longBarTickEvery: 1 },
    }), /does not match the decision premise/);
    assert.doesNotThrow(() => assertLearningDecisionPremisesMatchCurrentSpec(decision, {
      fingerprint: SPEC_A,
      values: { longBarTickEvery: 1 },
    }));
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

  it("persists the complete A2 basis in a bounded, independently verifiable A1 receipt", () => {
    const { records, ledger } = fakeLedger();
    const input = decisionInput();
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(input.inputSet);
    const decision = buildLearningDecision(input);
    new LearningDecisionLedger(ledger, testEvidenceAuthority()).append(decision);
    const stored = JSON.parse(records.find((record) => record.validationStatus === "LEARNING_DECISION")!.hypothesis as string) as Record<string, unknown>;
    assert.deepEqual(stored.learningInputSet, decision.learningInputSet);
  });

  it("rejects an A1 receipt whose full A2 basis would exceed the existing ledger size bound", () => {
    const evidence = Array.from({ length: 329 }, (_, index) => ({
      recordId: `research-${String(index).padStart(3, "0")}-${"x".repeat(27)}`,
      recordedAt: index + 1,
    }));
    const largeInputSet = buildLearningInputSet({
      cutoffTimestamp: 10_000,
      researchEvidence: evidence,
      paperEvidence: [],
      policies: POLICIES,
    });
    const input = decisionInput({ inputSet: largeInputSet, reasonEvidence: [evidence[0].recordId] });
    assert.throws(() => buildLearningDecision(input), /existing durable receipt size limit/);
  });

  it("rejects reason references that the canonical ledger cannot persist", () => {
    const longId = "r".repeat(241);
    const oversizedReferenceSet = buildLearningInputSet({
      cutoffTimestamp: 900,
      researchEvidence: [{ recordId: longId, recordedAt: 100 }],
      paperEvidence: [],
      policies: POLICIES,
    });
    assert.throws(() => buildLearningDecision(decisionInput({
      inputSet: oversizedReferenceSet,
      reasonEvidence: [longId],
    })), /durable ledger reference limit/);
  });

  it("persists the maximum supported reason-reference length in SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "nusa-a1-reference-bound-"));
    const databasePath = join(directory, "learning.sqlite");
    const db = new SqliteDatabase(databasePath);
    try {
      const ledger = new SqliteEvolutionLearningLedger(db);
      const reference = "r".repeat(240);
      const inputSet = buildLearningInputSet({
        cutoffTimestamp: 900,
        researchEvidence: [{ recordId: reference, recordedAt: 100 }],
        paperEvidence: [],
        policies: POLICIES,
      });
      new LearningInputSetLedger(ledger, testEvidenceAuthority(inputSet)).append(inputSet);
      const decision = buildLearningDecision(decisionInput({ inputSet, reasonEvidence: [reference] }));
      assert.equal(new LearningDecisionLedger(ledger, testEvidenceAuthority(inputSet)).append(decision).replayed, false);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("appending the same decision twice records it once", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z"));
    const decision = buildLearningDecision(decisionInput());
    new LearningInputSetLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);

    const first = store.append(decision);
    assert.equal(first.replayed, false);
    const second = store.append(decision);
    assert.equal(second.replayed, true, "the second append is recognised as a replay");
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(store.summary().decisionsRecorded, 1, "exactly one durable decision");
  });

  it("same-cycle retry with new attempt metadata replays the first durable decision", () => {
    const { records, ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z"));
    const firstDecision = buildLearningDecision(decisionInput());
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(decisionInput().inputSet);
    const first = store.append(firstDecision);
    const retry = buildLearningDecision(decisionInput({
      createdAt: "2026-10-18T01:00:00.000Z",
      sourceCommit: "4d07d31463ec3ff95132b7cde235937682cc994a",
      runtimeIdentity: "runtime-restarted",
    }));
    const replayed = store.append(retry);
    assert.equal(records.filter((record) => record.validationStatus === "LEARNING_DECISION").length, 1);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.fingerprint, first.fingerprint);
    assert.equal(replayed.decision.createdAt, first.decision.createdAt);
  });

  it("rejects a different decision for an already decided cycle", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority());
    const firstInput = decisionInput();
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(firstInput.inputSet);
    store.append(buildLearningDecision(firstInput));
    assert.throws(() => store.append(buildLearningDecision(decisionInput({
      proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 9 }],
    }))), /already has a different durable decision/);
  });

  it("keeps a rejected decision rather than dropping it from the denominator", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z"));
    new LearningInputSetLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);
    store.append(buildLearningDecision(decisionInput()));
    const nextInput = decisionInput({ inputSet: inputSet(901), proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 9 }] });
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(nextInput.inputSet);
    store.append(buildLearningDecision(nextInput));

    assert.equal(store.summary().decisionsRecorded, 2);
    assert.equal(store.rejections().length, 1, "the refusal is recorded evidence, not a discarded attempt");
  });

  it("replays every durable receipt and fails closed on a tampered one", () => {
    const { records, ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z"));
    const decision = buildLearningDecision(decisionInput());
    new LearningInputSetLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z")).append(decisionInput().inputSet);
    store.append(decision);
    assert.equal(store.summary().decisionsRecorded, 1);

    const decisionRecord = records.find((record) => record.validationStatus === "LEARNING_DECISION")!;
    const tampered = JSON.parse(decisionRecord.hypothesis as string) as Record<string, unknown>;
    tampered.changeMagnitude = 99;
    decisionRecord.hypothesis = JSON.stringify(tampered);
    assert.throws(() => store.summary(), /change magnitude is invalid/);
  });

  it("refuses a well-formed decision unless its canonical A2 receipt is already durable", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority(), () => Date.parse("2026-10-18T00:00:00.000Z"));
    assert.throws(() => store.append(buildLearningDecision(decisionInput())), /A2 input set to be durable first/);
  });

  it("binds learning policy and reason references to the durable A2 receipt", () => {
    const { ledger } = fakeLedger();
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority());
    const input = decisionInput();
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(input.inputSet);
    const decision = buildLearningDecision(input);
    assert.throws(() => store.append({ ...decision, learningPolicyVersion: "learn-v2" }), /does not match its embedded A2 input set/);
    assert.throws(() => store.append({ ...decision, reasonEvidence: ["not-in-a2"] }), /canonical A2 input set/);
  });

  it("requires the complete canonical A2 metadata and retention references", () => {
    const { records, ledger } = fakeLedger();
    const input = decisionInput();
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(input.inputSet);
    const a2 = records.find((record) => record.validationStatus === "LEARNING_INPUT_SET")!;
    a2.evidenceReferences = [a2.opportunityId];
    assert.throws(() => new LearningDecisionLedger(ledger, testEvidenceAuthority()).append(buildLearningDecision(input)), /metadata does not match/);
  });

  it("rejects duplicate or noncanonical reason references during receipt validation", () => {
    const decision = buildLearningDecision(decisionInput({ reasonEvidence: ["trial-a", "p1"] }));
    assert.throws(() => assertLearningDecision({ ...decision, reasonEvidence: ["trial-a", "trial-a"] }), /may not repeat/);
    assert.throws(() => assertLearningDecision({ ...decision, reasonEvidence: ["trial-a", "p1"] }), /canonical ordering/);
  });

  it("deep-freezes decisions rehydrated from the durable ledger", () => {
    const { ledger } = fakeLedger();
    const input = decisionInput();
    new LearningInputSetLedger(ledger, testEvidenceAuthority()).append(input.inputSet);
    const store = new LearningDecisionLedger(ledger, testEvidenceAuthority());
    const decision = buildLearningDecision(input);
    store.append(decision);
    const restored = store.summary().latest!.decision;
    assert.equal(Object.isFrozen(restored), true);
    assert.equal(Object.isFrozen(restored.learningInputSet.researchEvidenceRecordIds), true);
    assert.throws(() => (restored.learningInputSet.researchEvidenceRecordIds as string[]).push("forged"), TypeError);
    assert.throws(() => (restored.proposedChanges as unknown[]).push({}), TypeError);
  });

  it("uses the real hash-chained SQLite ledger across close and reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "nusa-a1-ledger-"));
    const databasePath = join(directory, "learning.sqlite");
    let db = new SqliteDatabase(databasePath);
    try {
      const ledger = new SqliteEvolutionLearningLedger(db);
      const inputSetLedger = new LearningInputSetLedger(ledger, testEvidenceAuthority());
      const decisionLedger = new LearningDecisionLedger(ledger, testEvidenceAuthority());
      const input = decisionInput();
      const inputSetReceipt = inputSetLedger.append(input.inputSet);
      assert.equal(inputSetReceipt.replayed, false);
      const decision = buildLearningDecision(input);
      const first = decisionLedger.append(decision);
      assert.equal(first.replayed, false);
      assert.equal(decisionLedger.append(buildLearningDecision(decisionInput({ runtimeIdentity: "runtime-restarted" }))).replayed, true);
      db.close();
      db = new SqliteDatabase(databasePath);
      assert.equal(new LearningDecisionLedger(new SqliteEvolutionLearningLedger(db), testEvidenceAuthority()).summary().decisionsRecorded, 1);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
