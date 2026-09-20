import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";

const EXPECTED_RISK_BLOB = "4a8533cb3ef81223f5b249b03619c50d0c28811e";

function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`, "utf8").update(body).digest("hex");
}

describe("RISK exact-source re-qualification evidence", () => {
  it("binds evidence to the exact canonical RISK source blob", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.equal(gitBlobSha(source), EXPECTED_RISK_BLOB);
  });

  it("verifies exactly four CANCELLED-order exclusions", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.equal((source.match(/if \(order\.status === "CANCELLED"\) continue;/g) ?? []).length, 4);
    assert.match(source, /function rateState[\s\S]*?if \(order\.status === "CANCELLED"\) continue;/);
    assert.match(source, /function dailyNotional[\s\S]*?if \(order\.status === "CANCELLED"\) continue;/);
    assert.match(source, /function realizedLossState[\s\S]*?if \(order\.status === "CANCELLED"\) continue;/);
  });

  it("verifies the complete PAPER risk envelope is unchanged", () => {
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
