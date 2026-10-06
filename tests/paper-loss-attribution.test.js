"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { attributeTodayLosses } = require("../dist/apps/cloud/src/paperLossAttribution.js");

const NOW = Date.parse("2026-10-06T12:00:00Z");
const bound = (familyId) => ({ candidateProvenance: { schemaVersion: 1, source: "CIO_DECISION_BINDING", decisionAt: 0, binding: { candidateStrategy: { familyId } } } });
let n = 0;
const fill = (side, price, t, extra = {}, orderId) => ({ id: `f${n += 1}`, orderId: orderId ?? `o${n}`, market: "KRW-XRP", side, quantity: 1, price, fee: 0, filledAt: t, ...extra });

test("each of today's completed sells is attributed to the family that opened the position", () => {
  const fills = [
    fill("BUY", 100, NOW - 9e5, bound("sma-crossover")), fill("SELL", 99, NOW - 8e5),
    fill("BUY", 100, NOW - 7e5, bound("rsi-mean-reversion")), fill("SELL", 101, NOW - 6e5),
    fill("BUY", 100, NOW - 5e5, bound("sma-crossover")), fill("SELL", 98, NOW - 4e5),
    fill("BUY", 100, NOW - 3e5), fill("SELL", 97, NOW - 2e5),
    fill("BUY", 100, NOW - 1e5, bound("some-new-family")), fill("SELL", 90, NOW - 5e4),
  ];
  const a = attributeTodayLosses(fills, NOW);
  assert.deepEqual(a.byFamily, {
    SMA_CROSSOVER: { completedSells: 2, losingSells: 2 },
    RSI_MEAN_REVERSION: { completedSells: 1, losingSells: 0 },
    UNATTRIBUTED: { completedSells: 1, losingSells: 1 },
    OTHER_FAMILY: { completedSells: 1, losingSells: 1 },
  });
  assert.equal(a.evaluatedAt, NOW);
  assert.doesNotMatch(JSON.stringify(a), /KRW|some-new-family|o\d|f\d/, "no market, raw family id or identifier leaves the module");
});

test("yesterday's sells are excluded and a multi-fill sell order counts once", () => {
  const fills = [
    fill("BUY", 100, NOW - 86_400_000 - 1e5, bound("sma-crossover")), fill("SELL", 90, NOW - 86_400_000),
    fill("BUY", 100, NOW - 3e5, bound("donchian-breakout")),
    { ...fill("SELL", 99, NOW - 2e5, {}, "same"), quantity: 0.5 }, { ...fill("SELL", 99, NOW - 1e5, {}, "same"), quantity: 0.5 },
  ];
  assert.deepEqual(attributeTodayLosses(fills, NOW).byFamily, { DONCHIAN_BREAKOUT: { completedSells: 1, losingSells: 1 } });
  assert.deepEqual(attributeTodayLosses([], NOW).byFamily, {});
});
