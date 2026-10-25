import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { SqliteResearchHoldoutLedger, type HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";
import {
  META_MINIMUM_CYCLES_FOR_ELIGIBILITY,
  assignMetaPartition,
  metaOosCyclesEligibility,
  assertMetaOosAssignment,
  type MetaPartition,
  type MetaOosAssignmentInput,
} from "./metaOos";
import { MetaOosLedger } from "./metaOosLedger";
import { buildLearningDecision, learningDecisionFingerprint } from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { applyBoundedChange, ApplicationRegistry, type ApplicationContext, type ApplicationPorts } from "./learningApplication";
import { LearningApplicationLedger } from "./learningApplicationLedger";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};
const DECISION_FINGERPRINT = "c".repeat(64);
const SPEC_A = "a".repeat(64);

function eligibilityIdentity(decision: ReturnType<typeof buildLearningDecision>) {
  return { learningCycleId: decision.learningCycleId, learningDecisionFingerprint: learningDecisionFingerprint(decision) };
}

/** The real holdout ledger validates the key shape, so this is a well-formed SHA-256 as production sends. */
const HOLDOUT: HoldoutKey = Object.freeze({ strategyConfigHash: "a".repeat(64), market: "KRW-BTC", intervalMs: 60_000, holdoutStartMs: 1_000, holdoutEndMs: 2_000 });

function cycleId(seed: string): string {
  return "learning-cycle:" + seed.repeat(64).slice(0, 64);
}

function assignment(overrides: Partial<MetaOosAssignmentInput> = {}): MetaOosAssignmentInput {
  return {
    learningCycleId: cycleId("a"),
    learningDecisionFingerprint: DECISION_FINGERPRINT,
    partition: "meta-train",
    policyVersion: "learn-v1",
    cutoff: 900,
    assignedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

it("restores the same A3 assignment after a file-backed ledger restart and does not append a replay", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-meta-oos-restart-")), "learning.db");
  let db = new SqliteDatabase(filename);
  try {
    const firstLedger = new MetaOosLedger(new SqliteEvolutionLearningLedger(db), () => Date.parse("2026-10-18T00:00:00.000Z"));
    const first = firstLedger.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false });
    db.close();

    db = new SqliteDatabase(filename);
    const restartedLedger = new MetaOosLedger(new SqliteEvolutionLearningLedger(db), () => Date.parse("2026-10-18T00:00:00.000Z"));
    assert.deepEqual(restartedLedger.assignments(), [first.assignment]);
    assert.equal(restartedLedger.partitionOf(assignment().learningCycleId), "meta-train");

    const replay = restartedLedger.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false });
    assert.equal(replay.replayed, true);
    assert.equal(replay.fingerprint, first.fingerprint);
    assert.equal(restartedLedger.summary().assignmentsRecorded, 1);
    assert.throws(() => restartedLedger.assign(assignment({ partition: "meta-validation" }), { claim: () => "CLAIMED", isUsed: () => false }), /already assigned to meta-train/);
  } finally {
    db.close();
    rmSync(dirname(filename), { recursive: true, force: true });
  }
});

it("replays an already-claimed meta-holdout assignment after restart without claiming it again", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-meta-holdout-restart-")), "learning.db");
  let db = new SqliteDatabase(filename);
  const input = assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" });
  try {
    const firstHoldouts = new SqliteResearchHoldoutLedger(db);
    const firstLedger = new MetaOosLedger(new SqliteEvolutionLearningLedger(db), () => Date.parse("2026-10-18T00:00:00.000Z"));
    const first = firstLedger.assign(input, firstHoldouts);
    assert.equal(first.replayed, false);
    db.close();

    db = new SqliteDatabase(filename);
    const restartedHoldouts = new SqliteResearchHoldoutLedger(db);
    const restartedLedger = new MetaOosLedger(new SqliteEvolutionLearningLedger(db), () => Date.parse("2026-10-18T00:00:00.000Z"));
    assert.equal(restartedHoldouts.isUsed(HOLDOUT), true);
    const replay = restartedLedger.assign(input, restartedHoldouts);
    assert.equal(replay.replayed, true);
    assert.equal(replay.fingerprint, first.fingerprint);
    assert.equal(restartedLedger.summary().assignmentsRecorded, 1);
    assert.throws(
      () => restartedLedger.assign({ ...input, holdoutKey: { ...HOLDOUT, strategyConfigHash: "b".repeat(64) } }, restartedHoldouts),
      /different content|matching single-use holdout claim/,
      "a replay cannot substitute a different already-used holdout",
    );
  } finally {
    db.close();
    rmSync(dirname(filename), { recursive: true, force: true });
  }
});

