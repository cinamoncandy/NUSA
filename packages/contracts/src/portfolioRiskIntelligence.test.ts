import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePortfolioRisk, type PortfolioRiskIntelligenceInput } from "./portfolioRiskIntelligence";

describe("portfolio risk intelligence", () => {
  it("computes concentration and exposure for a simple two-asset portfolio", () => {
    const input: PortfolioRiskIntelligenceInput = {
      equity: 1000,
      assets: [
        { market: "BTC-USD", marketValue: 600 },
        { market: "ETH-USD", marketValue: 400 },
      ],
    };
    const result = summarizePortfolioRisk(input);
    assert.equal(result.concentration.largestPositionMarket, "BTC-USD");
    assert.equal(result.concentration.largestPositionWeight, 0.6);
    // HHI = 0.6^2 + 0.4^2 = 0.52
    assert.ok(Math.abs(result.concentration.herfindahlIndex - 0.52) < 1e-9);
    assert.equal(result.exposure.grossExposureRatio, 1);
    assert.equal(result.exposure.netExposureRatio, 1);
    assert.deepEqual(result.exposure.perAssetWeight, { "BTC-USD": 0.6, "ETH-USD": 0.4 });
  });

  it("treats a fully concentrated single-asset portfolio as HHI 1", () => {
    const result = summarizePortfolioRisk({ equity: 500, assets: [{ market: "BTC-USD", marketValue: 500 }] });
    assert.equal(result.concentration.herfindahlIndex, 1);
    assert.equal(result.concentration.largestPositionWeight, 1);
  });

  it("computes net exposure below gross exposure when short and long positions offset", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [
        { market: "BTC-USD", marketValue: 800 },
        { market: "ETH-USD", marketValue: -300 },
      ],
    });
    assert.equal(result.exposure.grossExposureRatio, 1.1);
    assert.equal(result.exposure.netExposureRatio, 0.5);
  });

  it("returns null risk metrics with a reason when correlations and volatility are absent", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
    });
    assert.equal(result.riskContributions, null);
    assert.equal(result.expectedRisk, null);
    assert.equal(result.maxPairwiseCorrelation, null);
    assert.ok(result.insufficientEvidenceReasons.includes("CORRELATIONS_OR_VOLATILITY_MISSING"));
  });

  it("returns null risk metrics with a reason when volatility is missing for one asset", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: { "BTC-USD|ETH-USD": 0.5 },
      volatility: { "BTC-USD": 0.02 },
    });
    assert.equal(result.riskContributions, null);
    assert.ok(result.insufficientEvidenceReasons.some((reason) => reason.startsWith("VOLATILITY_MISSING")));
  });

  it("fails closed when a pairwise correlation is missing instead of assuming independence", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: {},
      volatility: { "BTC-USD": 0.02, "ETH-USD": 0.03 },
    });
    assert.equal(result.riskContributions, null);
    assert.equal(result.expectedRisk, null);
    assert.ok(result.insufficientEvidenceReasons.includes("CORRELATION_MISSING:BTC-USD|ETH-USD"));
  });

  it("fails closed on invalid correlation or volatility evidence", () => {
    const invalidCorrelation = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: { "BTC-USD|ETH-USD": Number.NaN },
      volatility: { "BTC-USD": 0.02, "ETH-USD": 0.03 },
    });
    assert.equal(invalidCorrelation.riskContributions, null);
    assert.ok(invalidCorrelation.insufficientEvidenceReasons.includes("CORRELATION_INVALID:BTC-USD|ETH-USD"));

    const invalidVolatility = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: { "BTC-USD|ETH-USD": 0.5 },
      volatility: { "BTC-USD": 0.02, "ETH-USD": -0.03 },
    });
    assert.equal(invalidVolatility.riskContributions, null);
    assert.ok(invalidVolatility.insufficientEvidenceReasons.includes("VOLATILITY_INVALID:ETH-USD"));
  });

  it("computes risk contributions and expected risk when correlations and volatility are supplied", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: { "BTC-USD|ETH-USD": 0.5 },
      volatility: { "BTC-USD": 0.02, "ETH-USD": 0.03 },
    });
    assert.notEqual(result.riskContributions, null);
    assert.equal(result.riskContributions?.length, 2);
    assert.notEqual(result.expectedRisk, null);
    assert.ok((result.expectedRisk as number) > 0);
    assert.equal(result.maxPairwiseCorrelation, 0.5);
    // Contribution shares should sum to ~1.
    const sum = (result.riskContributions ?? []).reduce((acc, entry) => acc + entry.contributionShare, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6);
  });

  it("gives the more volatile, more correlated asset a larger risk contribution share", () => {
    const result = summarizePortfolioRisk({
      equity: 1000,
      assets: [{ market: "BTC-USD", marketValue: 500 }, { market: "ETH-USD", marketValue: 500 }],
      correlations: { "BTC-USD|ETH-USD": 0.9 },
      volatility: { "BTC-USD": 0.01, "ETH-USD": 0.05 },
    });
    const btc = result.riskContributions?.find((entry) => entry.market === "BTC-USD");
    const eth = result.riskContributions?.find((entry) => entry.market === "ETH-USD");
    assert.ok((eth?.contributionShare ?? 0) > (btc?.contributionShare ?? 0));
  });

  it("computes current drawdown from an equity curve", () => {
    const result = summarizePortfolioRisk({
      equity: 900,
      assets: [{ market: "BTC-USD", marketValue: 900 }],
      equityCurve: [1000, 1200, 900],
    });
    // peak 1200, current 900 -> drawdown = 300/1200 = 0.25
    assert.ok(Math.abs((result.currentDrawdown as number) - 0.25) < 1e-9);
  });

  it("reports current drawdown rather than a recovered historical maximum drawdown", () => {
    const result = summarizePortfolioRisk({
      equity: 1100,
      assets: [{ market: "BTC-USD", marketValue: 1100 }],
      equityCurve: [1000, 800, 1100],
    });
    assert.equal(result.currentDrawdown, 0);
  });

  it("fails closed when the equity curve is malformed or has no positive base", () => {
    for (const equityCurve of [[1000, Number.NaN], [1000, -1], [0, 1000]]) {
      const result = summarizePortfolioRisk({
        equity: 900,
        assets: [{ market: "BTC-USD", marketValue: 900 }],
        equityCurve,
      });
      assert.equal(result.currentDrawdown, null);
      assert.ok(result.insufficientEvidenceReasons.includes("EQUITY_CURVE_INVALID"));
    }
  });

  it("returns null drawdown with a reason when no equity curve is supplied", () => {
    const result = summarizePortfolioRisk({ equity: 900, assets: [{ market: "BTC-USD", marketValue: 900 }] });
    assert.equal(result.currentDrawdown, null);
    assert.ok(result.insufficientEvidenceReasons.includes("EQUITY_CURVE_MISSING"));
  });

  it("handles an empty portfolio without dividing by zero", () => {
    const result = summarizePortfolioRisk({ equity: 1000, assets: [] });
    assert.equal(result.concentration.herfindahlIndex, 0);
    assert.equal(result.concentration.largestPositionMarket, null);
    assert.equal(result.exposure.grossExposureRatio, 0);
    assert.ok(result.insufficientEvidenceReasons.includes("NO_ASSETS"));
  });

  it("handles zero equity without dividing by zero", () => {
    const result = summarizePortfolioRisk({ equity: 0, assets: [{ market: "BTC-USD", marketValue: 0 }] });
    assert.equal(result.exposure.grossExposureRatio, 0);
    assert.equal(result.exposure.netExposureRatio, 0);
  });
});
