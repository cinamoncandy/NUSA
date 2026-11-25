"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const SRC = path.join(__dirname, "..", "apps", "mobile", "src");
function load(name) {
  const out = ts.transpileModule(fs.readFileSync(path.join(SRC, `${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, (id) => load(id.replace(/^\.\//, "")));
  return mod.exports;
}
const records = load("recordsScreenModel");
const nav = load("navigationContract");

test("records tab covers every More destination exactly once, records first", () => {
  const list = records.recordsDestinations();
  assert.equal(list.length, nav.MORE_DESTINATIONS.length);
  assert.deepEqual([...list].sort(), [...nav.MORE_DESTINATIONS].sort());
  assert.equal(list[0], "OrderHistory");
});

test("no LIVE entry and no English codes in titles", () => {
  for (const group of records.RECORDS_GROUPS) for (const item of group.items) {
    assert.doesNotMatch(item.title + item.hint, /LIVE|실거래 시작/);
    assert.doesNotMatch(item.title, /[A-Z]{3,}/);
  }
});

test("source pin: the four 'what happened' entries render as tiles and every entry keeps its more- testID and onOpen", () => {
  const fs = require("node:fs"), path = require("node:path");
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "recordsView.tsx"), "utf8");
  assert.match(view, /g === 0 \? <View style=\{styles\.tiles\} testID="records-tiles">/);
  assert.equal((view.match(/testID=\{`more-\$\{item\.destination\}`\}/g) ?? []).length, 2, "tile and row both keep the testID");
  assert.equal((view.match(/onPress=\{\(\) => onOpen\(item\.destination\)\}/g) ?? []).length, 2);
  assert.match(view, /minHeight: 112/, "tile touch target");
  // PressScale wraps the Pressable in an Animated.View: the equal-width rule must sit on a plain View cell around it, or the grid collapses.
  assert.match(view, /<View key=\{item\.destination\} style=\{styles\.tileCell\}><PressScale/);
  assert.match(view, /tileCell: \{ width: "48%", flexGrow: 1 \}/);
  assert.doesNotMatch(view, /tile: \{[^}]*flexBasis/, "no width rule on the inner Pressable");
});
