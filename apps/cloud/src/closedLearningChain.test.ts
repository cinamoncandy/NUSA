import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { SqliteResearchHoldoutLedger, type HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";
import { ClosedLearningChain, type LearningChainCycle } from "./closedLearningChain";
import type { ApplicationPorts } from "./learningApplication";
import { META_MINIMUM_CYCLES_FOR_ELIGIBILITY } from "./metaOos";

/**
 * The integrated chain, exercised against the real append-only, hash-chained evolution ledger and the
 * real holdout ledger. Nothing here is a stand-in: if the two evidence lanes only joined inside a
 * test double, this suite would be proving the wrong thing.
 */

const POLICIES = Object.freeze({
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
});

const HOLDOUT: HoldoutKey = Object.freeze({ strategyConfigHash: "b".repeat(64), market: "KRW-BTC", intervalMs: 60_000, holdoutStartMs: 1_000, holdoutEndMs: 2_000 });

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const evolution = new SqliteEvolutionLearningLedger(db as never);
  const holdouts = new SqliteResearchHoldoutLedger(db);
  // Distinct milliseconds, so consecutive appends never collide on chronology.
  let clock = Date.parse("2026-10-18T00:00:00.000Z");
  const now = () => {
    clock += 1;
    return clock;
  };
  return { db, evolution, holdouts, now, close: () => db.close() };
}

function ports(state: { value: number }): ApplicationPorts {
  return {
    readCurrent: () => state.value,
    commit: (_surface, value) => {
      state.value = value;
    },
    failSafeValue: () => 1,
  };
}

function cycle(seed: string, overrides: Partial<LearningChainCycle> = {}): LearningChainCycle {
  return Object.freeze({
    cutoffTimestamp: 900,
    researchEvidence: [{ recordId: "trial-" + seed, recordedAt: 100 }],
    paperEvidence: [{ recordId: "paper-" + seed, recordedAt: 200 }],
    policies: POLICIES,
    metaPartitionIdentity: "meta-train",
    previousResearchSpecFingerprint: "a".repeat(64),
    objectiveVersion: "objective-v1",
    proposedChanges: [{ surface: "longBarTickEvery", currentValue: 1, proposedValue: 2 }],
    reasonEvidence: ["trial-" + seed],
    metaPartition: "meta-train",
    createdAt: "2026-10-18T00:00:00.000Z",
    sourceCommit: "8f07be1ef01a0a55f63a624325f4c3ac0f767d00",
    runtimeIdentity: "runtime-test",
    ...overrides,
  });
}

describe("Integrated chain - the two lanes join only here", () => {
  it("carries both lanes into one input set while keeping their digests distinct", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const result = chain.run(cycle("a"), ports({ value: 1 }));
      const inputSet = result.inputSetReceipt.inputSet;

      assert.deepEqual([...inputSet.researchEvidenceRecordIds], ["trial-a"], "research lane arrived intact");
      assert.deepEqual([...inputSet.paperEvidenceRecordIds], ["paper-a"], "performance lane arrived intact");
      assert.notEqual(inputSet.researchLaneDigest, inputSet.performanceLaneDigest, "the lanes stay separable even when joined");
      assert.ok(inputSet.researchLaneDigest.length === 64 && inputSet.performanceLaneDigest.length === 64);

      // Everything downstream is derived from that joined set, referenced by identity.
      assert.equal(result.decisionReceipt.decision.learningInputSetFingerprint, result.inputSetReceipt.fingerprint, "the decision cites the joined set, not a lane");
      assert.equal(result.decisionReceipt.decision.learningCycleId, result.cycleId);
      assert.equal(result.cycleId, result.inputSetReceipt.learningCycleId);
      assert.equal(result.metaOosReceipt.assignment.learningCycleId, result.cycleId, "the partition is recorded against this cycle");
      assert.equal(result.metaOosReceipt.assignment.learningDecisionFingerprint, result.decisionReceipt.fingerprint);
    } finally {
      close();
    }
  });

  it("keeps every ledger on one canonical history", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const summaryBefore = { ...chain.summary() };
      assert.deepEqual(summaryBefore, { inputSets: 0, decisions: 0, applications: 0, assignments: 0 });

      chain.run(cycle("a"), ports({ value: 1 }));
      const after = chain.summary();
      // One input set, one decision, one assignment, one application - four views over one history,
      // not four histories that happen to agree.
      assert.deepEqual(after, { inputSets: 1, decisions: 1, applications: 1, assignments: 1 });
      assert.equal(evolution.list().length, 4, "exactly four durable records exist, one per ledger");
    } finally {
      close();
    }
  });
});

