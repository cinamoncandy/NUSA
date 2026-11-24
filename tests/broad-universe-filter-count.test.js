"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { median, buildTiers, tickAt } = require("../scripts/broad-universe-filter-count.js");

/** Synthetic made-up markets only: current price and current tick size per market. */
const markets = [
  { market: "KRW-A", tickSize: "1" },
  { market: "KRW-B", tickSize: "1" },
  { market: "KRW-C", tickSize: "10" },
  { market: "KRW-D", tickSize: "10" },
  { market: "KRW-E", tickSize: "100" },
];
const prices = { "KRW-A": 1500, "KRW-B": 4000, "KRW-C": 15000, "KRW-D": 90000, "KRW-E": 500000 };

test("median of odd and even counts, unsorted input", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

test("tier table: lowest and highest current price seen per tick", () => {
  const t = buildTiers(markets, prices);
  assert.equal(t.lowest.get(1), 1500);
  assert.equal(t.highest.get(1), 4000);
  assert.equal(t.lowest.get(10), 15000);
  assert.equal(t.highest.get(10), 90000);
  assert.equal(t.lowest.get(100), 500000);
});

test("tick at a price: the lenient rule starts a tier at its lowest seen price, the strict rule at the highest seen price of the tier below", () => {
  const t = buildTiers(markets, prices);
  // between the tiers (4000 .. 15000): lenient already uses the lower tick below the next tier's lowest price
  assert.equal(tickAt(1600, t, "low"), 1);
  assert.equal(tickAt(14000, t, "low"), 1);
  assert.equal(tickAt(15000, t, "low"), 10);
  assert.equal(tickAt(14000, t, "high"), 10, "strict: above the highest price seen with tick 1 (4000), the next tick applies");
  assert.equal(tickAt(3999, t, "high"), 1);
  assert.equal(tickAt(600000, t, "low"), 100);
  assert.equal(tickAt(600000, t, "high"), 100);
});

test("the lenient rule never gives a larger tick than the strict rule", () => {
  const t = buildTiers(markets, prices);
  for (const p of [500, 1500, 3000, 5000, 14000, 20000, 95000, 200000, 700000]) assert.ok(tickAt(p, t, "low") <= tickAt(p, t, "high"), `price ${p}`);
});

test("the script prints counts only and writes no candle value", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "broad-universe-filter-count.js"), "utf8");
  assert.equal((src.match(/console\.log/g) || []).length, 1);
  assert.match(src, /console\.log\(JSON\.stringify\(out\.counts\)\)/);
  assert.doesNotMatch(src, /trade_price[^;]*console|console[^;]*trade_price/);
});

test("the script supports --tick-bp (default 10), records the tier table and a ticker snapshot hash, and gates on the strict count too", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "broad-universe-filter-count.js"), "utf8");
  assert.match(src, /DEFAULT_TICK_BP_MAX = 10/);
  assert.match(src, /--tick-bp/);
  assert.match(src, /tickerSnapshotSha256/);
  assert.match(src, /tierTable/);
  assert.match(src, /gateStrictAtLeast40: forwardAlt\.length >= 40/);
});
