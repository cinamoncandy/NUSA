const test = require("node:test");
const assert = require("node:assert/strict");
const { VersionedJsonStore, persistenceChecksum } = require("../dist/apps/mobile/src/mobilePersistence.js");
const { WatchlistRepository } = require("../dist/apps/mobile/src/watchlist.js");
const { JsonPortfolioRepository, JsonOrderHistoryRepository, VersionedSettingsRepository } = require("../dist/apps/mobile/src/persistenceRepositories.js");
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

test("portfolio, order history, and settings persist through versioned repositories", async () => {
  const s = storage();
  const portfolio = { quoteCurrency: "KRW", cash: 100, assetValue: 0, equity: 100, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, assets: [] };
  const orders = [{ id: "o-1", market: "KRW-BTC", side: "BUY", quantity: 1, price: 100, fee: 0, filledAt: "2026-08-03T00:00:00.000Z", status: "FILLED" }];
  await new JsonPortfolioRepository(s).save(portfolio);
  await new JsonOrderHistoryRepository(s).save(orders);
  await new VersionedSettingsRepository(s).save({ theme: "DARK", locale: "ko-KR", notifications: { enabled: true, riskAlerts: true, orderUpdates: true } });
  assert.equal((await new JsonPortfolioRepository(s).load()).equity, 100);
  assert.equal((await new JsonOrderHistoryRepository(s).load()).length, 1);
  assert.equal((await new VersionedSettingsRepository(s).load()).theme, "DARK");
});

test("settings migrate version zero and rollback when migration fails", async () => {
  const s = storage();
  s.values["nusa:app-settings:v1"] = JSON.stringify({ version: 0, value: { theme: "LIGHT", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true } }, checksum: persistenceChecksum({ theme: "LIGHT", locale: "en-US", notifications: { enabled: true, riskAlerts: false, orderUpdates: true } }) });
  assert.equal((await new VersionedSettingsRepository(s).load()).locale, "en-US");
  s.values["nusa:app-settings:v1"] = "corrupt";
  s.values["nusa:app-settings:v1:backup"] = JSON.stringify({ version: 1, value: { theme: "DARK", locale: "ko-KR", notifications: { enabled: true, riskAlerts: true, orderUpdates: true } }, checksum: persistenceChecksum({ theme: "DARK", locale: "ko-KR", notifications: { enabled: true, riskAlerts: true, orderUpdates: true } }) });
  assert.equal((await new VersionedSettingsRepository(s).load()).theme, "DARK");
});
