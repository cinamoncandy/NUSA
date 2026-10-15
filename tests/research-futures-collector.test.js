"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { ResearchFuturesCollector, researchFuturesCollectorEnabled } = require("../dist/apps/cloud/src/researchFuturesCollector.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteFuturesPublicStore } = require("../dist/packages/storage/src/futuresPublicStore.js");

const NOW = 1_800_000_000_000;
const calls = [];
function fetchStub({ premiumTime = NOW - 1000, symbolOverride } = {}) {
  return async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    const symbol = u.searchParams.get("symbol");
    const body = u.pathname === "/fapi/v1/premiumIndex" ? { symbol: symbolOverride ?? symbol, markPrice: "83000.5", indexPrice: "83001.0", lastFundingRate: "-0.0001", nextFundingTime: NOW + 3_600_000, time: premiumTime }
      : u.pathname === "/fapi/v1/fundingRate" ? [{ symbol, fundingTime: NOW - 8 * 3_600_000, fundingRate: "0.0001" }, { symbol, fundingTime: NOW + 999_999_999, fundingRate: "0.0001" }]
      : [[NOW - 8 * 3_600_000, "1", "2", "0.5", "1.5", "10", NOW - 4 * 3_600_000 - 1], [NOW - 3_600_000, "1", "2", "0.5", "1.5", "10", NOW + 10_000]];
    return { ok: true, json: async () => body };
  };
}
const rows = (db, sql) => db.connection.prepare(sql).all();

test("stores marks, funding and only CLOSED klines; future rows are rejected, public endpoints only", async () => {
  calls.length = 0;
  const db = new SqliteDatabase(":memory:");
  const c = new ResearchFuturesCollector(new SqliteFuturesPublicStore(db), { fetchImpl: fetchStub(), now: () => NOW });
  await c.collectOnce();
  const s = c.status();
  assert.equal(s.marksStored, 2); assert.equal(s.fundingStored, 2); assert.equal(s.klinesStored, 2); assert.equal(s.failures, 0);
  assert.equal(s.rejected, 2, "one future funding row per symbol");
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM research_futures_klines")[0].n, 2, "the forming candle is never stored");
  assert.equal(rows(db, "SELECT captured_at_ms FROM research_futures_marks")[0].captured_at_ms, NOW, "stamped with the observation time");
  assert.ok(calls.every((u) => u.startsWith("https://fapi.binance.com/fapi/v1/")), "only public market-data paths");
  await c.collectOnce();
  assert.equal(c.status().marksStored, 2, "same observation time is idempotent");
  db.close();
});

test("a wrong symbol or future exchange time is rejected and nothing is stored", async () => {
  for (const opts of [{ symbolOverride: "XRPUSDT" }, { premiumTime: NOW + 60_000 }]) {
    const db = new SqliteDatabase(":memory:");
    const c = new ResearchFuturesCollector(new SqliteFuturesPublicStore(db), { fetchImpl: fetchStub(opts), now: () => NOW });
    await c.collectOnce();
    assert.equal(c.status().marksStored, 0); assert.ok(c.status().rejected >= 2);
    db.close();
  }
});

test("HTTP failures are counted, never thrown; the kill switch disables it", async () => {
  const db = new SqliteDatabase(":memory:");
  const c = new ResearchFuturesCollector(new SqliteFuturesPublicStore(db), { fetchImpl: async () => ({ ok: false, status: 451, json: async () => ({}) }), now: () => NOW });
  await c.collectOnce();
  assert.ok(c.status().failures > 0); assert.equal(c.status().marksStored, 0);
  db.close();
  assert.equal(researchFuturesCollectorEnabled({ NUSA_RESEARCH_FUTURES_COLLECTOR: "DISABLED" }), false);
  assert.equal(researchFuturesCollectorEnabled({}), true);
});
