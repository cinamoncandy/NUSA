"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createHistoricalDatasetManifest,
  verifyHistoricalDatasetManifest,
} = require("../dist/apps/desktop/src/cloud/researchDataset.js");

const DAY = 86_400_000;
const BASE = Date.parse("2026-08-01T00:00:00.000Z");

function candle(index) {
  const openTime = BASE + index * DAY;
  return {
    market: "KRW-BTC",
    interval: "1d",
    openTime,
    closeTime: openTime + DAY,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1,
  };
}

const candles = [candle(0), candle(1)];
const endCloseTime = candles.at(-1).closeTime;

test("manifest creation rejects explicit provenance time before the final candle existed", () => {
  assert.throws(
    () => createHistoricalDatasetManifest(candles, {
      source: "test-source",
      createdAt: new Date(endCloseTime - 1).toISOString(),
    }),
    /createdAt cannot precede the final candle closeTime/,
  );
});

test("manifest verification rejects a forged explicit provenance time before endCloseTime", () => {
  const valid = createHistoricalDatasetManifest(candles, {
    source: "test-source",
    createdAt: new Date(endCloseTime).toISOString(),
  });
  const forged = { ...valid, createdAt: new Date(endCloseTime - 1).toISOString() };
  assert.throws(
    () => verifyHistoricalDatasetManifest(forged, candles),
    /createdAt cannot precede the final candle closeTime/,
  );
});

test("manifest chronology allows equality and later explicit provenance timestamps", () => {
  for (const createdAt of [endCloseTime, endCloseTime + DAY]) {
    const manifest = createHistoricalDatasetManifest(candles, {
      source: "test-source",
      createdAt: new Date(createdAt).toISOString(),
    });
    assert.doesNotThrow(() => verifyHistoricalDatasetManifest(manifest, candles));
  }
});

test("legacy deterministic epoch sentinel remains valid", () => {
  const manifest = createHistoricalDatasetManifest(candles, { source: "test-source" });
  assert.equal(manifest.createdAt, "1970-01-01T00:00:00.000Z");
  assert.doesNotThrow(() => verifyHistoricalDatasetManifest(manifest, candles));
});
