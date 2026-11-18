"use strict";
// The streaming candle hasher must give exactly the digest of the one-shot function for every chunking: dataset identities depend on it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateResearchCandleSha256, createResearchCandleHasher } = require("../dist/packages/contracts/src/researchDatasetSemantics.js");

const candle = (i, extra = {}) => ({ market: "KRW-BTC", interval: "1m", openTime: 1_000_000 + i * 60_000, closeTime: 1_060_000 + i * 60_000, open: 100 + (i % 7), high: 108 + (i % 5), low: 95, close: 101.5 + (i % 3), volume: 10 + (i % 11), ...extra });

test("streaming hash equals the one-shot hash for every size and chunking", () => {
  for (const size of [0, 1, 2, 7, 1000, 4001]) {
    const candles = Array.from({ length: size }, (_, i) => candle(i, i % 4 === 0 ? { quoteVolume: 1234.5 + i, tradeCount: i } : {}));
    const expected = calculateResearchCandleSha256(candles);
    for (const chunk of [1, 3, 500, 4000, 10_000]) {
      const hasher = createResearchCandleHasher();
      for (let at = 0; at < candles.length; at += chunk) hasher.update(candles.slice(at, at + chunk));
      assert.equal(hasher.digest(), expected, `size ${size}, chunk ${chunk}`);
    }
  }
});

test("empty chunks are ignored and a finished hasher refuses more input", () => {
  const candles = Array.from({ length: 5 }, (_, i) => candle(i));
  const hasher = createResearchCandleHasher();
  hasher.update([]); hasher.update(candles.slice(0, 2)); hasher.update([]); hasher.update(candles.slice(2));
  assert.equal(hasher.digest(), calculateResearchCandleSha256(candles));
  assert.throws(() => hasher.update(candles), /already finished/);
  assert.throws(() => hasher.digest(), /already finished/);
});
