const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8").replace(/\r\n/g, "\n");

test("HOME folds secondary sections behind one toggle", () => {
  assert.match(source, /testID="home-details-toggle"/);
  assert.match(source, /시세 · 흐름 · 학습 자세히 보기/);
  assert.match(source, /moreOpen \? styles\.moreBlock : styles\.hiddenAcceptanceHooks/);
});

test("folded block stays mounted so acceptance markers remain exactly once", () => {
  assert.equal(source.match(/testID="home-more-block"/g).length, 1);
  const block = source.slice(source.indexOf('testID="home-more-block"'));
  assert.match(block, /home-market-canvas-reveal/);
  assert.doesNotMatch(source, /moreOpen &&/);
});
