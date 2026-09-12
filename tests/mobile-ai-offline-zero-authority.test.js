const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
const aiSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "aiView.tsx"), "utf8");

test("AI supervision remains visible without a verified PAPER dashboard connection", () => {
  assert.match(
    appSource,
    /const requiresDashboardConnection = notConfigured !== null && utilityView === null && activeTab === "Order";/,
  );
  assert.match(appSource, /activeTab === "AiSignal" \? <AiView/);
  assert.match(aiSource, /testID="ai-screen"/);
  assert.match(aiSource, /testID="ai-zero-authority-status"/);
});

test("AI loading and error states preserve an explicit zero-authority boundary", () => {
  const stateStart = aiSource.indexOf("function AiState(");
  const stateEnd = aiSource.indexOf("export function AiView", stateStart);
  assert.ok(stateStart >= 0 && stateEnd > stateStart, "AiState source boundary must remain discoverable");
  const stateSource = aiSource.slice(stateStart, stateEnd);
  assert.match(stateSource, /testID="ai-zero-authority-status"/);
  assert.match(stateSource, /AI ZERO AUTHORITY/);
  assert.match(stateSource, /PAPER·LIVE 주문, 이체, 출금 또는 운영 변경 권한이 없습니다/);
  assert.match(aiSource, /if \(error\) return <AiState/);
  assert.match(aiSource, /if \(ai === null && research === null\) return <AiState/);
});

test("offline AI visibility does not add execution authority", () => {
  assert.doesNotMatch(aiSource, /placeOrder\(|submitOrder\(|cancelOrder\(|withdraw\(/);
  assert.match(aiSource, /AI ZERO AUTHORITY/);
});
