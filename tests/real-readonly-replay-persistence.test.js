const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { RealReadOnlyEventRecorder, mergeRealReadOnlyEvents } = require("../dist/apps/cloud/src/realReadOnlyObservabilityPersistence.js");

const event = (id, occurredAt, sequence = 1) => ({ id, sequence, mode: "REAL_READ_ONLY", eventType: "ACCOUNT_REFRESH", occurredAt, reason: "safe observation", reasonCodes: ["REFRESH_OK"] });
const dbPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nusa-real-readonly-")), "cloud.sqlite");

test("REAL_READ_ONLY replay survives restart and suppresses overlap", () => {
  const filename = dbPath();
  const first = new RealReadOnlyEventRecorder({ persistencePath: filename, maximumEvents: 10 });
  first.record(event("a", 20)); first.record(event("b", 10, 2)); first.close();
  const second = new RealReadOnlyEventRecorder({ persistencePath: filename, maximumEvents: 10 });
  second.record(event("a", 20));
  assert.deepEqual(second.replay().map((item) => [item.id, item.sequence]), [["b", 1], ["a", 2]]);
  second.close();
});

test("REAL_READ_ONLY ordering is independent of input order and conflicting identity fails closed", () => {
  assert.deepEqual(mergeRealReadOnlyEvents([event("z", 3), event("a", 1), event("m", 2)]).map((item) => item.id), ["a", "m", "z"]);
  assert.throws(() => mergeRealReadOnlyEvents([event("same", 1), { ...event("same", 1), reason: "different" }]), /identity conflict/);
});

test("REAL_READ_ONLY retention is bounded and deterministic", () => {
  const recorder = new RealReadOnlyEventRecorder({ maximumEvents: 2 });
  recorder.record(event("a", 1)); recorder.record(event("b", 2)); recorder.record(event("c", 3));
  assert.deepEqual(recorder.replay().map((item) => item.id), ["b", "c"]);
  recorder.close();
});

test("malformed or unsafe persisted REAL_READ_ONLY evidence is rejected", () => {
  const filename = dbPath();
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE real_readonly_observability_events (event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL)");
  db.prepare("INSERT INTO real_readonly_observability_events VALUES (?, ?, ?, ?, ?)").run("bad", 1, 1, JSON.stringify({ ...event("bad", 1), reason: "bad" }), "not-a-valid-hash");
  db.close();
  const recorder = new RealReadOnlyEventRecorder({ persistencePath: filename });
  assert.deepEqual(recorder.replay(), []);
  recorder.close();
});

test("REAL_READ_ONLY persistence has no execution/accounting mutation surface", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "apps/cloud/src/realReadOnlyObservabilityPersistence.ts"), "utf8");
  assert.doesNotMatch(source, /OrderRequest|placeOrder|cancelOrder|withdraw|transfer|productionMutationAllowed\s*=\s*true/);
});
