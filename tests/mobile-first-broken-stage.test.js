"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { firstBrokenStage, FIRST_BROKEN_WARMUP_MS, FIRST_BROKEN_MARKET_STALE_MS } = require("../dist/apps/mobile/src/firstBrokenStageModel.js");

const now = 10_000_000_000;
const base = { startedAt: now - 3_600_000, lastHeartbeatAt: now, lastMarketEventAt: now - 1000, eventCount: 5000, decisionCount: 4800, buySignalCount: 0, paperOrderCount: 0, paperFillCount: 0 };

test("a healthy or quiet flow claims nothing: no signals means no order is expected", () => {
  assert.equal(firstBrokenStage(base, now), null);
  assert.equal(firstBrokenStage({ ...base, buySignalCount: 3, paperOrderCount: 3, paperFillCount: 3 }, now), null);
  assert.equal(firstBrokenStage(null, now), null);
});

test("the nine-day failure reads as the order stage: buy signals but no orders", () => {
  const r = firstBrokenStage({ ...base, buySignalCount: 6257 }, now);
  assert.equal(r.stage, "ORDER");
  assert.equal(r.text, "매수 신호는 6,257번 있었는데 주문은 0번이에요");
});

test("orders without fills and a stale feed are named; the first stage in flow order wins", () => {
  assert.equal(firstBrokenStage({ ...base, buySignalCount: 5, paperOrderCount: 5 }, now).stage, "FILL");
  assert.equal(firstBrokenStage({ ...base, lastMarketEventAt: now - FIRST_BROKEN_MARKET_STALE_MS - 1 }, now).stage, "MARKET");
  assert.equal(firstBrokenStage({ ...base, lastMarketEventAt: now - FIRST_BROKEN_MARKET_STALE_MS - 1, buySignalCount: 9 }, now).stage, "MARKET", "an upstream stop is reported before a downstream one");
  assert.equal(firstBrokenStage({ ...base, decisionCount: 0 }, now).stage, "DECISION");
});

test("right after a restart nothing is called broken because a count is still zero", () => {
  const fresh = { ...base, startedAt: now - FIRST_BROKEN_WARMUP_MS + 1000, lastMarketEventAt: null, eventCount: 0, decisionCount: 0 };
  assert.equal(firstBrokenStage(fresh, now), null);
  assert.equal(firstBrokenStage({ ...fresh, startedAt: now - FIRST_BROKEN_WARMUP_MS - 1000 }, now).stage, "MARKET");
});

test("missing or malformed fields never become a claim", () => {
  assert.equal(firstBrokenStage({ startedAt: now - 3_600_000, lastHeartbeatAt: now }, now), null);
  assert.equal(firstBrokenStage({ ...base, buySignalCount: -1, paperOrderCount: 0 }, now), null);
  assert.equal(firstBrokenStage({ ...base, buySignalCount: 1.5, paperOrderCount: 0 }, now), null);
  assert.equal(firstBrokenStage({ ...base, buySignalCount: "9", paperOrderCount: 0 }, now), null);
  assert.equal(firstBrokenStage({ ...base, lastMarketEventAt: Number.NaN }, now), null);
});

test("the Now screen shows the line only when the data is live, from the heartbeat the app already has", () => {
  const view = fs.readFileSync("apps/mobile/src/nowView.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(view, /const brokenStage = blocked \? null : firstBrokenStage\(heartbeat, Date\.now\(\)\);/);
  assert.match(view, /testID="now-first-broken-stage"/);
});
