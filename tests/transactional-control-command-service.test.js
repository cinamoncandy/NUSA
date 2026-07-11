const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteControlPlaneStore } = require("../dist/packages/storage/src/controlPlaneStore.js");
const { TransactionalControlCommandService } = require("../dist/apps/cloud/src/transactionalControlCommandService.js");

const runtime = (overrides = {}) => ({ mode: "STOPPED", killSwitchActive: false, healthy: true, ...overrides });
const request = (overrides = {}) => ({
  id: "cmd-1",
  userId: "user-1",
  deviceId: "device-1",
  type: "RESUME_PAPER",
  issuedAt: 100,
  expiresAt: 200,
  authStrength: "STRONG",
  reason: "owner request",
  ...overrides
});

const fixture = () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteControlPlaneStore(db);
  const service = new TransactionalControlCommandService(store);
  service.initialize(runtime());
  return { db, store, service };
};

test("persists an accepted command and reconstructs state after service restart", () => {
  const { db, store, service } = fixture();
  const result = service.execute(150, request());
  assert.equal(result.status, "ACCEPTED");
  assert.equal(store.load().runtime.mode, "PAPER");
  assert.equal(store.listAuditRecords().length, 1);

  const restarted = new TransactionalControlCommandService(new SqliteControlPlaneStore(db));
  restarted.verifyPersistedState();
  assert.equal(store.load().runtime.mode, "PAPER");
  db.close();
});

test("deduplicates a replayed command durably", () => {
  const { db, store, service } = fixture();
  service.execute(150, request());
  const duplicate = service.execute(160, request());
  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(store.load().runtime.mode, "PAPER");
  assert.equal(store.listAuditRecords().length, 2);
  service.verifyPersistedState();
  db.close();
});

test("persists emergency stop and kill switch atomically", () => {
  const { db, store, service } = fixture();
  service.execute(150, request());
  const stopped = service.execute(170, request({ id: "cmd-2", type: "EMERGENCY_STOP", issuedAt: 160, authStrength: "SESSION" }));
  assert.equal(stopped.status, "ACCEPTED");
  assert.equal(store.load().runtime.mode, "STOPPED");
  assert.equal(store.load().runtime.killSwitchActive, true);
  assert.equal(store.listAuditRecords().length, 2);
  db.close();
});

test("rolls back audit and runtime when audit persistence fails", () => {
  const { db, store, service } = fixture();
  db.connection.exec(`
    CREATE TRIGGER reject_control_audit BEFORE INSERT ON control_audit_records
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;
  `);
  assert.throws(() => service.execute(150, request()), /forced audit failure/);
  assert.equal(store.listAuditRecords().length, 0);
  assert.deepEqual(store.load().runtime, runtime());
  db.close();
});

test("fails closed when persisted runtime is inconsistent with audit replay", () => {
  const { db, service } = fixture();
  db.connection.prepare("UPDATE control_runtime_state SET mode = 'PAPER' WHERE singleton_id = 1").run();
  assert.throws(() => service.verifyPersistedState(), /mode does not match/);
  assert.throws(() => service.execute(150, request()), /mode does not match/);
  db.close();
});

test("is deterministic for rejected commands and stores the rejection", () => {
  const { db, store, service } = fixture();
  const weak = request({ authStrength: "SESSION" });
  const result = service.execute(150, weak);
  assert.equal(result.status, "REJECTED");
  assert.equal(store.load().runtime.mode, "STOPPED");
  assert.equal(store.listAuditRecords()[0].event.status, "REJECTED");
  service.verifyPersistedState();
  db.close();
});
