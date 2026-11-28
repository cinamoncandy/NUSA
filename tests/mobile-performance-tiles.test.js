const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const view = fs.readFileSync(path.join(root, "apps/mobile/src/performanceView.tsx"), "utf8");

test("성과 shows its rows as calm tiles with the same tones as before", () => {
  assert.match(view, /import \{ CalmTiles \} from "\.\/uiKit"/);
  assert.match(view, /<CalmTiles rows=\{tiles\} testID="performance-tiles" \/>/);
  // only a real loss is red; a gain stays the plain text colour (it already was: theme success is the calm text colour)
  assert.match(view, /row\.tone === "neg" \? "LOSS" as const : "NORMAL" as const/);
  assert.doesNotMatch(view, /theme\.colors\.success|ORDER|ATTENTION/);
});

test("성과 keeps its title, headline, read-only wording and back button; values come from the model unchanged", () => {
  assert.match(view, /title="성과" detail="PAPER · 읽기 전용"/);
  assert.match(view, /testID="performance-headline"/);
  assert.match(view, /accessibilityLabel="더보기로 돌아가기"/);
  assert.match(view, /label: row\.label, value: row\.value/);
  assert.doesNotMatch(view, /#[0-9a-fA-F]{6}/);
});

test("an empty projection shows only the honest headline, no tile grid", () => {
  assert.match(view, /tiles\.length > 0 \? <CalmTiles/);
});
