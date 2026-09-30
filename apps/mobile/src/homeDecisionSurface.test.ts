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
    assert.equal(surface.statusLabel, "모의투자 · 기기 내");
    assert.equal(surface.risk, "확인할 데이터 부족 · 모의투자 실행 기록 없음");
    assert.equal(surface.primaryAction, "MARKETS");
  });

  it("preserves higher-priority action-required conditions for LOCAL PAPER", () => {
    const surface = buildHomeDecisionSurface(healthyInput({ accountSource: "LOCAL", disconnected: true }));

    assert.equal(surface.attention, "ACTION REQUIRED");
    assert.equal(surface.risk, "진행 불가 · 모의투자 연결 필요");
    assert.equal(surface.primaryAction, "SETTINGS");
  });

  it("keeps healthy CLOUD PAPER quiet when runtime evidence and safety gates are ready", () => {
    const surface = buildHomeDecisionSurface(healthyInput());

    assert.equal(surface.attention, "QUIET");
    assert.equal(surface.risk, "모의투자 전용 · 안전 확인 완료 · 실거래 권한 없음");
    assert.equal(surface.primaryAction, "MARKETS");
  });

  it("does not render a retained healthy Cloud snapshot as current when read-only recovery fails", () => {
    const surface = buildHomeDecisionSurface(healthyInput({
      runtimeState: "RUNNING",
      readOnlyError: true,
    }));

    assert.equal(surface.statusLabel, "모의투자 · 복구 필요");
    assert.equal(surface.statusTone, "danger");
    assert.equal(surface.now, "복구 필요");
    assert.equal(surface.risk, "진행 불가 · 연결 복구 필요");
  });

  it("does not render a retained RUNNING Cloud snapshot as current while disconnected", () => {
    const surface = buildHomeDecisionSurface(healthyInput({
      runtimeState: "RUNNING",
      disconnected: true,
    }));

    assert.equal(surface.statusLabel, "모의투자 · 복구 필요");
    assert.notEqual(surface.statusLabel, "모의투자 · 실행 중");
    assert.equal(surface.statusTone, "danger");
    assert.equal(surface.now, "모의투자 연결 필요");
    assert.equal(surface.risk, "진행 불가 · 모의투자 연결 필요");
  });
});
