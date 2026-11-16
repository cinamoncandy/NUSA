"use strict";
// Durable canonical permit store (design section 3): append-only, latest-wins replay guard that survives restarts, evidence
// that must exist and belong to the intent, corruption and storage failure refuse. Not wired into the runtime.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { DatabaseSync } = require("node:sqlite");
const { PaperTradePermissionStoreWriter, PaperTradePermissionStoreReader, permitSha256, evidenceReferenceFor } = require("../dist/apps/cloud/src/paperTradePermissionStore.js");
const { refusePaperTradePermission } = require("../dist/apps/cloud/src/paperTradePermissionGuard.js");
const kit = require("../dist/apps/cloud/src/testing/paperTradePermissionTestKit.js");

const Q = { decisionId: "paper-intent:abc", strategyId: "sma-5-20", market: "KRW-BTC" };
const item = (content = "market-state-snapshot-1") => ({ reference: evidenceReferenceFor(content), kind: "MARKET_STATE", source: "test", observedAt: "1970-01-01T00:00:00.000Z", content });
const REF = evidenceReferenceFor("market-state-snapshot-1");
const rec = (over = {}) => kit.testRecord(Q, { evidenceReferences: [REF], ...over });
const readerFor = (db, over = {}) => new PaperTradePermissionStoreReader(db.connection, { policy: kit.testPermissionPolicy(), probabilityModelVersion: kit.TEST_MODEL_VERSION, ...over });
const memoryDb = () => new SqliteDatabase(":memory:");

test("append then read: the guard accepts a record that came back from the store (end to end with the real engine)", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const record = rec();
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
  writer.append(rec(), [item()], "2026-11-16T00:00:00.000Z");
  const reader = readerFor(db);
  assert.equal(reader.latestPermit({ ...Q, decisionId: "paper-intent:other" }), null);
  assert.equal(reader.evidenceExists([REF], Q), true);
  assert.equal(reader.evidenceExists([REF], { ...Q, decisionId: "paper-intent:other" }), false);
  assert.equal(reader.evidenceExists(["missing"], Q), false);
  assert.equal(reader.evidenceExists([], Q), false);
  assert.equal(refusePaperTradePermission(reader, { ...Q, decisionId: "paper-intent:other" }, 5), "PAPER_TRADE_PERMISSION_ABSENT");
  db.close();
});