function fixture() {
  const db = new SqliteDatabase(":memory:");
  // The real holdout truth source, not a stand-in: single-use must be proven against it.
  const holdouts = new SqliteResearchHoldoutLedger(db);
  const records: Array<Record<string, unknown>> = [];
  const ledger = new MetaOosLedger(
    {
      append: (record: Record<string, unknown>) => {
        records.push(record);
        return record;
      },
      list: () => records as never,
    } as never,
    () => Date.parse("2026-10-18T00:00:00.000Z"),
  );
  return { db, holdouts, ledger, close: () => db.close() };
}

describe("A3 - one cycle belongs to exactly one partition (section 20)", () => {
  it("records a partition assignment once and is idempotent on replay", () => {
    const { ledger, close } = fixture();
    try {
      const first = ledger.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false });
      assert.equal(first.replayed, false);
      const second = ledger.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false });
      assert.equal(second.replayed, true, "the same cycle and partition is a replay, not a second record");
      assert.equal(second.fingerprint, first.fingerprint);
      assert.equal(ledger.summary().assignmentsRecorded, 1);
    } finally {
      close();
    }
  });

  it("refuses to move an already-assigned cycle to another partition instead of picking the newest", () => {
    const { ledger, close } = fixture();
    try {
      ledger.assign(assignment({ partition: "meta-train" }), { claim: () => "CLAIMED", isUsed: () => false });
      assert.throws(
        () => ledger.assign(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), { claim: () => "CLAIMED", isUsed: () => false }),
        /already assigned to meta-train/,
      );
      assert.equal(ledger.summary().assignmentsRecorded, 1, "the fork never becomes a second durable record");
      assert.equal(ledger.partitionOf(cycleId("a")), "meta-train");
    } finally {
      close();
    }
  });

  it("carries the decision fingerprint and cutoff so a cycle is traceable to its decision", () => {
    const { ledger, close } = fixture();
    try {
      const receipt = ledger.assign(assignment({ learningDecisionFingerprint: "d".repeat(64), cutoff: 1_234 }), { claim: () => "CLAIMED", isUsed: () => false });
      assert.equal(receipt.assignment.learningDecisionFingerprint, "d".repeat(64));
      assert.equal(receipt.assignment.cutoff, 1_234);
      assert.ok(receipt.assignment.assignmentFingerprint.length === 64);
    } finally {
      close();
    }
  });
});

describe("A3 - meta-holdout is single-use (section 21)", () => {
  it("claims a holdout on the real holdout ledger and then refuses the same result again", () => {
    const { holdouts, close } = fixture();
    try {
      // The real claim succeeds the first time.
      const first = assignMetaPartition(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), holdouts);
      assert.ok(first.holdoutClaimIdentity, "a holdout partition records which held-out result it consumed");
      assert.ok(holdouts.isUsed(HOLDOUT), "the shared truth source now knows this holdout was observed");

      // Reusing it for the same policy tuning is contamination and fails closed.
      assert.throws(
        () => assignMetaPartition(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-2" }), holdouts),
        /already been observed|already used/,
      );
    } finally {
      close();
    }
  });

  it("requires a holdout key before a meta-holdout partition can exist at all", () => {
    const { holdouts, close } = fixture();
    try {
      assert.throws(() => assignMetaPartition(assignment({ partition: "meta-holdout" }), holdouts), /requires a holdout key/);
      assert.equal(holdouts.isUsed(HOLDOUT), false, "nothing was claimed by the failed attempt");
    } finally {
      close();
    }
  });

  it("leaves no durable assignment when the holdout claim is refused", () => {
    const { ledger, holdouts, close } = fixture();
    try {
      assignMetaPartition(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), holdouts);
      assert.throws(
        () => ledger.assign(assignment({ learningCycleId: cycleId("b"), partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-2" }), holdouts),
        /already been observed|already used/,
      );
      assert.equal(ledger.summary().assignmentsRecorded, 0, "a contaminated claim never becomes a record");
    } finally {
      close();
    }
  });

  it("binds the claim identity into the assignment fingerprint, so it cannot be detached", () => {
    const { holdouts, close } = fixture();
    try {
      const built = assignMetaPartition(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), holdouts);
      assert.doesNotThrow(() => assertMetaOosAssignment(built));
      const stripped = { ...built } as Record<string, unknown>;
      delete stripped.holdoutClaimIdentity;
      assert.throws(() => assertMetaOosAssignment(stripped), /does not match its own fingerprint/);
    } finally {
      close();
    }
  });
});

describe("A3 - insufficient is legitimate and the floor is owner-fixed (section 22)", () => {
  it("reports ineligible below the minimum and never lowers the minimum", () => {
    const { close } = fixture();
    try {
      const eligibility = metaOosCyclesEligibility([], "meta-holdout", 0, { learningCycleId: cycleId("e"), learningDecisionFingerprint: "d".repeat(64) });
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.cyclesEvaluated, 0);
      assert.match(eligibility.reason, /owner-fixed and is not lowered/);
      assert.equal(META_MINIMUM_CYCLES_FOR_ELIGIBILITY, 3, "one completed cycle per partition");
    } finally {
      close();
    }
  });

  it("ignores a cycle count a decision asserts for itself when no assignments exist", () => {
    const { close } = fixture();
    try {
      // The decision may claim any number it likes; eligibility comes from recorded assignments only.
      const decision = buildLearningDecision({
        inputSet: buildLearningInputSet({
          cutoffTimestamp: 900,
          researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
          paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
          policies: POLICIES,
        }),
        previousResearchSpecFingerprint: SPEC_A,
        objectiveVersion: "objective-v1",
        proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }],
        reasonEvidence: ["trial-a"],
        createdAt: "2026-10-18T00:00:00.000Z",
        sourceCommit: "273d785df7b14c3a8e541ae45ea71fe3aacb49b4",
        runtimeIdentity: "runtime-test",
      });
      assert.equal(decision.decisionOutcome, "ADMISSIBLE", "the decision itself is admissible, not META-eligible");

      const { ledger } = fixture();
      const eligibility = ledger.eligibility("meta-holdout", eligibilityIdentity(decision));
      assert.equal(eligibility.eligible, false, "no recorded assignments means no eligibility, whatever the decision claims");
      assert.equal(eligibility.cyclesEvaluated, 0);
    } finally {
      close();
    }
  });
});

