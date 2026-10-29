"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");
const { TAB_ICON_PATHS, TAB_ICON_ACTIVE } = require("../dist/apps/mobile/src/tabIconsModel.js");
const { PRIMARY_DESTINATIONS } = require("../dist/apps/mobile/src/navigationContract.js");

test("every primary tab has an island-style icon inside the 24 grid", () => {
  for (const d of PRIMARY_DESTINATIONS) {
    const paths = TAB_ICON_PATHS[d];
    assert.ok(paths && paths.length > 0, `${d} has an icon`);
    for (const [path, opacity] of paths) {
      assert.ok(opacity > 0 && opacity <= 1);
      for (const n of path.match(/-?\d+(\.\d+)?/g).map(Number)) assert.ok(n >= -12 && n <= 24, `${d}: ${n} stays on the grid`);
    }
  }
  assert.deepEqual([...TAB_ICON_ACTIVE], ["#7C54FF", "#46D7FF"]);
});

test("the tab bar draws the icon under the selected-only indicator and keeps the text label", () => {
  const nav = read("primaryNavigation.tsx");
  assert.match(nav, /<TabIcon destination=\{destination\} active=\{active\} muted=\{ui\.color\.textMuted\} \/>/);
  assert.match(nav, /opacity: active \? 1 : 0 \}/);
  assert.match(nav, /primaryDestinationDisplayLabels\[destination\]/);
});
