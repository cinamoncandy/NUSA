import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectPaperRuntimeHealth } from "./paperRuntimeHealth";
import type { CloudRuntimeLivenessSnapshot } from "./server";

const now = 10_000;
const policy = { heartbeatStaleAfterMs: 6_000, marketEventStaleAfterMs: 10_000 };
const liveness = (overrides: Partial<CloudRuntimeLivenessSnapshot & { lastAcceptedMarketReceiptAt: number | null; lastFailureAt: number | null }> = {}): CloudRuntimeLivenessSnapshot & { lastAcceptedMarketReceiptAt: number | null; lastFailureAt: number | null } => ({
  startedAt: 1_000,
  lastHeartbeatAt: 9_999,
  lastMarketEventAt: 9_500,
  lastAcceptedMarketReceiptAt: 9_500,
  lastFailureAt: null,
  lastPaperDecisionAt: 9_400,
  lastPaperOrderAt: null,
  lastPaperFillAt: null,
  eventCount: 5,
  decisionCount: 3,
  paperOrderCount: 0,
  paperFillCount: 0,
  lastError: null,
  ...overrides,
});

describe("projectPaperRuntimeHealth", () => {
  it("separates healthy process from missing workload evidence", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastMarketEventAt: null, lastAcceptedMarketReceiptAt: null, eventCount: 0 }), now, policy);
    assert.equal(value.process.state, "HEALTHY");
    assert.equal(value.workload.state, "UNKNOWN");
  });

  it("does not turn health 200/process heartbeat into workload success", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastMarketEventAt: 0, lastAcceptedMarketReceiptAt: null }), now, policy);
    assert.equal(value.process.state, "HEALTHY");
    assert.equal(value.workload.state, "UNKNOWN");
  });

  it("marks stale process and workload evidence independently", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastHeartbeatAt: 3_999, lastMarketEventAt: 0, lastAcceptedMarketReceiptAt: 0 }), 20_001, policy);
    assert.equal(value.process.state, "STALE");
    assert.equal(value.workload.state, "STALE");
  });

  it("keeps coded runtime errors visible as degraded evidence", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastError: "PAPER_MARKET_OBSERVATION_REJECTED" }), now, policy);
    assert.equal(value.process.state, "DEGRADED");
    assert.equal(value.workload.state, "DEGRADED");
  });
  it("requires a new accepted market receipt after a failure, even if transport reconnect clears the error", () => {
    const failed = liveness({ lastError: "PAPER_EXECUTION_FAILED", lastFailureAt: 9_600 });
    assert.equal(projectPaperRuntimeHealth(failed, now, policy).workload.state, "DEGRADED");
    const reconnected = { ...failed, lastError: null };
    assert.equal(projectPaperRuntimeHealth(reconnected, now, policy).workload.reasonCode, "RECOVERY_NOT_VERIFIED");
    assert.equal(projectPaperRuntimeHealth({ ...reconnected, lastAcceptedMarketReceiptAt: 9_601 }, now, policy).workload.state, "HEALTHY");
  });
  it("uses receipt time, not an accepted exchange timestamp slightly ahead of the host clock", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastMarketEventAt: now + 5_000, lastAcceptedMarketReceiptAt: now }), now, policy);
    assert.equal(value.workload.state, "HEALTHY");
  });
});
