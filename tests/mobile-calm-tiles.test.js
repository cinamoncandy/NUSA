"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", name), "utf8").replace(/\r\n/g, "\n");

// UI v7 phase 5b (docs/NUSA_MOBILE_UIUX_V6_CALM_FIELD.md): the tile form of a short group of rows, the same tile as 기록.
test("CalmTiles shows exactly the rows it is given in two columns, the last odd tile full width, with an accessible label", () => {
  const kit = read("uiKit.tsx");
  const tiles = kit.slice(kit.indexOf("export function CalmTiles"), kit.indexOf("export function CalmTitle"));
  assert.match(tiles, /rows\.map\(\(row, i\) =>/);
  assert.match(tiles, /rows\.length % 2 === 1 && i === rows\.length - 1 && styles\.tileFull/);
  assert.match(tiles, /accessibilityLabel=\{`\$\{row\.label\}\. \$\{row\.value\}\./);
  assert.match(tiles, /calmToneColor\(row\.tone \?\? "NORMAL"\)/);
  assert.doesNotMatch(tiles, /Math\.random|Date\.now|fetch\(/, "no value of its own");
  assert.match(kit, /tileCell: \{ width: "48%", flexGrow: 1 \}/, "the width rule sits on a plain View cell, as on the 기록 tiles");
});

test("선물 shows its 상태 group and 학습 its result rows as tiles; other groups and the bars stay rows", () => {
  const futures = read("futuresView.tsx");
  assert.match(futures, /s\.title === "상태" \? <CalmTiles rows=\{s\.rows\} testID="futures-status-tiles" \/>/);
  assert.match(futures, /<UsageBar bar=\{row\.bar\}/, "the usage bars stay");
  const learning = read("learningView.tsx");
  assert.match(learning, /<CalmTiles rows=\{model\.rows\} testID="learning-result-tiles" \/>/);
  assert.match(learning, /testID="learning-result-period"/, "the measurement period line stays above the tiles");
});
