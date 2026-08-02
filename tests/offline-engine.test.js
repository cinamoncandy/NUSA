const test = require("node:test");
const assert = require("node:assert/strict");
const { OfflineCache, SyncQueue, ActionQueue, detectConflict, resolveConflict, offlineChecksum } = require("../dist/apps/execution/src/offline-engine.js");

test("cache is bounded and replaces records with checksums", () => {
  const cache = new OfflineCache(2);
  cache.set("a", { value: 1 }, 1, 1); cache.set("b", { value: 2 }, 1, 2); cache.set("c", { value: 3 }, 1, 3);
  assert.equal(cache.get("a"), undefined); assert.equal(cache.list().length, 2); assert.notEqual(cache.get("c").checksum, "");
});

test("sync queue is bounded and idempotent", () => {
  const queue = new SyncQueue(1); const item = { entity: "portfolio", key: "p1", version: 1, updatedAtMs: 1, value: { cash: 10 }, checksum: "" };
  assert.equal(queue.enqueue(item), true); assert.equal(queue.enqueue(item), false); assert.throws(() => queue.enqueue({ ...item, key: "p2" }), /full/); assert.deepEqual(queue.dequeue().value, { cash: 10 });
});

test("conflicts resolve deterministically by version then timestamp", () => {
  const cache = new OfflineCache(); const local = cache.set("p1", { cash: 10 }, 2, 20); const remote = { entity: "portfolio", key: "p1", value: { cash: 20 }, version: 3, updatedAtMs: 10, checksum: offlineChecksum({ cash: 20 }) };
  assert.equal(detectConflict(local, remote), "REMOTE_WINS"); assert.equal(resolveConflict(local, remote, "REMOTE_WINS").value.cash, 20);
  assert.throws(() => resolveConflict(local, remote, "CONFLICT"), /unresolved/);
});

test("action queue prevents duplicate actions, prioritizes safely, retries, and expires", () => {
  const queue = new ActionQueue();
  queue.enqueue({ actionId: "a", idempotencyKey: "k1", createdAtMs: 1, expiresAtMs: 100, priority: 1, value: { type: "refresh" } });
  queue.enqueue({ actionId: "b", idempotencyKey: "k2", createdAtMs: 2, expiresAtMs: 100, priority: 2, value: { type: "refresh" } });
  assert.equal(queue.enqueue({ actionId: "c", idempotencyKey: "k2", createdAtMs: 3, expiresAtMs: 100, priority: 3, value: {} }), false);
  assert.equal(queue.next(10).actionId, "b"); assert.equal(queue.retry("k2").retryCount, 1); queue.acknowledge("k2"); assert.equal(queue.next(200), undefined); assert.equal(queue.size, 0);
});
