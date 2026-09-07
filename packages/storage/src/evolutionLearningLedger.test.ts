import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createEvolutionLearningRecord, type EvolutionLearningRecord } from "../../../apps/autopilot/src/evolveLearningMemory";
import { SqliteDatabase } from "./index";
import { EvolutionLearningLedgerError, SqliteEvolutionLearningLedger } from "./evolutionLearningLedger";

const record = (opportunityId: string, recordedAt: string, overrides: Partial<EvolutionLearningRecord> = {}): EvolutionLearningRecord => createEvolutionLearningRecord({
  opportunityId,
  problem: "Repeated bounded validation latency",
  evidenceReferences: ["ci:validation", "runtime:healthy"],
  hypothesis: "A bounded change reduces the observed latency without weakening safety.",
  changeReference: "pr:evolution-ledger",
  validationStatus: "VERIFIED_IMPROVEMENT",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt,
  ...overrides,
});

function databasePath(): string {
  return join(mkdtempSync(join(process.cwd(), ".nusa-evolution-learning-")), "learning.db");
}

function removeDatabasePath(filename: string): void {
  rmSync(dirname(filename), { recursive: true, force: true });
}

test("evolution learning ledger survives restart and replays the same records", () => {
  const filename = databasePath();
  const firstDb = new SqliteDatabase(filename);
  const first = new SqliteEvolutionLearningLedger(firstDb);
  const a = first.append(record("opp:one", "2026-08-29T00:00:00.000Z"));
  const b = first.append(record("opp:two", "2026-08-29T00:01:00.000Z", { outcome: "PARTIAL_SUCCESS" }));
  const expectedHead = first.headHash();
  firstDb.close();

  const restartedDb = new SqliteDatabase(filename);
  try {
    const restarted = new SqliteEvolutionLearningLedger(restartedDb);
    assert.deepEqual(restarted.list(), [a, b]);
    assert.equal(restarted.headHash(), expectedHead);
    assert.equal(restarted.size(), 2);
  } finally {
    restartedDb.close();
    removeDatabasePath(filename);
  }
});

test("same opportunity and normalized payload is idempotent, but a different payload fails closed", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const original = record("opp:idempotent", "2026-08-29T00:00:00.000Z");
    const stored = ledger.append(original);
    const reordered = ledger.append({ ...original, evidenceReferences: [...original.evidenceReferences].reverse() });
    assert.deepEqual(reordered, stored);
    assert.equal(ledger.size(), 1);
    assert.throws(() => ledger.append({ ...original, problem: "A different observed problem" }), (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "IDENTITY_CONFLICT");
    assert.equal(ledger.size(), 1);
  } finally {
    db.close();
  }
});

test("canonical normalization gives equivalent input order the same chain hash", () => {
  const leftDb = new SqliteDatabase(":memory:");
  const rightDb = new SqliteDatabase(":memory:");
  try {
    const left = new SqliteEvolutionLearningLedger(leftDb);
    const right = new SqliteEvolutionLearningLedger(rightDb);
    const a = record("opp:stable", "2026-08-29T00:00:00.000Z");
    left.append(a);
    right.append({ ...a, evidenceReferences: [...a.evidenceReferences].reverse() });
    assert.equal(left.headHash(), right.headHash());
    assert.deepEqual(left.list(), right.list());
  } finally {
    leftDb.close();
    rightDb.close();
  }
});

test("chronology regression and bounded capacity fail closed without pruning history", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db, 1);
    ledger.append(record("opp:first", "2026-08-29T00:01:00.000Z"));
    assert.throws(() => ledger.append(record("opp:second", "2026-08-29T00:02:00.000Z")), /CAPACITY_EXCEEDED/);
    assert.equal(ledger.size(), 1);
  } finally {
    db.close();
  }

  const chronologyDb = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(chronologyDb);
    ledger.append(record("opp:later", "2026-08-29T00:02:00.000Z"));
    assert.throws(() => ledger.append(record("opp:earlier", "2026-08-29T00:01:00.000Z")), /CHRONOLOGY_REGRESSION/);
    assert.equal(ledger.size(), 1);
  } finally {
    chronologyDb.close();
  }
});

test("forbidden fields are rejected before they can be persisted", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const unsafe = { ...record("opp:secret", "2026-08-29T00:00:00.000Z") } as Record<string, unknown>;
    unsafe[["to", "ken"].join("")] = "redacted";
    assert.throws(() => ledger.append(unsafe as unknown as EvolutionLearningRecord), /FORBIDDEN_FIELD/);
    const count = db.connection.prepare("SELECT COUNT(*) AS count FROM evolution_learning_ledger_events").get() as { count: number };
    assert.equal(Number(count.count), 0);
    assert.equal(JSON.stringify(ledger.list()).includes("redacted"), false);
  } finally {
    db.close();
  }
});

test("malformed persisted payload is rejected during startup replay", () => {
  const filename = databasePath();
  const db = new SqliteDatabase(filename);
  const ledger = new SqliteEvolutionLearningLedger(db);
  ledger.append(record("opp:corrupt", "2026-08-29T00:00:00.000Z"));
  db.connection.prepare("UPDATE evolution_learning_ledger_events SET payload_json = ? WHERE opportunity_id = ?").run("{}", "opp:corrupt");
  db.close();

  const reopenedDb = new SqliteDatabase(filename);
  try {
    assert.throws(() => new SqliteEvolutionLearningLedger(reopenedDb), (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "CORRUPTED_LEDGER");
  } finally {
    reopenedDb.close();
    removeDatabasePath(filename);
  }
});

test("ledger exposes evidence persistence only and preserves zero authority", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    assert.equal("submitOrder" in ledger, false);
    assert.equal("cancelOrder" in ledger, false);
    assert.equal("activateLive" in ledger, false);
    assert.equal("productionMutationAllowed" in ledger, false);
  } finally {
    db.close();
  }
});
