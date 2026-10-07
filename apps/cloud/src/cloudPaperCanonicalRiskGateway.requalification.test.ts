import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";

const EXPECTED_RISK_BLOB = "31ca0f47d735a2c20f8bea561de86563e2e0f837";

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

  it("qualifies fill-derived accounting without cancellation erasing executed risk", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.doesNotMatch(source, /order\.status === "CANCELLED"/);
    assert.match(source, /function rateState[\s\S]*?state\.fills/);
    assert.match(source, /function dailyNotional[\s\S]*?state\.fills/);
    assert.match(source, /function realizedLossState[\s\S]*?state\.fills/);
    assert.match(source, /second\.add\(fill\.orderId\)/);
    assert.match(source, /sellOrders\.set\(order\.orderId/);
  });

  it("re-qualifies intent-bound idempotency without placeholder payload identity", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.match(source, /payloadFingerprintSha256\?: string/);
    assert.match(source, /const payloadFingerprint = input\.payloadFingerprintSha256 \?\? hash\(/);
    assert.match(source, /IDEMPOTENCY_FINGERPRINT_INVALID/);
    assert.match(source, /payloadFingerprint, createdAtMs: input\.now/);
    assert.doesNotMatch(source, /payloadFingerprint:\s*"PENDING"/);
  });

  it("re-qualifies the consecutive-loss streak as scoped to the current canonical (Asia/Seoul) trading day", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.match(source, /const completed = \[\.\.\.sellOrders\.values\(\)\]\.filter\(\(sell\) => dayOf\(sell\.filledAt\) === today\)/);
    assert.match(source, /const dayOf = \(timestamp: number\): string => tradingDayKey\(timestamp\);/, "one canonical trading day, not a local UTC day");
    assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/);
    // The unmatched-sell fail-closed path is unchanged.
    assert.match(source, /consecutiveLossCount: Number\.MAX_SAFE_INTEGER/);
  });

  it("re-qualifies the loss-session counts as display only: recorded after the streak is computed and never read by a decision", () => {
    const source = readFileSync("apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "utf8");
    assert.match(source, /todayCompletedSells: completed\.length, todayLosingSells: completed\.filter\(\(sell\) => sell\.pnl < 0\)\.length/);
    assert.match(source, /public lossSession\(\): CloudPaperLossSessionSnapshot \| null \{\r?\n\s*return this\.lastLossSession;/);
    assert.equal((source.match(/this\.lastLossSession/g) ?? []).length, 2, "written once per evaluation and read only by lossSession()");
    assert.match(source, /consecutiveLossCount: lossState\.consecutiveLossCount, sessionPeakEquity/, "the decision still uses the same streak");
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
