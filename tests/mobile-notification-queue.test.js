const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileNotificationQueue } = require("../dist/apps/mobile/src/notificationQueue.js");

const notification = (overrides = {}) => ({
  notificationId: "n-1", category: "RISK", severity: "WARNING", title: "Paper trading blocked", message: "Market data is stale.", createdAtMs: 10, expiresAtMs: 100, ...overrides
});

test("queues immutable notifications, deduplicates them, and filters expired entries", () => {
  const queue = new MobileNotificationQueue(2);
  assert.equal(queue.enqueue(notification()), true);
  assert.equal(queue.enqueue(notification()), false);
  assert.deepEqual(queue.list(50, true).map((item) => item.notificationId), ["n-1"]);
  assert.deepEqual(queue.list(100), []);
  assert.equal(queue.removeExpired(100), 1);
});

test("acknowledgement is explicit and idempotent", () => {
  const queue = new MobileNotificationQueue();
  queue.enqueue(notification({ expiresAtMs: null }));
  const first = queue.acknowledge("n-1", 20);
  const second = queue.acknowledge("n-1", 30);
  assert.equal(first.readAtMs, 20);
  assert.deepEqual(second, first);
  assert.equal(queue.list(30, true).length, 0);
});

test("invalid notification data and queue overflow fail closed", () => {
  const queue = new MobileNotificationQueue(1);
  assert.throws(() => queue.enqueue(notification({ expiresAtMs: 10 })), /expiry/);
  queue.enqueue(notification({ notificationId: "n-1", expiresAtMs: null }));
  assert.throws(() => queue.enqueue(notification({ notificationId: "n-2", expiresAtMs: null })), /full/);
  assert.throws(() => queue.acknowledge("missing", 1), /not queued/);
});
