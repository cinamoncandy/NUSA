import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";

describe("RISK re-qualification source delta", () => {
  it("verifies the candidate source has the four CANCELLED-order exclusions", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.equal((source.match(/if \(order\.status === "CANCELLED"\\) continue;/g) ?? []).length, 4);
    assert.match(source, /function rateState[\s\\S]*?if \(order\.status === "CANCELLED"\\) continue;/);
    assert.match(source, /function dailyNotional[\s\\S]*?if \(order\.status === "CANCELLED"\\) continue;/);
    assert.match(source, /function realizedLossState[\s\\S]*?if \(order\.status === "CANCELLED"\\) continue;/);
  });

  it("verifies the qualified PAPER risk envelope is unchanged", () => {
    assert.deepEqual(CLOUD_PAPER_RISK_LIMITS, {
      maxOrderNotional: 2_000_000,
      maxPositionNotional: 2_000_000,
      maxOpenOrders: 1,
      maxOrdersPerSecond: 1,
      maxOrdersPerMinute: 60,
      maxSameSideStreak: 10,
      maxSymbolExposureNotional: 2_000_000,
      maxPortfolioExposureNotional: 2_000_000,
      maxDailyBuyNotional: 2_000_000,
      maxDailySellNotional: 2_000_000,
      maxDailyLoss: 1_000_000,
      maxConsecutiveLosses: 3,
      maxSessionDrawdownRatio: 0.2,
      maxPriceDeviationRatio: 0.05
    });
  });
});
