const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");

test("the Now tab shows the existing learning line, never while the snapshot is stale or blocked", () => {
  assert.match(view, /import \{ buildLearningLine \} from "\.\/learningLineModel";/);
  assert.match(view, /const learningLine = blocked \? null : buildLearningLine\(snapshot\?\.research \?\? null\);/);
  assert.match(view, /testID="now-learning-line"/);
});

test("a warning from the learning model is shown in the attention colour, otherwise muted", () => {
  assert.match(view, /learningLine\.tone === "warn" \? calmColors\.attention : calmColors\.muted/);
});
