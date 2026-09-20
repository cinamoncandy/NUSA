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
  assert.match(aiSource, /검증된 AI 판단이 아직 없습니다\./);
});

test("offline AI visibility keeps explicit zero authority and no execution surface", () => {
  assert.match(aiSource, /AI ZERO AUTHORITY/);
  assert.match(aiSource, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(aiSource, /placeOrder\(|submitOrder\(|cancelOrder\(|withdraw\(|ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
  assert.doesNotMatch(aiSource, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
});