test("latest wins: a newer REJECT supersedes an older PERMIT, and the older record is refused as a replay", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const older = rec({ generatedAt: "1970-01-01T00:00:01.000Z" });
  writer.append(older, [item()], "2026-11-16T00:00:01.000Z");
  const reader = readerFor(db);
  assert.equal(reader.isLatest(older, Q), true);
  assert.equal(refusePaperTradePermission(reader, Q, 5_000), null);
  const reject = rec({ generatedAt: "1970-01-01T00:00:02.000Z", governanceApproved: false });
  writer.append(reject, [], "2026-11-16T00:00:02.000Z");
  // The old, still unexpired PERMIT cannot be re-appended above the newer REJECT (same record or an older one).
  assert.throws(() => writer.append(older, [], "2026-11-16T00:00:03.000Z"), /strictly newer/);
  assert.throws(() => writer.append(reject, [], "2026-11-16T00:00:04.000Z"), /strictly newer/, "not even the same record twice");
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_records").get().n, 2);
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
  writer.append(rec(), [item()], "2026-11-16T00:00:00.000Z");
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

test("the writer refuses bad input atomically: missing or non content-addressed evidence, unbound input, bad time; nothing is written", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  const count = () => [db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_records").get().n, db.connection.prepare("SELECT COUNT(*) AS n FROM trade_permission_evidence").get().n];
  const record = rec();
  assert.throws(() => writer.append(record, [], "2026-11-16T00:00:00.000Z"), /not in the store and was not supplied/);
  assert.throws(() => writer.append(record, [{ ...item(), content: "" }], "2026-11-16T00:00:00.000Z"), /needs its content/);
  assert.throws(() => writer.append(record, [{ ...item(), reference: "market-state-snapshot-1" }], "2026-11-16T00:00:00.000Z"), /not the hash of its content/);
  assert.throws(() => writer.append(record, [{ ...item(), content: "other content" }], "2026-11-16T00:00:00.000Z"), /not the hash of its content/);
  assert.throws(() => writer.append({ input: { ...record.input, decisionId: "other" }, permit: record.permit }, [item()], "2026-11-16T00:00:00.000Z"), /different intents/);
  assert.throws(() => writer.append(record, [item()], "not a time"), /ISO timestamp/);
  assert.throws(() => writer.append({ input: record.input, permit: { ...record.permit, evidenceReferences: [] } }, [], "2026-11-16T00:00:00.000Z"), /unique evidence references/);
  assert.deepEqual(count(), [0, 0]);
  // Atomic: the first reference is inserted, the second is missing; the whole append rolls back.
  const second = evidenceReferenceFor("second-item");
  const two = kit.testRecord(Q, { evidenceReferences: [REF, second] });
  assert.throws(() => writer.append(two, [item()], "2026-11-16T00:00:00.000Z"), /is not in the store and was not supplied/);
  assert.deepEqual(count(), [0, 0], "the first evidence item was rolled back with the failed append");
  writer.append(record, [item()], "2026-11-16T00:00:00.000Z");
  assert.deepEqual(count(), [1, 1]);
  // The same evidence may be cited again by a newer record without being supplied again.
  writer.append(rec({ generatedAt: "1970-01-01T00:00:03.000Z" }), [], "2026-11-16T00:00:03.000Z");
  assert.deepEqual(count(), [2, 1]);
  db.close();
});

test("corruption and storage failure refuse (throw), never accept", () => {
  const db = memoryDb();
  const writer = new PaperTradePermissionStoreWriter(db);
  writer.append(rec(), [item()], "2026-11-16T00:00:00.000Z");
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
  // The decision column disagreeing with the permit (a PERMIT row relabelled, or the other way round).
  db.connection.exec("UPDATE trade_permission_records SET market = 'KRW-BTC'");
  db.connection.exec("UPDATE trade_permission_records SET decision = 'REJECT'");
  assert.throws(() => reader.latestPermit(Q), /does not match its row/);
  db.connection.exec("UPDATE trade_permission_records SET decision = 'PERMIT'");
  assert.equal(refusePaperTradePermission(reader, Q, 5), null, "restored rows are accepted again (the damage was the only problem)");
  // Evidence whose stored content no longer matches its address or its hash is not evidence.
  db.connection.exec("DROP TRIGGER trade_permission_evidence_no_update");
  db.connection.exec("UPDATE trade_permission_evidence SET content = 'edited'");
  assert.equal(reader.evidenceExists([REF], Q), false);
  assert.equal(refusePaperTradePermission(reader, Q, 5), "PAPER_TRADE_PERMISSION_EVIDENCE_UNVERIFIED");
  // Content and recorded hash edited together stay consistent with each other but no longer match the address.
  const editedSha = require("node:crypto").createHash("sha256").update("edited").digest("hex");
  db.connection.exec("UPDATE trade_permission_evidence SET content_sha256 = '" + editedSha + "'");
  assert.equal(reader.evidenceExists([REF], Q), false, "a consistent edit still fails the content address");
  db.connection.exec("UPDATE trade_permission_evidence SET content = 'market-state-snapshot-1'");
  db.connection.exec("UPDATE trade_permission_evidence SET content_sha256 = '" + "d".repeat(64) + "'");
  assert.equal(reader.evidenceExists([REF], Q), false, "a stored hash that disagrees with the content");
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
    const older = rec({ generatedAt: "1970-01-01T00:00:01.000Z" });
    const newer = rec({ generatedAt: "1970-01-01T00:00:02.000Z" });
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
    db.close();
    // The reader works on a REAL read-only connection, and that connection cannot write (what production wiring must provide).
    const readOnly = new DatabaseSync(file, { readOnly: true });
    try {
      const roReader = new PaperTradePermissionStoreReader(readOnly, { policy: kit.testPermissionPolicy(), probabilityModelVersion: kit.TEST_MODEL_VERSION });
      assert.equal(refusePaperTradePermission(roReader, Q, 5_000), null);
      assert.throws(() => readOnly.prepare("INSERT INTO trade_permission_evidence(decision_id, reference, kind, source, observed_at, content, content_sha256) VALUES('x','x','x','x','x','x','" + "a".repeat(64) + "')").run(), /readonly/i);
      assert.throws(() => readOnly.exec("DROP TRIGGER trade_permission_records_no_update"), /readonly/i);
    } finally { readOnly.close(); }
    db = new SqliteDatabase(file);
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
