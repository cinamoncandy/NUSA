const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The PAPER route used to be tradingView.tsx, a shell that delegated to the monitor. That shell
// was deleted with the ORDER destination; PAPER is now the monitor itself, reached from More.
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/paperLearningMonitorView.tsx"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");

test("production PAPER route is a read-only learning monitor, not a manual order ticket", () => {
  assert.match(app, /utilityView === "PAPER" \? <PaperLearningMonitorView/);
  assert.match(app, /buildPaperLearningScreen/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(source, /NusaTextField|priceInput|quantityInput|submitPersonalPaperOrder|placeLocalPaperOrder/);
});