describe("A3 -> A4 - the eligibility bridge is the thing that keeps the door shut, then opens it", () => {
  const CONTEXT: ApplicationContext = {
    applicationTimestamp: "2026-10-18T00:00:00.000Z",
    runtimeIdentity: "runtime-test",
    sourceCommit: "273d785df7b14c3a8e541ae45ea71fe3aacb49b4",
  };

  function ports(state: { value: number }): ApplicationPorts {
    return {
      readCurrent: () => state.value,
      readCurrentResearchSpec: () => ({ fingerprint: SPEC_A, values: { longBarTickEvery: state.value } }),
      commit: (_surface, value) => { state.value = value; },
      failSafeValue: () => 1,
      withExclusiveApplicationLease: (_identity, operation) => Object.freeze({ acquired: true, value: operation() }),
    };
  }

  function decision() {
    return buildLearningDecision({
      inputSet: buildLearningInputSet({
        cutoffTimestamp: 900,
        researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
        paperEvidence: [{ recordId: "p1", recordedAt: 200 }],
        policies: POLICIES,
      }),
      previousResearchSpecFingerprint: SPEC_A,
      objectiveVersion: "objective-v1",
      proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }],
      reasonEvidence: ["trial-a"],
      createdAt: "2026-10-18T00:00:00.000Z",
      sourceCommit: CONTEXT.sourceCommit,
      runtimeIdentity: "runtime-test",
    });
  }

  function applicationPorts(state: { value: number }, eligibilityFor: (partition: MetaPartition, target: ReturnType<typeof decision>) => ReturnType<MetaOosLedger["eligibility"]>): ApplicationPorts {
    const base = ports(state);
    return {
      ...base,
      resolveMetaOosEligibility: (target, _fingerprint) => eligibilityFor("meta-holdout", target as ReturnType<typeof decision>),
    };
  }

  function journal(): LearningApplicationLedger {
    const records: Array<Record<string, unknown>> = [];
    const appendWithResult = (record: Record<string, unknown>) => {
      const existing = records.find((item) => item.opportunityId === record.opportunityId);
      if (existing != null) return Object.freeze({ record: existing, inserted: false });
      records.push(record);
      return Object.freeze({ record, inserted: true });
    };
    return new LearningApplicationLedger({
      append: (record: Record<string, unknown>) => appendWithResult(record).record,
      appendWithResult,
      list: () => records as never,
    } as never, () => Date.parse(CONTEXT.applicationTimestamp));
  }

  it("keeps application closed while the partitions have no completed cycles", () => {
    const { ledger, close } = fixture();
    try {
      const state = { value: 1 };
      const target = decision();
      const receipt = applyBoundedChange(target, applicationPorts(state, (partition, current) => ledger.eligibility(partition, eligibilityIdentity(current))), CONTEXT, journal(), new ApplicationRegistry());
      assert.equal(receipt.applicationOutcome, "REJECTED");
      assert.match(receipt.rejectionReason ?? "", /meta-OOS eligibility not established/);
      assert.equal(state.value, 1, "no mutation before A3 has real cycles behind it");
    } finally {
      close();
    }
  });

  it("opens application only once recorded assignments meet the owner-fixed floor", () => {
    const { ledger, holdouts: fixtureHoldouts, close } = fixture();
    try {
      for (let index = 0; index < META_MINIMUM_CYCLES_FOR_ELIGIBILITY; index += 1) {
        ledger.assign(assignment({
          learningCycleId: cycleId(String(index)),
          partition: "meta-holdout",
          holdoutKey: { ...HOLDOUT, strategyConfigHash: String(index + 1).repeat(64) },
          holdoutEvaluationId: "eval-" + String(index),
        }), fixtureHoldouts);
      }
      const target = decision();
      const eligibility = ledger.eligibility("meta-holdout", eligibilityIdentity(target));
      assert.equal(eligibility.eligible, true);
      assert.equal(eligibility.cyclesEvaluated, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);

      const state = { value: 1 };
      const receipt = applyBoundedChange(target, applicationPorts(state, () => eligibility), CONTEXT, journal(), new ApplicationRegistry());
      assert.equal(receipt.applicationOutcome, "APPLIED", receipt.rejectionReason ?? receipt.fallbackReason);
      assert.equal(state.value, 2, "the bounded change is now applied, exactly once");
    } finally {
      close();
    }
  });

  it("does not grant eligibility to a partition that has fewer recorded cycles than another", () => {
    const { ledger, close } = fixture();
    try {
      for (let index = 0; index < META_MINIMUM_CYCLES_FOR_ELIGIBILITY; index += 1) {
        ledger.assign(assignment({ learningCycleId: cycleId(String(index)), partition: "meta-train" }), { claim: () => "CLAIMED", isUsed: () => false });
      }
      const target = decision();
      const identity = eligibilityIdentity(target);
      assert.equal(ledger.eligibility("meta-train", identity).eligible, true);
      assert.equal(ledger.eligibility("meta-validation", identity).eligible, false, "partitions are judged separately, never pooled to reach the floor");
      assert.equal(ledger.eligibility("meta-holdout", identity).eligible, false);
    } finally {
      close();
    }
  });
});

