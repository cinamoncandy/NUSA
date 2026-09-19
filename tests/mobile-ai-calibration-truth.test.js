const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = () => fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");

test("Signal Detail exposes confidence only when calibrated", () => {
  const code = source();
  assert.match(code, /const calibrated=ai\?\.calibrationStatus==="CALIBRATED"/);
  assert.match(code, /const trusted=calibrated\?percent\(ai\?\.confidence\):"UNVERIFIED"/);
  assert.match(code, /검증 신뢰도/);
  assert.match(code, /UNVERIFIED/);
});

test("uncalibrated output is never presented as profit probability", () => {
  const code = source();
  assert.match(code, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.doesNotMatch(code, /성과 보장/);
});

test("Signal Detail keeps evidence and counter-evidence visible", () => {
  const code = source();
  assert.match(code, /EVIDENCE \{evidence\.length\}/);
  assert.match(code, /COUNTER \{counter\.length\}/);
  assert.match(code, /WHY/);
  assert.match(code, /RESULT/);
  assert.match(code, /RISK/);
  assert.match(code, /LEARNING/);
});

test("Signal Detail remains read-only and zero-authority", () => {
  const code = source();
  assert.match(code, /AI ZERO AUTHORITY/);
  assert.match(code, /PUBLIC READ ONLY/);
  assert.match(code, /PRODUCTION MUTATION/);
  assert.doesNotMatch(code, /submitOrder\s*\(|cancelOrder\s*\(|withdraw\s*\(|transfer\s*\(/i);
});
