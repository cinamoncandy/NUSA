const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controlRoomPath = path.resolve(__dirname, "../apps/desktop/renderer/control-room.js");
const mountPath = path.resolve(__dirname, "../apps/desktop/renderer/application-state-mount.js");

function loadRuntime() {
  const controlRoomSource = fs.readFileSync(controlRoomPath, "utf8");
  const mountSource = fs.readFileSync(mountPath, "utf8");
  const renderedStageLabels = [{ textContent: "시장 데이터" }, { textContent: "Risk Gateway" }];
  const sandbox = {
    window: { NUSAApplicationState: { mount() {} } },
    document: { querySelectorAll: () => renderedStageLabels }
  };
  vm.runInNewContext(controlRoomSource, sandbox, { filename: controlRoomPath });
  vm.runInNewContext(mountSource, sandbox, { filename: mountPath });
  return { api: sandbox.window.NUSAControlRoom, controlRoomSource, renderedStageLabels };
}

test("Shadow risk verdict is distinct from the final execution Risk Gateway", () => {
  const { api, controlRoomSource, renderedStageLabels } = loadRuntime();
  const shadowRiskStage = api.STAGES.find((stage) => stage.key === "riskGateway");

  assert.ok(shadowRiskStage, "expected the Shadow signal-risk stage to exist");
  assert.equal(shadowRiskStage.name, "신호 리스크 판단");
  assert.equal(renderedStageLabels[1].textContent, "신호 리스크 판단");
  assert.match(controlRoomSource, /whyField\("리스크 판단", signal\.riskDecision\)/);

  // Final execution authority stays separately fail-closed, and missing evidence is not
  // presented as either a HALT or a successful risk verdict.
  assert.match(controlRoomSource, /const riskDecision = signal && signal\.riskDecision;/);
  assert.match(controlRoomSource, /badge\("neutral", "○", "증거 없음"\)/);
  assert.match(controlRoomSource, /riskDecision \? "최근 신호의 Risk 판단" : "Risk 판단 증거 미제공"/);
  assert.match(controlRoomSource, /blockers\.includes\("RECONCILIATION_REQUIRED"\)/);
  assert.match(controlRoomSource, /reconciliationRequired \? "runtime blocker 근거" : "정합성 상태 증거 미제공"/);
});