describe("Integrated chain - fail closed, then open only at the floor", () => {
  it("refuses the change while the partition has no completed cycles, and keeps the state untouched", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const state = { value: 1 };
      const result = chain.run(cycle("a"), ports(state));

      assert.equal(result.eligibility.eligible, false, "one completed cycle is below the owner-fixed floor");
      assert.equal(result.applicationReceipt.receipt.applicationOutcome, "REJECTED");
      assert.equal(state.value, 1, "nothing was written to the runtime");
      assert.match(result.status.metaEligibility ?? "", /^INELIGIBLE/, "the report states the refusal");
      assert.equal(result.status.latestLearningCycleId, result.cycleId);
      assert.equal(result.status.latestLearningDecisionFingerprint, result.decisionReceipt.fingerprint);
      assert.equal(result.status.latestApplicationFingerprint, result.applicationReceipt.fingerprint);
      assert.equal(result.status.applicationOutcome, "REJECTED");
    } finally {
      close();
    }
  });

  it("applies the bounded change on the cycle that reaches the floor, exactly once", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const state = { value: 1 };

      chain.run(cycle("a"), ports(state));
      chain.run(cycle("b"), ports(state));
      assert.equal(state.value, 1, "still below the floor");

      const third = chain.run(cycle("c"), ports(state));
      assert.equal(third.eligibility.eligible, true, "the floor is now met by recorded assignments");
      assert.equal(third.eligibility.cyclesEvaluated, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);
      assert.equal(third.applicationReceipt.receipt.applicationOutcome, "APPLIED");
      assert.equal(state.value, 2, "the bounded change took effect once");
      assert.equal(chain.summary().applications, 3, "one application record per decision, none duplicated");
      assert.equal(chain.summary().assignments, META_MINIMUM_CYCLES_FOR_ELIGIBILITY);
      assert.match(third.status.metaEligibility ?? "", /^ELIGIBLE/, "the report and the behaviour agree");

      // The projected status is derivable from durable history alone, after the fact.
      assert.equal(chain.status().latestLearningCycleId, third.cycleId);
      assert.equal(chain.status().latestApplicationFingerprint, third.applicationReceipt.fingerprint);
    } finally {
      close();
    }
  });

  it("counts recorded assignments, never what a decision asserts for itself", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const result = chain.run(cycle("a"), ports({ value: 1 }));
      // The chain derives the count from assignments it has actually recorded for this partition;
      // the decision only states which partition it belongs to.
      assert.equal(result.decisionReceipt.decision.metaOosPartition, "meta-train");
      assert.equal(chain.metaPartitionCount("meta-train"), 1);
      assert.equal(result.eligibility.cyclesEvaluated, 1, "eligibility and the recorded count agree");
      assert.equal(result.eligibility.eligible, false, "one is not three");
    } finally {
      close();
    }
  });
});

describe("Integrated chain - restart safety", () => {
  it("rehydrates from durable history and replays without appending anything", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const first = new ClosedLearningChain(evolution, holdouts, now);
      const state = { value: 1 };
      const original = first.run(cycle("a"), ports(state));
      assert.equal(original.applicationReceipt.receipt.applicationOutcome, "REJECTED", "below the floor, so state never moved");
      const recordsAfterFirst = evolution.list().length;

      // A whole new chain object over the same store: this is what a process restart looks like.
      const restarted = new ClosedLearningChain(evolution, holdouts, now);
      assert.deepEqual(restarted.summary(), first.summary(), "the restarted chain sees exactly the same durable state");

      const replay = restarted.run(cycle("a"), ports(state));
      assert.equal(replay.inputSetReceipt.replayed, true, "the input set was already durable");
      assert.equal(replay.decisionReceipt.replayed, true, "the decision was already durable");
      assert.equal(replay.metaOosReceipt.replayed, true, "the partition assignment was already durable");
      assert.equal(evolution.list().length, recordsAfterFirst, "replay appended nothing");
      assert.equal(state.value, 1, "and changed nothing");
      assert.equal(replay.cycleId, original.cycleId, "cycle identity is stable across a restart");
      assert.equal(replay.decisionReceipt.fingerprint, original.decisionReceipt.fingerprint);
      assert.equal(replay.applicationReceipt.fingerprint, original.applicationReceipt.fingerprint, "application identity survived the restart");
    } finally {
      close();
    }
  });

  it("refuses a second chain over the same store only by construction, not by silently diverging", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      chain.run(cycle("a"), ports({ value: 1 }));
      // A second instance sees the identical history, so it cannot act as a fresh independent store.
      const second = new ClosedLearningChain(evolution, holdouts, now);
      assert.equal(second.summary().applications, chain.summary().applications, "both instances report the same durable application history");
      assert.equal(evolution.list().length, chain.summary().inputSets + chain.summary().decisions + chain.summary().applications + chain.summary().assignments);
    } finally {
      close();
    }
  });
});

describe("Integrated chain - holdout claims go through the shared ledger", () => {
  it("refuses a second cycle on a holdout result that was already observed, leaving the chain intact", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      const first = chain.run(cycle("h1", { metaPartition: "meta-holdout", metaPartitionIdentity: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-1" }), ports({ value: 1 }));
      assert.equal(first.metaOosReceipt.assignment.partition, "meta-holdout");
      assert.ok(first.metaOosReceipt.assignment.holdoutClaimIdentity, "the claim the cycle consumed is recorded");
      assert.ok(holdouts.isUsed(HOLDOUT), "the shared holdout truth source now knows it was observed");

      const before = evolution.list().length;
      assert.throws(
        () => chain.run(cycle("h2", { metaPartition: "meta-holdout", metaPartitionIdentity: "meta-holdout", holdoutKey: HOLDOUT, holdoutEvaluationId: "eval-2" }), ports({ value: 1 })),
        /already been observed|already used/,
        "reusing it is contamination and fails closed",
      );

      const after = chain.summary();
      assert.equal(after.inputSets, 2, "the input set that reached the join is durable evidence in its own right");
      assert.equal(after.assignments, 1, "but the contaminated cycle never became an assignment");
      assert.equal(after.decisions, 1, "and no decision was derived from it");
      assert.equal(evolution.list().length, before + 1, "exactly the input set was appended before the refusal");
    } finally {
      close();
    }
  });

  it("requires a holdout key for a meta-holdout partition before anything downstream runs", () => {
    const { evolution, holdouts, now, close } = fixture();
    try {
      const chain = new ClosedLearningChain(evolution, holdouts, now);
      assert.throws(() => chain.run(cycle("h3", { metaPartition: "meta-holdout", metaPartitionIdentity: "meta-holdout" }), ports({ value: 1 })), /requires a holdout key/);
      assert.equal(chain.summary().decisions, 0, "no decision without a claimed partition");
      assert.equal(chain.summary().applications, 0, "no application without a decision");
    } finally {
      close();
    }
  });
});
