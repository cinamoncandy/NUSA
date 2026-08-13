const test = require("node:test");
const assert = require("node:assert/strict");
const { explainRiskCommentary } = require("../dist/apps/desktop/src/aiRiskCommentary.js");
const { explainRegime } = require("../dist/apps/desktop/src/aiRegimeExplainer.js");
const { explainChallengerDisagreement } = require("../dist/apps/desktop/src/aiChallengerDisagreementExplainer.js");

// The remaining three explainer wirings from WO-AI-010's second follow-up (ADR-0013): risk
// commentary, regime explanation, and challenger disagreement. Together with aiSignalExplainer
// (tested separately) and projection.ts's research-candidate wiring, this closes the "2 of N
// integration points" gap noted in docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-13.md.

function clientReturning(fn) {
  return typeof fn === "string" ? () => Promise.resolve(fn) : fn;
}

test("aiRiskCommentary: a grounded commentary is FAITHFUL, and a fabricated ratio is ungrounded", async () => {
  const request = {
    market: "KRW-BTC",
    dashboardStatus: "HEALTHY",
    risk: { status: "HEALTHY", generatedAt: 1000, reasons: [], killSwitchActive: false, dailyDrawdownRatio: 0.02, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.15 },
    warnings: []
  };
  const good = await explainRiskCommentary({
    request,
    client: { explainRisk: clientReturning("Daily drawdown is 0.02, well within limits, however there is uncertainty in how conditions may shift.") },
    nowMs: 2000
  });
  assert.equal(good.faithfulness.strength, "FAITHFUL");

  const bad = await explainRiskCommentary({
    request,
    client: { explainRisk: clientReturning("Daily drawdown is 0.95, extremely elevated, however this may change.") },
    nowMs: 2000
  });
  assert.ok(bad.faithfulness.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("aiRiskCommentary: a ratio restated as a percentage is still grounded", async () => {
  const request = {
    market: "KRW-BTC",
    dashboardStatus: "HEALTHY",
    risk: { status: "HEALTHY", generatedAt: 1000, reasons: [], killSwitchActive: false, dailyDrawdownRatio: 0.02, liquidationBufferRatio: 0.8, portfolioHeatRatio: 0.15 },
    warnings: []
  };
  const result = await explainRiskCommentary({
    request,
    client: { explainRisk: clientReturning("Drawdown is at 2%, which is fine, however markets can move fast.") },
    nowMs: 2000
  });
  assert.ok(!result.faithfulness.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("aiRegimeExplainer: a grounded, complete regime explanation is FAITHFUL", async () => {
  const request = {
    market: "KRW-BTC",
    regime: "STRONG_UPTREND",
    recentPrices: [100, 101, 105, 110],
    decision: { strategyId: "sma-crossover", regime: "STRONG_UPTREND", preference: "PREFERRED", allowNewExposure: true, risk: { positionSizeMultiplier: 1, maximumExposureMultiplier: 1, dailyRiskMultiplier: 1, stopLossMultiplier: 1, takeProfitMultiplier: 1, orderFrequencyMultiplier: 1 }, reason: "TREND_REGIME_SUPPORTED" }
  };
  const result = await explainRegime({
    request,
    client: { explainRegime: clientReturning("Price rose from 100 to 110, a strong uptrend, however this could reverse without warning.") },
    nowMs: 2000
  });
  assert.equal(result.faithfulness.strength, "FAITHFUL");
});

test("aiRegimeExplainer: a fabricated price is flagged as ungrounded", async () => {
  const request = {
    market: "KRW-BTC",
    regime: "STRONG_UPTREND",
    recentPrices: [100, 101, 105, 110],
    decision: { strategyId: "sma-crossover", regime: "STRONG_UPTREND", preference: "PREFERRED", allowNewExposure: true, risk: { positionSizeMultiplier: 1, maximumExposureMultiplier: 1, dailyRiskMultiplier: 1, stopLossMultiplier: 1, takeProfitMultiplier: 1, orderFrequencyMultiplier: 1 }, reason: "TREND_REGIME_SUPPORTED" }
  };
  const result = await explainRegime({
    request,
    client: { explainRegime: clientReturning("Price surged to 5000, an extreme move, however this may not hold.") },
    nowMs: 2000
  });
  assert.ok(result.faithfulness.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("aiChallengerDisagreementExplainer: consistent with the AI's own SELL signal is FAITHFUL", async () => {
  const observation = { timestamp: 1000, market: "KRW-BTC", championSignal: { type: "BUY", reason: "short-SMA crossed above long-SMA" }, aiSignal: { type: "SELL", reason: "하락 압력", confidence: 0.6 }, agreesWithChampion: false };
  const result = await explainChallengerDisagreement({
    observation,
    client: { explainDisagreement: clientReturning("The champion saw a bullish crossover, but the AI weighed bearish downside risk more heavily, however both readings carry uncertainty.") },
    nowMs: 2000
  });
  assert.equal(result.faithfulness.strength, "FAITHFUL");
});

test("aiChallengerDisagreementExplainer: language contradicting the AI's own SELL signal is direction-inconsistent", async () => {
  const observation = { timestamp: 1000, market: "KRW-BTC", championSignal: { type: "BUY", reason: "short-SMA crossed above long-SMA" }, aiSignal: { type: "SELL", reason: "하락 압력", confidence: 0.6 }, agreesWithChampion: false };
  const result = await explainChallengerDisagreement({
    observation,
    client: { explainDisagreement: clientReturning("Both signals point bullish and upside looks strong, however conditions remain uncertain.") },
    nowMs: 2000
  });
  assert.ok(result.faithfulness.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
});

test("aiChallengerDisagreementExplainer: certainty language with low AI confidence overclaims", async () => {
  const observation = { timestamp: 1000, market: "KRW-BTC", championSignal: { type: "BUY", reason: "x" }, aiSignal: { type: "SELL", reason: "y", confidence: 0.1 }, agreesWithChampion: false };
  const result = await explainChallengerDisagreement({
    observation,
    client: { explainDisagreement: clientReturning("This is certainly a bearish signal, however there is some uncertainty in general.") },
    nowMs: 2000
  });
  assert.ok(result.faithfulness.reasonCodes.includes("CONFIDENCE_LANGUAGE_OVERCLAIMS"));
});
