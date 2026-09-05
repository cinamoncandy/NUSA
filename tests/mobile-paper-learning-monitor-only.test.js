const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/tradingView.tsx"), "utf8");

test("production PAPER route is a read-only learning monitor, not a manual order ticket", () => {
  assert.match(source, /PaperLearningMonitorView/);
  assert.match(source, /buildPaperLearningScreen/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(source, /<LegacyTradingView/);
  assert.doesNotMatch(source, /NusaTextField|priceInput|quantityInput|submitPersonalPaperOrder|placeLocalPaperOrder/);
});