describe("A3 durable identity", () => {
  it("rejects a tampered assignment on replay", () => {
    const { ledger, close } = fixture();
    try {
      ledger.assign(assignment(), { claim: () => "CLAIMED", isUsed: () => false });
      assert.equal(ledger.summary().assignmentsRecorded, 1);
      assert.throws(() => ledger.assign({ ...assignment(), cutoff: 999_999 }, { claim: () => "CLAIMED", isUsed: () => false }), /re-supplied with different content|does not match/);
      assert.equal(ledger.summary().assignmentsRecorded, 1);
    } finally {
      close();
    }
  });

  it("rejects an assignment carrying a malformed cycle id", () => {
    const { ledger, close } = fixture();
    try {
      assert.throws(() => ledger.assign(assignment({ learningCycleId: "learning-cycle:short" }), { claim: () => "CLAIMED", isUsed: () => false }), /cycle id is invalid/);
      assert.equal(ledger.summary().assignmentsRecorded, 0);
    } finally {
      close();
    }
  });

  it("rejects a partition outside the closed set", () => {
    const { ledger, close } = fixture();
    try {
      assert.throws(() => ledger.assign(assignment({ partition: "meta-tune" as never }), { claim: () => "CLAIMED", isUsed: () => false }), /outside the closed set/);
    } finally {
      close();
    }
  });
});

describe("A3 holdout claim preconditions", () => {
  it("checks ledger capacity before consuming a holdout", () => {
    let claims = 0;
    const ledger = new MetaOosLedger({
      list: () => Array.from({ length: 10_000 }, (_, index) => ({ opportunityId: `other:${index}` })) as never,
      append: () => { throw new Error("must not append at capacity"); },
    } as never);

    assert.throws(
      () => ledger.assign(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), {
        claim: () => { claims += 1; return "CLAIMED"; },
        isUsed: () => false,
      }),
      { code: "CAPACITY_EXCEEDED" },
    );
    assert.equal(claims, 0);
  });

  it("checks the durable clock before consuming a holdout", () => {
    let claims = 0;
    const ledger = new MetaOosLedger({ list: () => [], append: () => { throw new Error("must not append with an invalid clock"); } } as never, () => -1);

    assert.throws(
      () => ledger.assign(assignment({ partition: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), {
        claim: () => { claims += 1; return "CLAIMED"; },
        isUsed: () => false,
      }),
      { code: "INVALID_CLOCK" },
    );
    assert.equal(claims, 0);
  });
});
