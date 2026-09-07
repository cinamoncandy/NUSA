import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { ResearchFactoryDecisionHistoryRecord } from "../../contracts/src/researchFactoryDecisionHistory";
import {
  researchFactoryDecisionHistoryMigration,
  SqliteResearchFactoryDecisionHistoryRepository,
} from "./researchFactoryDecisionHistoryRepository";

class TestDatabase {
  readonly connection = new DatabaseSync(":memory:");
  transaction<T>(fn: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void { this.connection.close(); }
}

function record(
  evaluationId: string,
  outcome: ResearchFactoryDecisionHistoryRecord["outcome"],
  observedAt: number,
): ResearchFactoryDecisionHistoryRecord {
  return Object.freeze({
    candidateId: "candidate-1",
    evaluationId,
    outcome,
    reasons: Object.freeze([`reason:${outcome}`]),
    observedAt,
    authority: "PAPER_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function fixture() {
  const db = new TestDatabase();
  db.connection.exec(researchFactoryDecisionHistoryMigration.sql);
  return { db, repo: new SqliteResearchFactoryDecisionHistoryRepository(db) };
}

test("durably retains rejected, insufficient and qualified outcomes", () => {
  const { db, repo } = fixture();
  try {
    repo.append(record("eval-r", "REJECTED", 1));
    repo.append(record("eval-i", "INSUFFICIENT", 2));
    repo.append(record("eval-q", "QUALIFIED_FOR_LEAGUE", 3));
    const restored = new SqliteResearchFactoryDecisionHistoryRepository(db).state();
    assert.deepEqual(
      { total: restored.totalDecisions, rejected: restored.rejected, insufficient: restored.insufficient, qualified: restored.qualifiedForLeague },
      { total: 3, rejected: 1, insufficient: 1, qualified: 1 },
    );
  } finally { db.close(); }
});

test("exact replay is idempotent across repository restart", () => {
  const { db, repo } = fixture();
  try {
    const value = record("eval-1", "REJECTED", 10);
    assert.equal(repo.append(value).appended, true);
    const restarted = new SqliteResearchFactoryDecisionHistoryRepository(db);
    assert.equal(restarted.append(value).appended, false);
    assert.equal(restarted.state().totalDecisions, 1);
  } finally { db.close(); }
});

test("changed replay fails closed without denominator inflation", () => {
  const { db, repo } = fixture();
  try {
    repo.append(record("eval-1", "REJECTED", 10));
    assert.throws(
      () => repo.append(record("eval-1", "QUALIFIED_FOR_LEAGUE", 10)),
      /RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH/,
    );
    assert.equal(repo.state().totalDecisions, 1);
  } finally { db.close(); }
});

test("row corruption fails closed", () => {
  const { db, repo } = fixture();
  try {
    repo.append(record("eval-1", "REJECTED", 10));
    db.connection.prepare("UPDATE research_factory_decision_history SET record_json = ? WHERE evaluation_id = ?")
      .run("{}", "eval-1");
    assert.throws(() => repo.state(), /RESEARCH_FACTORY_HISTORY_LEDGER_INTEGRITY_VIOLATION/);
  } finally { db.close(); }
});

test("suffix deletion is detected by durable meta head and count", () => {
  const { db, repo } = fixture();
  try {
    repo.append(record("eval-1", "REJECTED", 10));
    repo.append(record("eval-2", "INSUFFICIENT", 11));
    db.connection.prepare("DELETE FROM research_factory_decision_history WHERE evaluation_id = ?").run("eval-2");
    assert.throws(() => repo.state(), /RESEARCH_FACTORY_HISTORY_LEDGER_META_MISMATCH/);
  } finally { db.close(); }
});

test("middle deletion is detected by sequence/hash chain", () => {
  const { db, repo } = fixture();
  try {
    repo.append(record("eval-1", "REJECTED", 10));
    repo.append(record("eval-2", "INSUFFICIENT", 11));
    repo.append(record("eval-3", "QUALIFIED_FOR_LEAGUE", 12));
    db.connection.prepare("DELETE FROM research_factory_decision_history WHERE evaluation_id = ?").run("eval-2");
    assert.throws(() => repo.state(), /RESEARCH_FACTORY_HISTORY_LEDGER_INTEGRITY_VIOLATION/);
  } finally { db.close(); }
});

test("forged authority is rejected before persistence", () => {
  const { db, repo } = fixture();
  try {
    const forged = { ...record("eval-1", "REJECTED", 10), aiAuthority: "FULL_AUTHORITY" } as unknown as ResearchFactoryDecisionHistoryRecord;
    assert.throws(() => repo.append(forged), /RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID/);
    assert.equal(repo.state().totalDecisions, 0);
  } finally { db.close(); }
});
