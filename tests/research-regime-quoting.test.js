"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { UPBIT_KRW_SPOT_SPEC } = require("../dist/apps/cloud/src/researchVenueSpec.js");
const { classifyRegime, regimeCandidateQuote, baselineQuote, compareOnSameInput } = require("../dist/apps/cloud/src/researchRegimeQuoting.js");

const book = (t, m, half = 5) => ({ t, bestBid: m - half, bestAsk: m + half });
const series = (mids, step = 1000) => mids.map((m, i) => book(i * step, m));
const flat = (n) => Array.from({ length: n }, (_, i) => 10000 + (i % 2 === 0 ? 0 : 1));

test("regimes: insufficient data, mean reversion, trend, high volatility, illiquid gap, wide spread", () => {
  assert.equal(classifyRegime(series(flat(19))), "INSUFFICIENT");
  assert.equal(classifyRegime(series(flat(20))), "MEAN_REVERT");
  assert.equal(classifyRegime(series(Array.from({ length: 20 }, (_, i) => 10000 + i * 3))), "TREND");
  assert.equal(classifyRegime(series(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 10000 : 10300)))), "HIGH_VOL");
  const gap = series(flat(20)); gap[10] = { ...gap[10], t: gap[10].t + 40_000 }; for (let i = 11; i < 20; i += 1) gap[i] = { ...gap[i], t: gap[i].t + 40_000 };
  assert.equal(classifyRegime(gap), "ILLIQUID_EVENT");
  assert.equal(classifyRegime(series(flat(20)).map((b) => ({ ...b, bestBid: 9900, bestAsk: 10100 }))), "ILLIQUID_EVENT");
});

test("candidate fails closed without a clear regime and only reduces inventory in a trend", () => {
  const q = regimeCandidateQuote(2, 5);
  const feed = series(flat(19)); let last;
  for (const b of feed) last = q(b, 0);
  assert.equal(last, null, "fewer than the window: no quote");
  const t = regimeCandidateQuote(2, 5); let out;
  for (const b of series(Array.from({ length: 25 }, (_, i) => 10000 + i * 3))) out = t(b, 0);
  assert.equal(out, null, "trend and flat inventory: no quote");
  const t2 = regimeCandidateQuote(2, 5);
  for (const b of series(Array.from({ length: 25 }, (_, i) => 10000 + i * 3))) out = t2(b, 1);
  assert.ok(out.ask > 0 && out.bid === undefined, "trend with inventory: only the reducing ask");
});

test("same-input comparison: blocked without assumptions, INSUFFICIENT with few fills, never independent", () => {
  const books = series(flat(40));
  const trades = [{ t: 25_000, price: 9990, volume: 1, side: "ASK" }];
  assert.equal(compareOnSameInput({ spec: UPBIT_KRW_SPOT_SPEC, assumptions: [], books, trades, size: 2, maxInventory: 5 }).status, "BLOCKED");
  const r = compareOnSameInput({ spec: UPBIT_KRW_SPOT_SPEC, assumptions: ["SINGLE_LISTED_FEE", "QUANTITY_STEP_IGNORED"], books, trades, size: 2, maxInventory: 5 });
  assert.equal(r.status, "COMPARED"); assert.equal(r.verdict, "INSUFFICIENT");
  assert.equal(r.baseline.independent, false); assert.equal(r.candidate.independent, false);
  assert.match(r.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(typeof baselineQuote(1)(books[0], 0).bid, "number");
});
