"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDayCandlePath, fetchCompletedDailyHistory } = require("./upbit-daily-history.js");

function candle(day) {
  const openTime = Date.UTC(2026, 0, day);
  return { market: "KRW-BTC", openTime, closeTime: openTime + 86_399_999 };
}

test("buildDayCandlePath encodes deterministic request parameters", () => {
  assert.equal(
    buildDayCandlePath({ market: "KRW-BTC", count: 200, to: "2026-01-03T00:00:00.000Z" }),
    "/v1/candles/days?market=KRW-BTC&count=200&to=2026-01-03T00%3A00%3A00.000Z"
  );
});

test("fetchCompletedDailyHistory paginates backward, deduplicates anchors, and preserves exact provenance", async () => {
  const pages = [
    [candle(10), candle(9), candle(8), candle(7)],
    [candle(7), candle(6), candle(5), candle(4)],
    [candle(4), candle(3), candle(2), candle(1)]
  ];
  const seenPaths = [];
  const result = await fetchCompletedDailyHistory({
    market: "KRW-BTC",
    targetCount: 8,
    completedBy: Date.UTC(2026, 0, 11),
    pageSize: 4,
    fetchPage: async (path) => {
      seenPaths.push(path);
      return pages.shift();
    },
    mapPage: (raw) => raw
  });

  assert.deepEqual(result.candles.map((entry) => new Date(entry.openTime).getUTCDate()), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(result.sourceRequests, seenPaths.map((path) => `GET ${path}`));
  assert.match(seenPaths[1], /to=2026-01-07T00%3A00%3A00.000Z/);
  assert.match(seenPaths[2], /to=2026-01-04T00%3A00%3A00.000Z/);
});

test("fetchCompletedDailyHistory fails closed when pagination stops moving backward", async () => {
  await assert.rejects(
    fetchCompletedDailyHistory({
      market: "KRW-BTC",
      targetCount: 4,
      completedBy: Date.UTC(2026, 0, 11),
      pageSize: 2,
      fetchPage: async () => [candle(10), candle(9)],
      mapPage: (raw) => raw
    }),
    /made no backward progress/
  );
});
