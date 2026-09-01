import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPortfolioRiskSummaryFromTradingSnapshot } from "./portfolioRiskFromTradingSnapshot";
import type { TradingSnapshot } from "./tradingService";

function snapshot(positions: TradingSnapshot["positions"]): TradingSnapshot {
  return { orders: [], balances: [], positions };
}

describe("buildPortfolioRiskSummaryFromTradingSnapshot", () => {
  it("converts positions with available prices into risk-summary assets", () => {
    const trading = snapshot([
      { market: "BTC-USD", quantity: 2, averageEntryPrice: 50_000 },
      { market: "ETH-USD", quantity: 10, averageEntryPrice: 2_000 },
    ]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 1_000, (market) =>
      market === "BTC-USD" ? 60_000 : market === "ETH-USD" ? 2_500 : null,
    );
    // BTC: 2*60000=120000, ETH: 10*2500=25000, cash 1000 -> equity 146000
    assert.equal(result.summary.equity, 146_000);
    assert.equal(result.droppedMarkets.length, 0);
    assert.equal(result.summary.concentration.largestPositionMarket, "BTC-USD");
  });

  it("drops a position with no available mark price rather than assuming zero value", () => {
    const trading = snapshot([
      { market: "BTC-USD", quantity: 1, averageEntryPrice: 50_000 },
      { market: "DOGE-USD", quantity: 1_000, averageEntryPrice: 0.1 },
    ]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 0, (market) =>
      market === "BTC-USD" ? 60_000 : null,
    );
    assert.deepEqual(result.droppedMarkets, ["DOGE-USD"]);
    assert.equal(result.summary.equity, 60_000);
    assert.equal(result.summary.concentration.herfindahlIndex, 1);
  });

  it("skips a zero-quantity position entirely", () => {
    const trading = snapshot([{ market: "BTC-USD", quantity: 0, averageEntryPrice: 50_000 }]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 500, () => 60_000);
    assert.equal(result.summary.concentration.largestPositionMarket, null);
    assert.equal(result.summary.equity, 500);
  });

  it("passes through optional correlation/volatility/equity-curve evidence", () => {
    const trading = snapshot([
      { market: "BTC-USD", quantity: 1, averageEntryPrice: 50_000 },
      { market: "ETH-USD", quantity: 1, averageEntryPrice: 2_000 },
    ]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(
      trading,
      0,
      (market) => (market === "BTC-USD" ? 60_000 : 2_500),
      {
        correlations: { "BTC-USD|ETH-USD": 0.6 },
        volatility: { "BTC-USD": 0.02, "ETH-USD": 0.03 },
        equityCurve: [50_000, 65_000, 62_500],
      },
    );
    assert.notEqual(result.summary.expectedRisk, null);
    assert.notEqual(result.summary.currentDrawdown, null);
  });

  it("returns an empty-portfolio summary when all positions lack prices", () => {
    const trading = snapshot([{ market: "BTC-USD", quantity: 1, averageEntryPrice: 50_000 }]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 1_000, () => null);
    assert.deepEqual(result.droppedMarkets, ["BTC-USD"]);
    assert.equal(result.summary.equity, 1_000);
    assert.ok(result.summary.insufficientEvidenceReasons.includes("NO_ASSETS"));
  });

  it("rejects a negative cash value", () => {
    assert.throws(() => buildPortfolioRiskSummaryFromTradingSnapshot(snapshot([]), -1, () => null));
  });

  it("rejects non-finite position quantity before mark-price lookup", () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => buildPortfolioRiskSummaryFromTradingSnapshot(
          snapshot([{ market: "BTC-USD", quantity, averageEntryPrice: 50_000 }]),
          1_000,
          () => { throw new Error("mark-price lookup must not run"); },
        ),
        /position quantity must be finite: BTC-USD/,
      );
    }
  });

  it("rejects malformed position market identity before mark-price lookup", () => {
    for (const market of ["", "   ", " BTC-USD", "BTC-USD "]) {
      assert.throws(
        () => buildPortfolioRiskSummaryFromTradingSnapshot(
          snapshot([{ market, quantity: 1, averageEntryPrice: 50_000 }]),
          1_000,
          () => { throw new Error("mark-price lookup must not run"); },
        ),
        /position market must be a non-empty trimmed string/,
      );
    }
  });

  it("rejects a non-string runtime market from an unvalidated API snapshot", () => {
    const malformedMarket = null as unknown as string;
    assert.throws(
      () => buildPortfolioRiskSummaryFromTradingSnapshot(
        snapshot([{ market: malformedMarket, quantity: 1, averageEntryPrice: 50_000 }]),
        1_000,
        () => { throw new Error("mark-price lookup must not run"); },
      ),
      /position market must be a non-empty trimmed string/,
    );
  });

  it("treats a zero mark price as unavailable rather than zero-valuing a position", () => {
    const trading = snapshot([{ market: "BTC-USD", quantity: 1, averageEntryPrice: 50_000 }]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 1_000, () => 0);
    assert.deepEqual(result.droppedMarkets, ["BTC-USD"]);
    assert.equal(result.summary.equity, 1_000);
    assert.ok(result.summary.insufficientEvidenceReasons.includes("NO_ASSETS"));
  });

  it("ignores a negative mark price for a market, treating it as unavailable", () => {
    const trading = snapshot([{ market: "BTC-USD", quantity: 1, averageEntryPrice: 50_000 }]);
    const result = buildPortfolioRiskSummaryFromTradingSnapshot(trading, 0, () => -1);
    assert.deepEqual(result.droppedMarkets, ["BTC-USD"]);
  });
});
