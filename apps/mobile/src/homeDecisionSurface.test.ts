import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHomeDecisionSurface, type HomeDecisionSurfaceInput } from "./homeDecisionSurface";

const healthyInput = (overrides: Partial<HomeDecisionSurfaceInput> = {}): HomeDecisionSurfaceInput => ({
  runtimeState: undefined,
  health: "HEALTHY",
  readyForPaperOperations: true,
  disconnected: false,
  readOnlyError: false,
  accountSource: "CLOUD",
  paperEquity: undefined,
  paperTotalPnl: undefined,
  aiThesis: null,
  aiEvidenceCount: 0,
  aiCalibrationStatus: null,
  aiConfidence: null,
  ...overrides,
});

describe("home decision surface attention", () => {
  it("keeps LOCAL PAPER on WATCH while cloud runtime evidence is unavailable", () => {
    const surface = buildHomeDecisionSurface(healthyInput({ accountSource: "LOCAL" }));

    assert.equal(surface.attention, "WATCH");
    assert.equal(surface.statusLabel, "PAPER · LOCAL");
    assert.equal(surface.risk, "INSUFFICIENT · PAPER RUNTIME EVIDENCE UNAVAILABLE");
    assert.equal(surface.primaryAction, "MARKETS");
  });

  it("preserves higher-priority action-required conditions for LOCAL PAPER", () => {
    const surface = buildHomeDecisionSurface(healthyInput({ accountSource: "LOCAL", disconnected: true }));

    assert.equal(surface.attention, "ACTION REQUIRED");
    assert.equal(surface.risk, "BLOCKED · PAPER LINK REQUIRED");
    assert.equal(surface.primaryAction, "SETTINGS");
  });

  it("keeps healthy CLOUD PAPER quiet when runtime evidence and safety gates are ready", () => {
    const surface = buildHomeDecisionSurface(healthyInput());

    assert.equal(surface.attention, "QUIET");
    assert.equal(surface.risk, "PAPER ONLY · SAFETY GATES READY · LIVE NONE");
    assert.equal(surface.primaryAction, "MARKETS");
  });

  it("does not render a retained healthy Cloud snapshot as current when read-only recovery fails", () => {
    const surface = buildHomeDecisionSurface(healthyInput({
      runtimeState: "RUNNING",
      readOnlyError: true,
    }));

    assert.equal(surface.statusLabel, "PAPER · RECOVERY REQUIRED");
    assert.equal(surface.statusTone, "danger");
    assert.equal(surface.now, "RECOVERY REQUIRED");
    assert.equal(surface.risk, "BLOCKED · READ-ONLY RECOVERY REQUIRED");
  });
});
