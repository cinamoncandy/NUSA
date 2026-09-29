import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectPaperRuntimeHealth } from "./paperRuntimeHealth";
import type { CloudRuntimeLivenessSnapshot } from "./server";

const now = 10_000;
const policy = { heartbeatStaleAfterMs: 6_000, marketEventStaleAfterMs: 10_000 };
const liveness = (overrides: Partial<CloudRuntimeLivenessSnapshot> = {}): CloudRuntimeLivenessSnapshot => ({
  startedAt: 1_000,
  lastHeartbeatAt: 9_999,
  lastMarketEventAt: 9_500,
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
    const value = projectPaperRuntimeHealth(liveness({ lastMarketEventAt: null, eventCount: 0 }), now, policy);
    assert.equal(value.process.state, "HEALTHY");
    assert.equal(value.workload.state, "UNKNOWN");
  });

  it("does not turn health 200/process heartbeat into workload success", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastMarketEventAt: 0 }), now, policy);
    assert.equal(value.process.state, "HEALTHY");
    assert.equal(value.workload.state, "HEALTHY");
  });

  it("marks stale process and workload evidence independently", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastHeartbeatAt: 3_999, lastMarketEventAt: 0 }), 20_001, policy);
    assert.equal(value.process.state, "STALE");
    assert.equal(value.workload.state, "STALE");
  });

  it("keeps coded runtime errors visible as degraded evidence", () => {
    const value = projectPaperRuntimeHealth(liveness({ lastError: "PAPER_MARKET_OBSERVATION_REJECTED" }), now, policy);
    assert.equal(value.process.state, "DEGRADED");
    assert.equal(value.workload.state, "DEGRADED");
  });
});
