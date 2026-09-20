import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";

const EXPECTED_RISK_BLOB = "4a8533cb3ef81223f5b249b03619c50d0c28811e";

function committedGitBlobSha(path: string): string {
  return execFileSync("git", ["rev-parse", `HEAD:${path}`], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

describe("RISK exact-source re-qualification evidence", () => {
  it("binds evidence to the exact canonical RISK source blob", () => {
    const sourcePath = "apps/cloud/src/cloudPaperCanonicalRiskGateway.ts";
    readFileSync(sourcePath, "utf8");
    assert.equal(committedGitBlobSha(sourcePath), EXPECTED_RISK_BLOB);
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
