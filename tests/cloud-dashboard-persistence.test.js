const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const {
  SqliteCloudDashboardSnapshotRepository,
  CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION
} = require("../dist/apps/cloud/src/cloudDashboardSnapshotRepository.js");
const { DurableCloudDashboardStateProvider } = require("../dist/apps/cloud/src/durableCloudDashboardStateProvider.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");

const input = (now = 100) => ({
  now,
  mode: "PAPER",
  killSwitchActive: true,
  overallHealth: "DOWN",
  headline: "Safe paper dashboard",
  issues: ["No market data"],
  portfolio: {
    allocations: [], deployedCapital: 0, cashCapital: 0, reservedCapital: 0,
    grossShare: 0, futuresShare: 0, decidedAt: now
  },
  decisions: [],
  intelligence: { signals: [], staleSources: [], generatedAt: now }
});

test("cloud dashboard snapshot round trip preserves payload and provenance", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudDashboardSnapshotRepository(db);
  const snapshot = {
    schemaVersion: CLOUD_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    sourceCommit: "commit-1",
    sourceVersion: "test",
    generatedAt: 100,
    savedAt: 110,
    payload: input()
  };
  repository.save(snapshot);
  assert.deepEqual(repository.loadLatest(), snapshot);
  repository.close();
  repository.close();
});

test("corrupt and unsupported snapshots are rejected fail-closed", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudDashboardSnapshotRepository(db);
  repository.save({ schemaVersion: 1, sourceCommit: "commit-1", sourceVersion: "test", generatedAt: 100, savedAt: 110, payload: input() });
  db.connection.prepare("UPDATE cloud_dashboard_snapshots SET payload_json = ? WHERE snapshot_id = 'latest'").run("{not-json");
  assert.equal(repository.loadLatest(), undefined);
  repository.save({ schemaVersion: 1, sourceCommit: "commit-1", sourceVersion: "test", generatedAt: 100, savedAt: 110, payload: input() });
  db.connection.prepare("UPDATE cloud_dashboard_snapshots SET schema_version = 999 WHERE snapshot_id = 'latest'").run();
  assert.equal(repository.loadLatest(), undefined);
  repository.close();
});

test("restart recovery restores only a stale, kill-switched PAPER state", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudDashboardSnapshotRepository(db);
  const firstMemory = new InMemoryCloudDashboardStateProvider();
  const first = new DurableCloudDashboardStateProvider(firstMemory, repository, "commit-1", "test", () => 110);
  first.set(input(100));

  const secondMemory = new InMemoryCloudDashboardStateProvider();
  const second = new DurableCloudDashboardStateProvider(secondMemory, repository, "commit-1", "test", () => 120);
  assert.equal(second.recover(), true);
  const recovered = second.read({ userId: "operator", scopes: ["dashboard:read"] });
  assert.equal(recovered.mode, "PAPER");
  assert.equal(recovered.killSwitchActive, true);
  assert.equal(recovered.overallHealth, "DOWN");
  assert.equal(recovered.portfolio.deployedCapital, 0);
  assert.equal(recovered.portfolio.cashCapital, 0);
  assert.equal(recovered.decisions.every((decision) => decision.action === "WAIT"), true);
  second.close();
});

test("SQLite close and reopen preserves a recoverable snapshot", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-cloud-state-")), "state.db");
  const firstDb = new SqliteDatabase(filename);
  const firstRepository = new SqliteCloudDashboardSnapshotRepository(firstDb);
  firstRepository.save({ schemaVersion: 1, sourceCommit: "commit-1", sourceVersion: "test", generatedAt: 100, savedAt: 110, payload: input() });
  firstRepository.close();

  const secondDb = new SqliteDatabase(filename);
  const secondRepository = new SqliteCloudDashboardSnapshotRepository(secondDb);
  assert.equal(secondRepository.loadLatest().payload.mode, "PAPER");
  secondRepository.close();
});

test("stale snapshots are not recovered", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudDashboardSnapshotRepository(db);
  const memory = new InMemoryCloudDashboardStateProvider();
  const provider = new DurableCloudDashboardStateProvider(memory, repository, "commit-1", "test", () => 110);
  provider.set(input(100));
  memory.clear();
  const later = new DurableCloudDashboardStateProvider(memory, repository, "commit-1", "test", () => 24 * 60 * 60 * 1000 + 111);
  assert.equal(later.recover(), false);
  assert.equal(memory.read({ userId: "operator", scopes: ["dashboard:read"] }), undefined);
  later.close();
});

test("save failure clears the provider and does not report success", () => {
  const memory = new InMemoryCloudDashboardStateProvider();
  const repository = {
    save() { throw new Error("disk full"); },
    loadLatest() { return undefined; },
    clear() {},
    close() {}
  };
  const provider = new DurableCloudDashboardStateProvider(memory, repository, "commit-1", "test", () => 110);
  assert.throws(() => provider.set(input()), /disk full/);
  assert.equal(memory.read({ userId: "operator", scopes: ["dashboard:read"] }), undefined);
});
