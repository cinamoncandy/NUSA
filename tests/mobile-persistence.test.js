const test = require("node:test");
const assert = require("node:assert/strict");
const { VersionedJsonStore, persistenceChecksum } = require("../dist/apps/mobile/src/mobilePersistence.js");
const { WatchlistRepository } = require("../dist/apps/mobile/src/watchlist.js");
const storage = (seed = {}) => ({ values: { ...seed }, async getItem(key) { return this.values[key] ?? null; }, async setItem(key, value) { this.values[key] = value; } });

test("versioned persistence creates backups and recovers corrupted primary data", async () => {
  const s = storage(); const store = new VersionedJsonStore(s, "portfolio", 1, (value) => { if (!value || typeof value !== "object") throw new Error("invalid"); return value; });
  await store.save({ equity: 100 }); await store.save({ equity: 110 }); s.values.portfolio = "{corrupt";
  assert.deepEqual(await store.load(), { equity: 100 });
  assert.equal(persistenceChecksum({ equity: 110 }).length, 8);
});

test("watchlist persistence is versioned and restores from backup without losing the last valid state", async () => {
  const s = storage(); const repo = new WatchlistRepository(s); await repo.save(["KRW-BTC"]); await repo.save(["KRW-ETH"]); s.values["nusa:watchlist:v1"] = "bad";
  assert.deepEqual(await repo.load(), ["KRW-BTC"]);
});
