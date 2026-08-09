const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("PAPER read-only observation card has a distinct non-action state hook", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "tradingView.tsx"), "utf8");
  assert.match(source, /testID="trading-readonly-state"/);
  assert.match(source, /ZERO MUTATION/);
  assert.doesNotMatch(source, /testID="trading-preview">\s*<View[^>]*>\s*<Text[^>]*>PAPER 관찰 모드/);
});
