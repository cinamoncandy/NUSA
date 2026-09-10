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

test("offline AI visibility does not add execution authority", () => {
  assert.doesNotMatch(aiSource, /placeOrder\(|submitOrder\(|cancelOrder\(|withdraw\(/);
  assert.match(aiSource, /AI ZERO AUTHORITY/);
});
