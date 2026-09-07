import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import type { ClosedLearningResearchReplayResult } from "./closedLearningResearchWorkerClient";
import { ClosedLearningResearchDecisionHistory } from "./closedLearningResearchDecisionHistory";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);

function replayResult(): ClosedLearningResearchReplayResult {
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: ORIGINAL,
    replayRunFingerprintSha256: REPLAY,
    qualification: Object.freeze({
      schemaVersion: 1,
      candidates: Object.freeze([
        Object.freeze({ candidateId: "rejected", outcome: "REJECTED" as const, reasons: Object.freeze(["FAIL"]), summary: "rejected" }),
        Object.freeze({ candidateId: "insufficient", outcome: "INSUFFICIENT" as const, reasons: Object.freeze(["MORE"]), summary: "insufficient" }),
        Object.freeze({ candidateId: "qualified", outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: Object.freeze([]), summary: "qualified" }),
      ]),
      coverage: Object.freeze({ candidateCount: 3, qualifiedCount: 1, insufficientCount: 1, rejectedCount: 1 }),
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    deployment: Object.freeze({
      schemaVersion: 1,
      status: "NOT_DEPLOYABLE",
      reasons: Object.freeze(["NO_ALLOCATION_ADVISORY"]),
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

test("persists the complete Research denominator into the canonical Cloud SQLite database", () => {
  const database = new SqliteDatabase(":memory:");
  try {
    const history = new ClosedLearningResearchDecisionHistory(database);
    const result = history.persist(replayResult(), 1_000);
    assert.equal(result.appended, 3);
    assert.equal(result.state.totalDecisions, 3);
    assert.equal(result.state.rejected, 1);
    assert.equal(result.state.insufficient, 1);
    assert.equal(result.state.qualifiedForLeague, 1);
    assert.deepEqual(result.state.records.map((record) => record.outcome), ["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]);
    assert.ok(result.state.records.every((record) => record.authority === "PAPER_ONLY" && record.liveAuthority === "NONE" && record.productionMutationAllowed === false && record.aiAuthority === "ZERO_AUTHORITY"));
    const migration = database.connection.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("021_research_factory_decision_history") as { id: string } | undefined;
    assert.equal(migration?.id, "021_research_factory_decision_history");
  } finally {
    database.close();
  }
});

test("identical replay is idempotent and preserves the first observation time", () => {
  const database = new SqliteDatabase(":memory:");
  try {
    const history = new ClosedLearningResearchDecisionHistory(database);
    history.persist(replayResult(), 1_000);
    const replay = history.persist(replayResult(), 2_000);
    assert.equal(replay.appended, 0);
    assert.equal(replay.state.totalDecisions, 3);
    assert.ok(replay.state.records.every((record) => record.observedAt === 1_000));
  } finally {
    database.close();
  }
});

test("changed denominator under an existing replay identity fails closed", () => {
  const database = new SqliteDatabase(":memory:");
  try {
    const history = new ClosedLearningResearchDecisionHistory(database);
    const initial = replayResult();
    history.persist(initial, 1_000);
    const changed: ClosedLearningResearchReplayResult = Object.freeze({
      ...initial,
      qualification: Object.freeze({
        ...initial.qualification,
        candidates: Object.freeze([
          Object.freeze({ candidateId: "rejected", outcome: "INSUFFICIENT" as const, reasons: Object.freeze(["CHANGED"]), summary: "changed" }),
          initial.qualification.candidates[1]!,
          initial.qualification.candidates[2]!,
        ]),
        coverage: Object.freeze({ candidateCount: 3, qualifiedCount: 1, insufficientCount: 2, rejectedCount: 0 }),
      }),
    });
    assert.throws(() => history.persist(changed, 2_000), /RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH/);
  } finally {
    database.close();
  }
});
