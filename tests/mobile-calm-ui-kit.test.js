"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", file), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", out)(mod, mod.exports);
  return mod.exports;
}
const kit = load("uiKitModel.ts");

test("colour carries meaning only; unknown and zero deltas are never gain or loss", () => {
  assert.equal(kit.calmDeltaTone(-219), "LOSS");
  assert.equal(kit.calmDeltaTone(0), "MUTED");
  assert.equal(kit.calmDeltaTone(null), "MUTED");
  assert.equal(kit.calmDeltaTone(Number.NaN), "MUTED");
  assert.equal(kit.calmDeltaTone(5), "NORMAL");
  assert.equal(kit.calmToneColor("ORDER"), kit.calmColors.order);
});

test("only consecutive identical groupable rows collapse; orders never do", () => {
  const rows = [
    { key: "a", atMs: 3, text: "대기", groupable: true },
    { key: "b", atMs: 2, text: "대기", groupable: true },
    { key: "c", atMs: 1, text: "매수 체결", groupable: false },
    { key: "d", atMs: 0, text: "매수 체결", groupable: false },
  ];
  const out = kit.groupCalmRows(rows);
  assert.equal(out.length, 3);
  assert.equal(out[0].count, 2);
  assert.equal(out[1].count, 1);
  assert.equal(out[2].count, 1);
});
