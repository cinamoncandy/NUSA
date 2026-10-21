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
  META_PARTITION_FLOOR,
  META_PARTITIONS,
  assignMetaPartition,
  metaOosEligibility,
  assertMetaOosAssignment,
  type MetaOosAssignmentInput,
  type MetaOosCompletionEvidence,
} from "./metaOos";
import { MetaOosLedger } from "./metaOosLedger";
import { buildLearningDecision } from "./learningDecision";
import { buildLearningInputSet } from "./learningInputSet";
import { applyBoundedChange, ApplicationRegistry, type ApplicationContext, type ApplicationPorts } from "./learningApplication";

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};
const DECISION_FINGERPRINT = "c".repeat(64);
const SPEC_A = "a".repeat(64);

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
/** Completion evidence counting exactly the listed cycles as resolved. Assignment alone is never enough. */
function completed(cycleIds: readonly string[]): MetaOosCompletionEvidence {
  const resolved = new Set(cycleIds);
  return Object.freeze({ isCycleCompleted: (learningCycleId: string) => resolved.has(learningCycleId) });
}

/** Files `perPartition` completed cycles into every partition, as a genuine full meta pass would. */
function fileCompletedCycles(ledger: MetaOosLedger, perPartition: number): string[] {
  const ids: string[] = [];
  for (const partition of META_PARTITIONS) {
    // Seeds must stay hex: a learning cycle id is `learning-cycle:<64 hex>`.
    const lane = partition === "meta-train" ? "a" : partition === "meta-validation" ? "b" : "c";
    for (let index = 0; index < perPartition; index += 1) {
      const seed = lane + index.toString(16);
      const id = cycleId(seed);
      // Meta-holdout cycles each need their own key: single-use is per key, never per policy.
      const holdout = partition === "meta-holdout"
        ? { holdoutKey: Object.freeze({ strategyConfigHash: (index + 1).toString(16).padStart(64, "0"), market: "KRW-BTC", intervalMs: 60_000, holdoutStartMs: 1_000, holdoutEndMs: 2_000 }) as HoldoutKey, holdoutEvaluationId: "eval-" + seed }
        : {};
      ledger.assign(assignment({ learningCycleId: id, partition, ...holdout }), { claim: () => "CLAIMED", isUsed: () => false });
      ids.push(id);
    }
  }
  return ids;
}
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
      const eligibility = metaOosEligibility([], completed([]));
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.cyclesEvaluated, 0);
      assert.match(eligibility.reason, /neither the floor nor the coverage is lowered/);
      assert.equal(META_MINIMUM_CYCLES_FOR_ELIGIBILITY, 3, "three completed cycles required, per partition");
      assert.equal(META_PARTITIONS.length, 3, "and all three partitions are required, so the floor can never be reached from one lane");
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
      const eligibility = ledger.eligibility();
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
    return { readCurrent: () => state.value, commit: (_surface, value) => { state.value = value; }, failSafeValue: () => 1 };
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

  it("keeps application closed while the partitions have no completed cycles", () => {
    const { ledger, close } = fixture();
    try {
      const state = { value: 1 };
      const receipt = applyBoundedChange(decision(), ledger.eligibility(), ports(state), CONTEXT, new ApplicationRegistry());
      assert.equal(receipt.applicationOutcome, "REJECTED");
      assert.match(receipt.rejectionReason ?? "", /meta-OOS eligibility not established/);
      assert.equal(state.value, 1, "no mutation before A3 has real cycles behind it");
    } finally {
      close();
    }
  });

  it("refuses eligibility when every partition holds assignments whose cycles never resolved", () => {
    const { ledger, close } = fixture();
    try {
      fileCompletedCycles(ledger, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);
      const eligibility = ledger.eligibility(completed([]));
      assert.equal(eligibility.eligible, false, "assignment is not completion; a partition cannot vouch for its own contents");
      assert.equal(eligibility.cyclesEvaluated, 0);
      assert.match(eligibility.reason, /an assignment is not completion/);
    } finally {
      close();
    }
  });

  it("refuses eligibility when only one partition is covered, however deep it goes", () => {
    const { ledger, close } = fixture();
    try {
      // The defect this preflight caught: three train assignments, and nothing else, used to be
      // enough to open A4's autonomous door with zero validation and zero holdout behind them.
      const ids: string[] = [];
      for (let index = 0; index < META_MINIMUM_CYCLES_FOR_ELIGIBILITY; index += 1) {
        const id = cycleId("a" + index.toString(16));
        ledger.assign(assignment({ learningCycleId: id, partition: "meta-train" }), { claim: () => "CLAIMED", isUsed: () => false });
        ids.push(id);
      }
      const eligibility = ledger.eligibility(completed(ids));
      assert.equal(eligibility.eligible, false, "train alone may never open the door, however many completed cycles it holds");
      assert.equal(eligibility.cyclesEvaluated, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);
      assert.match(eligibility.reason, /all three partitions are required/);
    } finally {
      close();
    }
  });

  it("opens application only once all three partitions hold completed cycles at the floor", () => {
    const { ledger, close } = fixture();
    try {
      const ids = fileCompletedCycles(ledger, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);
      const eligibility = ledger.eligibility(completed(ids));
      assert.equal(eligibility.eligible, true);
      assert.equal(eligibility.cyclesEvaluated, META_PARTITIONS.length * META_MINIMUM_CYCLES_FOR_ELIGIBILITY);

      const state = { value: 1 };
      const receipt = applyBoundedChange(decision(), eligibility, ports(state), CONTEXT, new ApplicationRegistry());
      assert.equal(receipt.applicationOutcome, "APPLIED");
      assert.equal(state.value, 2, "the bounded change is now applied, exactly once");
    } finally {
      close();
    }
  });

  it("never opens from partial coverage, and never from topping up a single partition", () => {
    const { ledger, close } = fixture();
    try {
      const ids = fileCompletedCycles(ledger, META_PARTITION_FLOOR - 1);
      assert.equal(ledger.eligibility(completed(ids)).eligible, false, "one short of the floor in every partition is still insufficient");

      const extra = cycleId("f0");
      ledger.assign(assignment({ learningCycleId: extra, partition: "meta-holdout", holdoutKey: Object.freeze({ strategyConfigHash: "9".repeat(64), market: "KRW-BTC", intervalMs: 60_000, holdoutStartMs: 1_000, holdoutEndMs: 2_000 }) as HoldoutKey, holdoutEvaluationId: "eval-f0" }), { claim: () => "CLAIMED", isUsed: () => false });
      const eligibility = ledger.eligibility(completed([...ids, extra]));
      assert.equal(eligibility.eligible, false, "bringing one partition to the floor may not stand in for the other two");
      assert.match(eligibility.reason, /all three partitions are required/);
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
