"use strict";
// Durable canonical permit store (design section 3): append-only, latest-wins replay guard that survives restarts, evidence
// that must exist and belong to the intent, corruption and storage failure refuse. Not wired into the runtime.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { PaperTradePermissionStoreWriter, PaperTradePermissionStoreReader, permitSha256 } = require("../dist/apps/cloud/src/paperTradePermissionStore.js");
const { refusePaperTradePermission } = require("../dist/apps/cloud/src/paperTradePermissionGuard.js");
const kit = require("../dist/apps/cloud/src/testing/paperTradePermissionTestKit.js");

const Q = { decisionId: "paper-intent:abc", strategyId: "sma-5-20", market: "KRW-BTC" };
const sha = "a".repeat(64);
const item = (reference = "test-evidence-1") => ({ reference, kind: "MARKET_STATE", source: "test", observedAt: "1970-01-01T00:00:00.000Z", contentSha256: sha });
const readerFor = (db, over = {}) => new PaperTradePermissionStoreReader(db.connection, { policy: kit.testPermissionPolicy(), probabilityModelVersion: kit.TEST_MODEL_VERSION, ...over });
const memoryDb = () => new SqliteDatabase(":memory:");

test("append then read: the guard accepts a record that came back from the store (end to end with the real engine)", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const record = kit.testRecord(Q);
  const sequence = writer.append(record, [item()], "2026-11-16T00:00:00.000Z");
  assert.ok(sequence >= 1);
  const reader = readerFor(db);
  assert.deepEqual(reader.latestPermit(Q), record);
  assert.equal(refusePaperTradePermission(reader, Q, 5), null);
  db.close();
});

test("nothing for an unknown intent; evidence of another intent does not count", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  writer.append(kit.testRecord(Q), [item()], "2026-11-16T00:00:00.000Z");
  const reader = readerFor(db);
  assert.equal(reader.latestPermit({ ...Q, decisionId: "paper-intent:other" }), null);
  assert.equal(reader.evidenceExists(["test-evidence-1"], Q), true);
  assert.equal(reader.evidenceExists(["test-evidence-1"], { ...Q, decisionId: "paper-intent:other" }), false);
  assert.equal(reader.evidenceExists(["missing"], Q), false);
  assert.equal(reader.evidenceExists([], Q), false);
  assert.equal(refusePaperTradePermission(reader, { ...Q, decisionId: "paper-intent:other" }, 5), "PAPER_TRADE_PERMISSION_ABSENT");
  db.close();
});

test("latest wins: a newer REJECT supersedes an older PERMIT, and the older record is refused as a replay", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const older = kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:01.000Z" });
  writer.append(older, [item()], "2026-11-16T00:00:01.000Z");
  const reader = readerFor(db);
  assert.equal(reader.isLatest(older, Q), true);
  assert.equal(refusePaperTradePermission(reader, Q, 5_000), null);
  const reject = kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:02.000Z", governanceApproved: false });
  writer.append(reject, [], "2026-11-16T00:00:02.000Z");
  assert.equal(reader.isLatest(older, Q), false, "the older PERMIT is no longer the latest");
  assert.equal(reader.isLatest(reject, Q), true);
  assert.equal(refusePaperTradePermission(reader, Q, 5_000), "PAPER_TRADE_PERMISSION_NOT_PERMIT", "the latest record is the REJECT");
  // The older record handed to the guard by something else is a replay.
  const replayAuthority = { policy: reader.policy, probabilityModelVersion: reader.probabilityModelVersion, latestPermit: () => older, evidenceExists: (r, q) => reader.evidenceExists(r, q), isLatest: (r, q) => reader.isLatest(r, q) };
  assert.equal(refusePaperTradePermission(replayAuthority, Q, 5_000), "PAPER_TRADE_PERMISSION_REPLAYED");
  db.close();
});

test("append-only: records and evidence can be neither updated nor deleted", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  writer.append(kit.testRecord(Q), [item()], "2026-11-16T00:00:00.000Z");
  for (const sql of [
    "UPDATE trade_permission_records SET decision = 'REJECT'",
    "DELETE FROM trade_permission_records",
    "UPDATE trade_permission_evidence SET content_sha256 = '" + "b".repeat(64) + "'",
    "DELETE FROM trade_permission_evidence",
  ]) assert.throws(() => db.connection.exec(sql), /append-only/, sql);
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_records").get().n, 1);
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_evidence").get().n, 1);
  db.close();
});

