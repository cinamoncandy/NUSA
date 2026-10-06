const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { retainObservation, OBSERVATION_RETENTION_PER_MARKET } = require("../dist/apps/cloud/src/observationRetention.js");

const MARKETS = ["KRW-XRP", "KRW-ADA", "KRW-SUI", "KRW-BTC", "KRW-ETH"];
const obs = (market, n) => ({ id: `${market}:${n}`, source: "CHART", market, price: 100 + n, observedAt: n });
const count = (store, market) => [...store.values()].filter((o) => o.market === market).length;

// The behaviour this replaces: one window of 50 shared by all markets.
function legacyRetain(store, observation) {
  store.set(observation.id, observation);
  while (store.size > 50) store.delete(store.keys().next().value);
}

test("with five markets every market reaches the 20 observations the SMA 5/20 strategy needs", () => {
  const store = new Map();
  for (let n = 1; n <= 100; n += 1) for (const market of MARKETS) retainObservation(store, obs(market, n));
  for (const market of MARKETS) assert.ok(count(store, market) >= 20, `${market} has ${count(store, market)}`);
});

test("the legacy shared window of 50 plateaus at 10 per market, which is the '10/20' the owner saw", () => {
  const store = new Map();
  for (let n = 1; n <= 100; n += 1) for (const market of MARKETS) legacyRetain(store, obs(market, n));
  for (const market of MARKETS) assert.equal(count(store, market), 10);
});

test("each market is capped on its own and the total is bounded", () => {
  const store = new Map();
  for (let n = 1; n <= 500; n += 1) for (const market of MARKETS) retainObservation(store, obs(market, n));
  for (const market of MARKETS) assert.equal(count(store, market), OBSERVATION_RETENTION_PER_MARKET);
  assert.equal(store.size, MARKETS.length * OBSERVATION_RETENTION_PER_MARKET);
});

test("a quiet market cannot be evicted by a busy one, and eviction drops the oldest first", () => {
  const store = new Map();
  for (let n = 1; n <= 5; n += 1) retainObservation(store, obs("KRW-SUI", n));
  for (let n = 1; n <= 1000; n += 1) retainObservation(store, obs("KRW-XRP", n));
  assert.equal(count(store, "KRW-SUI"), 5, "the quiet market keeps everything it has");
  assert.equal(count(store, "KRW-XRP"), OBSERVATION_RETENTION_PER_MARKET);
  const xrp = [...store.values()].filter((o) => o.market === "KRW-XRP").map((o) => o.observedAt);
  assert.equal(Math.min(...xrp), 1000 - OBSERVATION_RETENTION_PER_MARKET + 1, "only the newest remain");
});

test("the same trade seen twice is one observation, and a bad cap is rejected", () => {
  const store = new Map();
  retainObservation(store, obs("KRW-XRP", 1));
  retainObservation(store, obs("KRW-XRP", 1));
  assert.equal(store.size, 1);
  assert.throws(() => retainObservation(store, obs("KRW-XRP", 2), 0), /cap is invalid/);
  assert.throws(() => retainObservation(store, obs("KRW-XRP", 2), 1.5), /cap is invalid/);
});

test("the runtime uses the per-market retention, not a shared window", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /retainObservation\(observations, observation\)/);
  assert.doesNotMatch(runtime, /observations\.size > 50/);
});
