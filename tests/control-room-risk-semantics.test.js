const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controlRoomPath = path.resolve(__dirname, "../apps/desktop/renderer/control-room.js");

function loadControlRoom() {
  const source = fs.readFileSync(controlRoomPath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: controlRoomPath });
  return { api: sandbox.window.NUSAControlRoom, source };
}

test("Shadow risk decision is not labelled as the final Risk Gateway", () => {
  const { api, source } = loadControlRoom();
  const shadowRiskStage = api.STAGES.find((stage) => stage.key === "riskGateway");

  assert.ok(shadowRiskStage, "expected the Shadow risk stage to exist");
  assert.equal(shadowRiskStage.name, "신호 리스크 판단");
  assert.match(source, /whyField\("신호 리스크 판단", signal\.riskDecision\)/);

  // The final execution Risk Gateway remains separately fail-closed until composition lands.
  assert.match(source, /tile\("Risk Gateway", riskValue, "RISK_GATE_NOT_CONFIGURED"\)/);
  assert.match(source, /riskValue\.replaceChildren\(badge\("bad", "■", "HALT"\)\)/);
});
