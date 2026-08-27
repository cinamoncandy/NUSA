"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createHistoricalDatasetManifest,
  runWalkForwardExperiment,
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

function dataset(createdAt) {
  return {
    candles,
    manifest: createHistoricalDatasetManifest(candles, {
      source: "test-source",
      ...(createdAt == null ? {} : { createdAt }),
    }),
  };
}

function assertGeneratedAtRejected(data, generatedAt, pattern) {
  assert.throws(
    () => runWalkForwardExperiment(data, [], {}, { generatedAt }),
    pattern,
  );
}

test("experiment rejects explicit generatedAt before the final candle existed", () => {
  assertGeneratedAtRejected(
    dataset(),
    new Date(endCloseTime - 1).toISOString(),
    /generatedAt cannot precede its dataset provenance/,
  );
});

test("experiment rejects generatedAt between final close and explicit manifest creation", () => {
  const manifestCreatedAt = endCloseTime + DAY;
  assertGeneratedAtRejected(
    dataset(new Date(manifestCreatedAt).toISOString()),
    new Date(manifestCreatedAt - 1).toISOString(),
    /generatedAt cannot precede its dataset provenance/,
  );
});

test("experiment rejects malformed explicit generatedAt before expensive walk-forward work", () => {
  assertGeneratedAtRejected(dataset(), "not-a-timestamp", /generatedAt must be a valid timestamp/);
});