test("the writer refuses bad input atomically: missing evidence, changed evidence, unbound input, bad time; nothing is written", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const count = () => [db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_records").get().n, db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_evidence").get().n];
  const record = kit.testRecord(Q);
  assert.throws(() => writer.append(record, [], "2026-11-16T00:00:00.000Z"), /not in the store and was not supplied/);
  assert.throws(() => writer.append(record, [{ ...item(), contentSha256: "short" }], "2026-11-16T00:00:00.000Z"), /SHA-256/);
  assert.throws(() => writer.append({ input: { ...record.input, decisionId: "other" }, permit: record.permit }, [item()], "2026-11-16T00:00:00.000Z"), /different intents/);
  assert.throws(() => writer.append(record, [item()], "not a time"), /ISO timestamp/);
  assert.throws(() => writer.append({ input: record.input, permit: { ...record.permit, evidenceReferences: [] } }, [], "2026-11-16T00:00:00.000Z"), /unique evidence references/);
  assert.deepEqual(count(), [0, 0]);
  // Atomic: the first reference is inserted, the second is missing; the whole append rolls back.
  const two = kit.testRecord(Q, { evidenceReferences: ["e1", "e2"] });
  assert.throws(() => writer.append(two, [item("e1")], "2026-11-16T00:00:00.000Z"), /e2 is not in the store/);
  assert.deepEqual(count(), [0, 0], "e1 was rolled back with the failed append");
  writer.append(record, [item()], "2026-11-16T00:00:00.000Z");
  assert.throws(() => writer.append(kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:03.000Z" }), [{ ...item(), contentSha256: "c".repeat(64) }], "2026-11-16T00:00:03.000Z"), /different content/);
  assert.deepEqual(count(), [1, 1], "a failed append leaves no partial row");
  // The same evidence content may be cited again by a newer record.
  writer.append(kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:03.000Z" }), [item()], "2026-11-16T00:00:03.000Z");
  assert.deepEqual(count(), [2, 1]);
  db.close();
});

test("corruption and storage failure refuse (throw), never accept", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  writer.append(kit.testRecord(Q), [item()], "2026-11-16T00:00:00.000Z");
  const reader = readerFor(db);
  assert.equal(refusePaperTradePermission(reader, Q, 5), null);
  // Corrupt the stored permit behind the triggers (as a damaged file would be).
  db.connection.exec("DROP TRIGGER trade_permission_records_no_update");
  db.connection.exec("UPDATE trade_permission_records SET permit_json = replace(permit_json, 'PERMIT', 'PERMIT ')");
  assert.throws(() => reader.latestPermit(Q), /does not match its hash/);
  assert.equal(refusePaperTradePermission(reader, Q, 5), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
  // A row whose columns disagree with its JSON.
  db.connection.exec("UPDATE trade_permission_records SET permit_json = replace(permit_json, 'PERMIT ', 'PERMIT')");
  db.connection.exec("UPDATE trade_permission_records SET market = 'KRW-ETH'");
  assert.throws(() => reader.latestPermit(Q), /does not match its row/);
  // No schema at all: the reader's queries throw.
  const empty = memoryDb();
  assert.equal(refusePaperTradePermission(readerFor(empty), Q, 5), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
  // A closed database: the reader's own queries throw.
  const closed = memoryDb(); closed.close();
  assert.equal(refusePaperTradePermission(readerFor(closed), Q, 5), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
  empty.close(); db.close();
});

test("survives a restart: a new reader on the reopened file still refuses the old record and accepts the latest", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-permit-store-"));
  const file = path.join(directory, "permits.sqlite");
  let db = new SqliteDatabase(file);
  try {
    const writer = new PaperTradePermissionStoreWriter(db);
    const older = kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:01.000Z" });
    const newer = kit.testRecord(Q, { generatedAt: "1970-01-01T00:00:02.000Z" });
    writer.append(older, [item()], "2026-11-16T00:00:01.000Z");
    writer.append(newer, [], "2026-11-16T00:00:02.000Z");
    db.close();
    db = new SqliteDatabase(file);
    const reader = readerFor(db);
    assert.equal(reader.isLatest(older, Q), false);
    assert.equal(reader.isLatest(newer, Q), true);
    const staleAuthority = { policy: reader.policy, probabilityModelVersion: reader.probabilityModelVersion, latestPermit: () => older, evidenceExists: (r, q) => reader.evidenceExists(r, q), isLatest: (r, q) => reader.isLatest(r, q) };
    assert.equal(refusePaperTradePermission(staleAuthority, Q, 5_000), "PAPER_TRADE_PERMISSION_REPLAYED");
    assert.equal(refusePaperTradePermission(reader, Q, 5_000), null);
    assert.equal(permitSha256(newer.permit), db.connection.prepare("SELECT permit_sha256 FROM trade_permission_records ORDER BY sequence DESC LIMIT 1").get().permit_sha256);
  } finally { try { db.close(); } catch {} fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("source: the reader only reads, the boundary and the runtime never import the store, nothing in production wires it", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  const store = read("apps/cloud/src/paperTradePermissionStore.ts");
  const reader = store.slice(store.indexOf("export class PaperTradePermissionStoreReader"));
  assert.doesNotMatch(reader, /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b|\.exec\(|\.run\(/, "the reader issues SELECT statements only");
  assert.match(reader, /handle: PermitStoreReadHandle/);
  for (const file of ["apps/cloud/src/cloudPaperExecutionBoundary.ts", "apps/cloud/src/paperTradePermissionGuard.ts", "apps/cloud/src/runtime.ts", "apps/cloud/src/closedLearningProductionRuntime.ts"]) {
    assert.doesNotMatch(read(file), /paperTradePermissionStore/, `${file} does not import the store`);
  }
  const offenders = [];
  const walk = (dir) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "testing") walk(p); } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "paperTradePermissionStore.ts" && fs.readFileSync(p, "utf8").includes("paperTradePermissionStore")) offenders.push(p); } };
  walk(path.join(__dirname, "..", "apps"));
  assert.deepEqual(offenders, [], "no production source imports the permit store yet");
});
