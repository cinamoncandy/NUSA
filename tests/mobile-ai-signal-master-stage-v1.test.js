const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", relative), "utf8");

test("AI upper half is a single signal stage with thesis, calibrated confidence and evidence", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /title="AI SIGNAL"/);
  assert.match(ai, /testID="ai-signal-stage"/);
  assert.match(ai, /signalStage: \{ minHeight: 470/);
  assert.match(ai, /CURRENT THESIS/);
  assert.match(ai, /testID="ai-signal-confidence"/);
  assert.match(ai, /CALIBRATED CONFIDENCE/);
  assert.match(ai, /testID="ai-signal-evidence-strip"/);
  assert.match(ai, /EVIDENCE MAP/);
});

test("AI SIGNAL does not manufacture confidence when calibration or thesis is unavailable", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /const isCalibrated = ai\?\.calibrationStatus === "CALIBRATED"/);
  assert.match(ai, /const trustedConfidence = isCalibrated \? percent\(ai\?\.confidence\) : "-"/);
  assert.match(ai, /const signalReady = ai\?\.status === "AVAILABLE" && isCalibrated && Boolean\(ai\?\.thesis\)/);
  assert.match(ai, /NO VERIFIED SIGNAL/);
  assert.match(ai, /근거와 보정 상태가 확인되기 전에는 신호를 만들지 않습니다/);
});

test("AI SIGNAL preserves diagnostics lower in hierarchy and keeps zero execution authority", () => {
  const ai = read("src/aiView.tsx");
  const evidence = ai.indexOf('testID="ai-evidence-card"');
  const diagnostics = ai.indexOf('testID="ai-diagnostics-card"');
  const authority = ai.indexOf('testID="ai-authority-card"');
  assert.ok(evidence >= 0 && diagnostics > evidence && authority > diagnostics);
  assert.match(ai, /AI SIGNAL · READ ONLY/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /AI에는 PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
  assert.match(ai, /value=\{liveAuthority \?\? "-"\}/);
  assert.match(ai, /productionMutationAllowed == null \? "-" : "금지"/);
  assert.doesNotMatch(ai, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(ai, /liveAuthority:\s*"LIVE"/);
});
