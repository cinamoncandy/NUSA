import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPortfolioRiskPresentation } from "./portfolioRiskPresentation";
import type { PortfolioRiskSummary } from "../../../packages/contracts/src/portfolioRiskIntelligence";

function summary(overrides: Partial<PortfolioRiskSummary> = {}): PortfolioRiskSummary {
  return {
    schemaVersion: 1,
    equity: 1000,
    concentration: { herfindahlIndex: 0.52, largestPositionWeight: 0.6, largestPositionMarket: "BTC-USD" },
    exposure: { grossExposureRatio: 1, netExposureRatio: 1, perAssetWeight: { "BTC-USD": 0.6, "ETH-USD": 0.4 } },
    riskContributions: null,
    maxPairwiseCorrelation: null,
    expectedRisk: null,
    currentDrawdown: null,
    insufficientEvidenceReasons: ["CORRELATIONS_OR_VOLATILITY_MISSING", "EQUITY_CURVE_MISSING"],
    ...overrides,
  };
}

describe("buildPortfolioRiskPresentation", () => {
  it("returns the UNAVAILABLE state for a null summary, never a fabricated value", () => {
    const presentation = buildPortfolioRiskPresentation(null);
    assert.equal(presentation.status, "UNAVAILABLE");
    assert.equal(presentation.concentrationLabel, "-");
    assert.equal(presentation.largestPositionLabel, "-");
    assert.deepEqual(presentation.insufficientEvidenceReasons, []);
  });

  it("labels concentration and largest position from a real summary", () => {
    const presentation = buildPortfolioRiskPresentation(summary());
    assert.equal(presentation.status, "AVAILABLE");
    assert.equal(presentation.concentrationLabel, "52.0%");
    assert.equal(presentation.largestPositionLabel, "BTC-USD · 60%");
  });

  it("labels gross and net exposure", () => {
    const presentation = buildPortfolioRiskPresentation(summary({ exposure: { grossExposureRatio: 1.3, netExposureRatio: 0.5, perAssetWeight: {} } }));
    assert.equal(presentation.grossExposureLabel, "130%");
    assert.equal(presentation.netExposureLabel, "50%");
  });

  it("renders '-' for expectedRisk/currentDrawdown/maxPairwiseCorrelation when insufficient evidence (null), not a fabricated 0", () => {
    const presentation = buildPortfolioRiskPresentation(summary());
    assert.equal(presentation.expectedRiskLabel, "-");
    assert.equal(presentation.currentDrawdownLabel, "-");
    assert.equal(presentation.maxCorrelationLabel, "-");
  });

  it("labels expectedRisk/currentDrawdown/maxPairwiseCorrelation when evidence is present", () => {
    const presentation = buildPortfolioRiskPresentation(summary({ expectedRisk: 0.021, currentDrawdown: 0.15, maxPairwiseCorrelation: 0.734 }));
    assert.equal(presentation.expectedRiskLabel, "2.1%");
    assert.equal(presentation.currentDrawdownLabel, "15.0%");
    assert.equal(presentation.maxCorrelationLabel, "0.73");
  });

  it("shows '-' for the largest position when the portfolio has no positions", () => {
    const presentation = buildPortfolioRiskPresentation(summary({ concentration: { herfindahlIndex: 0, largestPositionWeight: 0, largestPositionMarket: null } }));
    assert.equal(presentation.largestPositionLabel, "-");
  });

  it("fails closed instead of rendering non-finite or malformed required values", () => {
    const malformedSummaries: PortfolioRiskSummary[] = [
      summary({ equity: Number.NaN }),
      summary({ concentration: { herfindahlIndex: Number.POSITIVE_INFINITY, largestPositionWeight: 0.6, largestPositionMarket: "BTC-USD" } }),
      summary({ concentration: { herfindahlIndex: 0.52, largestPositionWeight: Number.NEGATIVE_INFINITY, largestPositionMarket: "BTC-USD" } }),
      summary({ exposure: { grossExposureRatio: Number.NaN, netExposureRatio: 1, perAssetWeight: {} } }),
      summary({ exposure: { grossExposureRatio: 1, netExposureRatio: Number.POSITIVE_INFINITY, perAssetWeight: {} } }),
      summary({ expectedRisk: Number.NaN }),
      summary({ currentDrawdown: Number.POSITIVE_INFINITY }),
      summary({ maxPairwiseCorrelation: Number.NEGATIVE_INFINITY }),
    ];

    for (const malformed of malformedSummaries) {
      const presentation = buildPortfolioRiskPresentation(malformed);
      assert.equal(presentation.status, "UNAVAILABLE");
      assert.equal(presentation.concentrationLabel, "-");
      assert.equal(presentation.grossExposureLabel, "-");
      assert.equal(presentation.expectedRiskLabel, "-");
      assert.equal(presentation.maxCorrelationLabel, "-");
    }
  });

  it("passes through the insufficientEvidenceReasons verbatim", () => {
    const presentation = buildPortfolioRiskPresentation(summary());
    assert.deepEqual(presentation.insufficientEvidenceReasons, ["CORRELATIONS_OR_VOLATILITY_MISSING", "EQUITY_CURVE_MISSING"]);
  });
});
