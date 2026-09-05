"use strict";

const DEFAULT_PAGE_SIZE = 200;

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function buildDayCandlePath({ market, count, to }) {
  if (typeof market !== "string" || !market.trim()) throw new Error("market must be a non-empty string");
  assertPositiveInteger(count, "count");
  const base = `/v1/candles/days?market=${encodeURIComponent(market)}&count=${count}`;
  return to == null ? base : `${base}&to=${encodeURIComponent(to)}`;
}

async function fetchCompletedDailyHistory({
  market,
  targetCount,
  completedBy,
  fetchPage,
  mapPage,
  pageSize = DEFAULT_PAGE_SIZE
}) {
  if (typeof fetchPage !== "function") throw new Error("fetchPage must be a function");
  if (typeof mapPage !== "function") throw new Error("mapPage must be a function");
  assertPositiveInteger(targetCount, "targetCount");
  assertPositiveInteger(pageSize, "pageSize");
  if (pageSize > DEFAULT_PAGE_SIZE) throw new Error(`pageSize must be <= ${DEFAULT_PAGE_SIZE}`);
  if (!Number.isFinite(completedBy)) throw new Error("completedBy must be finite");

  const byOpenTime = new Map();
  const sourceRequests = [];
  let to;
  let previousOldestOpenTime = Number.POSITIVE_INFINITY;

  while (byOpenTime.size < targetCount) {
    const remaining = targetCount - byOpenTime.size;
    const count = Math.min(pageSize, remaining + 1);
    const path = buildDayCandlePath({ market, count, to });
    sourceRequests.push(`GET ${path}`);
    const raw = await fetchPage(path);
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`Upbit returned no daily candles for ${market}`);
    }

    const mapped = mapPage(raw, { completedBy, maxCount: count });
    if (!Array.isArray(mapped) || mapped.length === 0) {
      throw new Error(`Upbit returned no completed daily candles for ${market}`);
    }

    let oldestOpenTime = Number.POSITIVE_INFINITY;
    for (const candle of mapped) {
      if (!Number.isFinite(candle?.openTime) || !Number.isFinite(candle?.closeTime)) {
        throw new Error(`mapped daily candle for ${market} is missing finite timestamps`);
      }
      if (candle.closeTime > completedBy) continue;
      oldestOpenTime = Math.min(oldestOpenTime, candle.openTime);
      byOpenTime.set(candle.openTime, candle);
    }

    if (!Number.isFinite(oldestOpenTime)) {
      throw new Error(`Upbit page for ${market} contained no completed candles`);
    }
    if (oldestOpenTime >= previousOldestOpenTime) {
      throw new Error(`Upbit daily pagination for ${market} made no backward progress`);
    }
    previousOldestOpenTime = oldestOpenTime;
    to = new Date(oldestOpenTime).toISOString();

    if (raw.length < count && byOpenTime.size < targetCount) {
      throw new Error(`Upbit history exhausted for ${market}: ${byOpenTime.size}/${targetCount} completed daily candles`);
    }
  }

  const candles = [...byOpenTime.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-targetCount);

  if (candles.length !== targetCount) {
    throw new Error(`Upbit returned only ${candles.length} completed daily candles for ${market}; expected ${targetCount}`);
  }

  return Object.freeze({
    candles: Object.freeze(candles),
    sourceRequests: Object.freeze(sourceRequests)
  });
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  buildDayCandlePath,
  fetchCompletedDailyHistory
};
