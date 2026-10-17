import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteDatabase } from "./index";
import { SqlitePersistedPaperPeriodStore, type PersistedPaperPendingPeriod, type PaperPendingIneligibilityReason, type RealizedPeriodRetentionGuard } from "./persistedPaperPeriodStore";

// Retention is reference-aware by signature (v2 M1/A7); this fixture cites no periods.
const retentionGuard: RealizedPeriodRetentionGuard = { referencedRecordIds: () => new Set<string>() };

// Isolated contract fixtures, never runtime/canary evidence.
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
function pending(index = 21, start = 100, id = `period-${index}`): PersistedPaperPendingPeriod {
  const payloadJson = JSON.stringify({ schemaVersion: 1, periodId: id, periodIndex: index, periodStartAt: start, observations: [], observationIds: [] });
  return { periodId: id, periodIndex: index, periodStartAt: start, payloadJson, checksum: hash(payloadJson) };
}
function request() {
  return {
    original: pending(), successor: pending(22, 200),
    reason: { stage: "PERIOD_CLOSE", code: "INCOMPLETE_EXECUTION_COST_EVIDENCE", boundaryAt: 200, sourceRuntimeSha: null, blockedEvidenceFingerprintSha256: hash("original incomplete evidence") } satisfies PaperPendingIneligibilityReason,
  };
}
function memory(body: (db: SqliteDatabase, store: SqlitePersistedPaperPeriodStore) => void): void {
  const db = new SqliteDatabase(":memory:");
  try { body(db, new SqlitePersistedPaperPeriodStore(db)); } finally { db.close(); }
}
const raw = (db: SqliteDatabase, id = "period-21") => db.connection.prepare("SELECT * FROM research_paper_forward_period_pending WHERE period_id = ?").get(id) as Record<string, unknown>;

test("ineligible receipt preserves exact original bytes and cannot enter realized denominator", () => memory((db, store) => {
  const input = request(); store.putPending(input.original);
  const receipt = store.markPendingIneligible(input);
  assert.deepEqual(receipt.original, input.original);
  assert.deepEqual(receipt.reason, input.reason);
  assert.equal(receipt.validPerformanceEvidence, false);
  assert.equal(receipt.paperOnly, true); assert.equal(receipt.liveAuthority, "NONE");
  assert.equal(receipt.productionMutationAllowed, false); assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(store.getPending(input.original.periodId), undefined);
  assert.deepEqual(store.listPending(), [input.successor]);
  assert.deepEqual(store.list(), []);
  assert.equal(JSON.parse(String(raw(db).payload_json)).schemaVersion, 2); // Old producer validatePlan(schemaVersion=1) rejects rollback.
  store.prune(1, retentionGuard);
  assert.deepEqual(store.listPendingDispositions(), [receipt]);
}));

