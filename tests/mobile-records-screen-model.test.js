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
