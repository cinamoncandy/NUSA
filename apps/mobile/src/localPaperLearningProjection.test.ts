import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getLocalPaperLearningEvents,
  recordLocalPaperPublicMarkets,
  resetLocalPaperLearningEventsForTest,
} from "./localPaperLearningProjection";
import { buildPaperLearningScreen } from "./paperLearningScreen";
import type { WatchlistMarket } from "./watchlist";

const observedAt = "2026-09-09T10:00:00.000Z";
const market: WatchlistMarket = Object.freeze({
  market: "KRW-BTC",
  price: 100_000_000,
  changeRate: 0.01,
  volume: 1_000,
  observedAt,
  source: "UPBIT_PUBLIC_TICKER",
});

afterEach(() => resetLocalPaperLearningEventsForTest());

describe("local PAPER learning truth", () => {
  it("never invents a governed decision or confidence from public market observation", () => {
    recordLocalPaperPublicMarkets([market]);

    const events = getLocalPaperLearningEvents();
    const decisionEvent = events.find((event) => event.stage === "DECISION");
    assert.ok(decisionEvent);
    assert.equal(decisionEvent.status, "SKIP");
    assert.equal(decisionEvent.reason, "LOCAL_PUBLIC_INPUT_READY_NO_GOVERNED_DECISION");
    assert.equal(decisionEvent.decision, undefined);
    assert.equal(events.some((event) => event.fill !== undefined), false);
    assert.equal(events.some((event) => event.account !== undefined), false);
    assert.equal(JSON.stringify(events).includes("confidence"), false);

    const screen = buildPaperLearningScreen([], "RUNNING");
    assert.equal(screen.dataSource, "LOCAL_FALLBACK");
    assert.equal(screen.latestDecision, null);
    assert.equal(screen.latestFill, null);
    assert.equal(screen.latestAccount, null);
    assert.equal(screen.performance.realizedPnL, 0);
    assert.equal(screen.performance.unrealizedPnL, 0);
    assert.equal(screen.performance.fees, 0);
    assert.equal(screen.performance.turnover, 0);
  });
});