test("commit, close database, reopen another connection, replay returns identical disposition exactly once", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-disposition-")); const path = join(dir, "state.sqlite");
  const input = request(); let db = new SqliteDatabase(path);
  try {
    let store = new SqlitePersistedPaperPeriodStore(db); store.putPending(input.original);
    const committed = store.markPendingIneligible(input); db.close(); db = new SqliteDatabase(path);
    store = new SqlitePersistedPaperPeriodStore(db);
    assert.deepEqual(store.markPendingIneligible(input), committed);
    assert.equal(store.listPendingDispositions().length, 1); assert.equal(store.listPending().length, 1);
    // A successor may advance. Replaying its parent cannot reset those observations.
    const advanced = { ...input.successor, payloadJson: input.successor.payloadJson.replace('"observations":[]', '"observations":[{"status":"WAIT"}]') };
    store.updatePending({ ...advanced, checksum: hash(advanced.payloadJson) });
    assert.deepEqual(store.markPendingIneligible(input), committed);
    assert.equal(store.listPending()[0]!.payloadJson, advanced.payloadJson);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("transaction rollback after terminal UPDATE but before successor INSERT retains the ACTIVE original", () => memory((db, store) => {
  const input = request(); store.putPending(input.original);
  db.connection.exec("CREATE TRIGGER fail_successor BEFORE INSERT ON research_paper_forward_period_pending WHEN NEW.period_index=22 BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END");
  assert.throws(() => store.markPendingIneligible(input));
  assert.deepEqual(store.getPending(input.original.periodId), input.original);
  assert.deepEqual(store.listPendingDispositions(), []); assert.equal(store.listPending().length, 1);
  db.connection.exec("DROP TRIGGER fail_successor");
  store.markPendingIneligible(input);
  assert.equal(store.listPendingDispositions().length, 1); assert.equal(store.listPending().length, 1);
}));

test("stale observer and conflicting replay cannot change original failure identity", () => memory((_db, store) => {
  const input = request(); store.putPending(input.original);
  const changed = { ...input.original, payloadJson: input.original.payloadJson.replace('"observations":[]', '"observations":[1]') };
  store.updatePending({ ...changed, checksum: hash(changed.payloadJson) });
  assert.throws(() => store.markPendingIneligible(input), /changed before disposition/);
  const fresh = { ...input, original: store.getPending(input.original.periodId)! };
  const receipt = store.markPendingIneligible(fresh);
  assert.throws(() => store.markPendingIneligible({ ...fresh, reason: { ...fresh.reason, blockedEvidenceFingerprintSha256: hash("different") } }));
  assert.deepEqual(store.listPendingDispositions(), [receipt]);
}));

test("terminal history rejects stale UPDATE, DELETE, finalize and put replay", () => memory((db, store) => {
  const input = request(); store.putPending(input.original); store.markPendingIneligible(input);
  const terminalChecksum = String(raw(db).checksum);
  assert.throws(() => store.updatePending(input.original), /immutable/);
  assert.throws(() => store.retirePending(input.original.periodId, terminalChecksum), /immutable/);
  assert.throws(() => store.putPending(input.original));
  assert.throws(() => store.finalizePending(input.original.periodId, terminalChecksum, {} as never), /unavailable or changed/);
  assert.equal(String(raw(db).checksum), terminalChecksum);
}));

test("another connection replay is idempotent and conflicting writer cannot create a duplicate successor", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-disposition-cas-")); const path = join(dir, "state.sqlite");
  const first = new SqliteDatabase(path); const second = new SqliteDatabase(path);
  try {
    const a = new SqlitePersistedPaperPeriodStore(first); const b = new SqlitePersistedPaperPeriodStore(second);
    const input = request(); a.putPending(input.original); const stale = b.getPending(input.original.periodId)!;
    const receipt = a.markPendingIneligible(input);
    assert.deepEqual(b.markPendingIneligible({ ...input, original: stale }), receipt);
    assert.throws(() => b.markPendingIneligible({ ...input, successor: pending(22, 200, "other-successor") }));
    assert.equal(a.listPending().length, 1); assert.equal(a.listPendingDispositions().length, 1);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("bad checksums, noncanonical bounds, unknown codes, source SHA and extra secret fields fail before mutation", () => memory((_db, store) => {
  const input = request(); store.putPending(input.original);
  const invalid = [
    { ...input, original: { ...input.original, checksum: "0".repeat(64) } },
    { ...input, successor: pending(23, 200) },
    { ...input, successor: pending(22, 201) },
    { ...input, reason: { ...input.reason, boundaryAt: 100 } },
    { ...input, reason: { ...input.reason, sourceRuntimeSha: "candidate-code-is-not-runtime" } },
    { ...input, reason: { ...input.reason, code: "FAILED_STRATEGY" } },
    { ...input, reason: { ...input.reason, apiKey: true } },
  ];
  for (const value of invalid) {
    assert.throws(() => store.markPendingIneligible(value as typeof input));
    assert.deepEqual(store.getPending(input.original.periodId), input.original);
    assert.equal(store.listPendingDispositions().length, 0);
  }
}));

test("checksum or semantic corruption cannot silently hide failure history from recovery", () => memory((db, store) => {
  const input = request(); store.putPending(input.original); store.markPendingIneligible(input);
  const original = String(raw(db).payload_json);
  db.connection.prepare("UPDATE research_paper_forward_period_pending SET checksum=? WHERE period_id=?").run("0".repeat(64), input.original.periodId);
  assert.throws(() => store.listPending()); assert.throws(() => store.listPendingDispositions());
  const parsed = JSON.parse(original); parsed.validPerformanceEvidence = true; const poisoned = JSON.stringify(parsed);
  db.connection.prepare("UPDATE research_paper_forward_period_pending SET payload_json=?,checksum=? WHERE period_id=?").run(poisoned, hash(poisoned), input.original.periodId);
  assert.throws(() => store.listPending()); assert.throws(() => store.listPendingDispositions());
}));

test("an existing active successor or later history prevents a second branch of periods", () => memory((_db, store) => {
  const input = request(); store.putPending(input.original); store.putPending(pending(23, 300));
  assert.throws(() => store.markPendingIneligible(input), /overlap existing history/);
  assert.deepEqual(store.getPending(input.original.periodId), input.original);
  assert.equal(store.listPendingDispositions().length, 0);
}));

test("realized append cannot reuse a quarantined interval under a different identity or index", () => memory((_db, store) => {
  const input = request(); store.putPending(input.original); store.markPendingIneligible(input);
  const envelope = {
    record: {
      recordId: "different-period", periodIndex: 23, periodStartAt: 150, periodEndAt: 250,
      advisory: { schemaVersion: 1 as const, generatedAt: new Date(0).toISOString(), policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }, entries: [], excludedCandidateIds: [], reasons: [], provenance: { sourceDatasetIds: [] } },
      realizedReturns: {}, benchmarkReturn: 0, turnoverCostRate: 0, status: "COMPLETED" as const,
      costEvidence: { evidenceId: "isolated-test-cost", source: "PAPER_EXECUTION_RECEIPT" as const, evidenceKind: "OBSERVED" as const, evidenceFingerprintSha256: hash("test"), observedAt: 200, feeRate: 0, spreadRate: 0, slippageRate: 0 },
    }, candidateProvenance: [],
  };
  assert.throws(() => store.append(envelope), /cannot become realized performance/);
  assert.equal(store.list().length, 0); assert.equal(store.listPendingDispositions().length, 1);
}));
