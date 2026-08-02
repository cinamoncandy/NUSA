const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { FileOfflineCache, NetworkStateMonitor, OfflineSynchronizationService } = require("../dist/apps/execution/src/offline-runtime.js");
const { offlineChecksum } = require("../dist/apps/execution/src/offline-engine.js");

async function temporaryCache() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-offline-")); return { root, file: path.join(root, "cache.json") }; }

test("durable cache survives close and reload with checksum validation", async () => {
  const { file } = await temporaryCache();
  const cache = new FileOfflineCache(file); cache.set("portfolio", { cash: 10 }, 1, 100); await cache.flush();
  const restored = new FileOfflineCache(file); await restored.load(); assert.deepEqual(restored.get("portfolio").value, { cash: 10 });
});

test("network detection blocks offline synchronization and permits recovery", async () => {
  let state = "OFFLINE";
  const { file } = await temporaryCache();
  const service = new OfflineSynchronizationService(new FileOfflineCache(file), new NetworkStateMonitor({ async probe() { return state; } }));
  await assert.rejects(() => service.synchronize([]), /requires a network/);
  state = "ONLINE";
  const result = await service.synchronize([{ entity: "portfolio", key: "p1", version: 1, updatedAtMs: 1, value: { cash: 20 }, checksum: offlineChecksum({ cash: 20 }) }]);
  assert.equal(result.state, "ONLINE"); assert.equal(result.applied[0].value.cash, 20);
});

test("synchronization resolves ordered conflicts and rejects ambiguous conflicts", async () => {
  const { file } = await temporaryCache(); const cache = new FileOfflineCache(file); cache.set("p1", { cash: 10 }, 1, 10);
  const service = new OfflineSynchronizationService(cache, new NetworkStateMonitor({ async probe() { return "ONLINE"; } }));
  const remote = { entity: "portfolio", key: "p1", version: 2, updatedAtMs: 1, value: { cash: 20 }, checksum: offlineChecksum({ cash: 20 }) };
  assert.equal((await service.synchronize([remote])).applied[0].value.cash, 20);
  cache.set("p2", { cash: 1 }, 1, 10);
  const ambiguous = { entity: "portfolio", key: "p2", version: 1, updatedAtMs: 10, value: { cash: 2 }, checksum: offlineChecksum({ cash: 2 }) };
  await assert.rejects(() => service.synchronize([ambiguous]), /conflicts/);
});
