const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src", file), "utf8");

test("More groups cover every destination exactly once and keep row test ids", () => {
  const view = read("moreMenuView.tsx");
  const nav = read("navigationContract.ts");
  const destinations = [...nav.match(/MORE_DESTINATIONS[^=]*= Object\.freeze\(\[([\s\S]*?)\]\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const groups = [...view.match(/const GROUPS[\s\S]*?\]\);/)[0].matchAll(/items: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]));
  assert.deepEqual([...groups].sort(), [...destinations].sort());
  assert.equal(new Set(groups).size, groups.length);
  assert.match(view, /testID=\{`more-\$\{destination\}`\}/);
  assert.match(view, /testID="more-view"/);
});

test("More rows use plain Korean hints, not English duplicates or sequence numbers", () => {
  const view = read("moreMenuView.tsx");
  assert.doesNotMatch(view, /padStart/);
  assert.doesNotMatch(view, /hint: "(Strategies|Portfolio|Risk|Performance|Settings|Help)"/);
});
