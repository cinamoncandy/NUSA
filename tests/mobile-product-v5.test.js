const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("product v5 keeps the four primary jobs literal and glanceable", () => {
  const app = read("App.tsx");
  assert.match(app, /Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO"/);
  const home = read("src/homeView.tsx");
  assert.match(home, />MARKETS<\/Text>/);
  assert.match(home, />PORTFOLIO<\/Text>/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /TOTAL PNL/);
});

test("product v5 uses flatter secondary sections and Android-sized actions", () => {
  const intelligence = read("src/intelligenceOs.tsx");
  assert.match(intelligence, /section: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0/);
  assert.match(intelligence, /sectionAction: { minHeight: 48/);
  assert.match(intelligence, /leadTitle: { fontSize: 30/);
});

test("Cloud PAPER setup communicates server session verify without changing authority", () => {
  const settings = read("src/settingsView.tsx");
  assert.match(settings, /title="SERVER"/);
  assert.match(settings, /title="SECURE SESSION"/);
  assert.match(settings, /title="VERIFY"/);
  assert.match(settings, /연결 다시 시도/);
  assert.doesNotMatch(settings, /placeOrder|cancelOrder|withdraw/);
  const productionPaper = read("src/tradingView.tsx");
  assert.match(productionPaper, /<PaperLearningMonitorView/);
  assert.doesNotMatch(productionPaper, /<LegacyTradingView/);
  assert.doesNotMatch(productionPaper, /<NusaTextField|placeOrder\(|submitOrder\(/);
  assert.match(productionPaper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
