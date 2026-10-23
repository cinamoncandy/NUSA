import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { EvolutionLearningRecord } from "../../autopilot/src/evolveLearningMemory";
import { LearningSupersessionLedger } from "./supersessionLedger";
import { SupersessionError } from "./supersession";

const A = "a".repeat(64);
const B = "b".repeat(64);

function pathForTest(): string {
  return join(mkdtempSync(join(process.cwd(), ".nusa-supersession-")), "learning.db");
}

function cleanup(path: string): void {
  rmSync(dirname(path), { recursive: true, force: true });
}

test("A5 durable supersession replays the same edge after SQLite restart without a duplicate", () => {
  const filename = pathForTest();
  let db = new SqliteDatabase(filename);
  let evolution = new SqliteEvolutionLearningLedger(db);
  let supersession = new LearningSupersessionLedger(evolution, () => Date.parse("2026-10-22T00:00:00.000Z"));
  const stored = supersession.supersede({
    surface: "longBarTickEvery",
    previousDecisionFingerprint: A,
    nextDecisionFingerprint: B,
    reason: "bounded change validated in cycle 2",
    timestamp: "2026-10-22T00:00:00.000Z",
  });
  assert.equal(evolution.size(), 1);
  assert.equal(supersession.registry().successorOf(A, "longBarTickEvery")?.linkFingerprint, stored.linkFingerprint);
  db.close();

  db = new SqliteDatabase(filename);
  try {
    evolution = new SqliteEvolutionLearningLedger(db);
    supersession = new LearningSupersessionLedger(evolution, () => Date.parse("2026-10-23T00:00:00.000Z"));
    const replayed = supersession.supersede({
      surface: "longBarTickEvery",
      previousDecisionFingerprint: A,
      nextDecisionFingerprint: B,
      reason: "retry after process restart",
      timestamp: "2026-10-23T00:00:00.000Z",
    });
    assert.equal(replayed.linkFingerprint, stored.linkFingerprint);
    assert.equal(replayed.reason, stored.reason);
    assert.equal(evolution.size(), 1, "replay does not append a second link");
    assert.equal(evolution.replay().eventCount, 1);
    assert.equal(evolution.replay().headHash, evolution.headHash());
  } finally {
    db.close();
    cleanup(filename);
  }
});

test("A5 durable ledger rejects a second successor without rewriting the first link", () => {
  const filename = pathForTest();
  const db = new SqliteDatabase(filename);
  try {
    const evolution = new SqliteEvolutionLearningLedger(db);
    const supersession = new LearningSupersessionLedger(evolution, () => Date.parse("2026-10-22T00:00:00.000Z"));
    supersession.supersede({
      surface: "longBarTickEvery",
      previousDecisionFingerprint: A,
      nextDecisionFingerprint: B,
      reason: "first successor",
      timestamp: "2026-10-22T00:00:00.000Z",
    });
    assert.throws(() => supersession.supersede({
      surface: "longBarTickEvery",
      previousDecisionFingerprint: A,
      nextDecisionFingerprint: "c".repeat(64),
      reason: "conflicting successor",
      timestamp: "2026-10-22T00:01:00.000Z",
    }), /already has successor/);
    assert.equal(evolution.size(), 1);
    assert.equal(supersession.registry().successorOf(A, "longBarTickEvery")?.nextDecisionFingerprint, B);
  } finally {
    db.close();
    cleanup(filename);
  }
});

test("A5 validates the graph again inside the serialized append when another writer wins the race", () => {
  const filename = pathForTest();
  const db = new SqliteDatabase(filename);
  try {
    const evolution = new SqliteEvolutionLearningLedger(db);
    const racingPort = {
      list: () => evolution.list(),
      appendWithValidation: (
        record: EvolutionLearningRecord,
        validateCurrent: (records: readonly EvolutionLearningRecord[]) => void,
      ) => {
        // Simulate a competing canonical writer committing after this caller's initial
        // registry read but before its serialized append begins.
        new LearningSupersessionLedger(evolution, () => Date.parse("2026-10-22T00:00:00.000Z")).supersede({
          surface: "longBarTickEvery",
          previousDecisionFingerprint: A,
          nextDecisionFingerprint: "c".repeat(64),
          reason: "competing successor",
          timestamp: "2026-10-22T00:00:00.000Z",
        });
        return evolution.appendWithValidation(record, validateCurrent);
      },
    };
    const staleCaller = new LearningSupersessionLedger(racingPort, () => Date.parse("2026-10-22T00:00:00.000Z"));
    assert.throws(() => staleCaller.supersede({
      surface: "longBarTickEvery",
      previousDecisionFingerprint: A,
      nextDecisionFingerprint: B,
      reason: "stale competing successor",
      timestamp: "2026-10-22T00:00:00.000Z",
    }), (error: unknown) => error instanceof SupersessionError && error.code === "SUPERSESSION_FORK");
    assert.equal(evolution.size(), 1, "the losing claimant does not append a second successor");
    assert.equal(new LearningSupersessionLedger(evolution).registry().successorOf(A, "longBarTickEvery")?.nextDecisionFingerprint, "c".repeat(64));
  } finally {
    db.close();
    cleanup(filename);
  }
});
