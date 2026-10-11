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
const { buildSafetyScreen } = load("safetyScreenModel");

test("LIVE reads locked and AI advisory with no server data at all", () => {
  const m = buildSafetyScreen(null, []);
  assert.deepEqual(m.rows.map((r) => [r.label, r.value]), [["실거래", "잠김 · 영구"], ["AI", "권한 없음"]]);
});

test("even all gates passing never says LIVE is on; blocked gates are amber", () => {
  const gates = { passed: 2, total: 3, headline: "", detail: "", gates: [
    { id: "a", title: "A", detail: "", state: "PASS" },
    { id: "b", title: "B", detail: "", state: "BLOCKED" },
    { id: "c", title: "C", detail: "", state: "UNKNOWN" },
  ] };
  const m = buildSafetyScreen(gates, ["X_BLOCKER"]);
  assert.equal(m.rows[0].value, "잠김 · 영구");
  assert.equal(m.rows.find((r) => r.label === "B").tone, "ATTENTION");
  assert.equal(m.rows.find((r) => r.label === "C").value, "확인 중");
  assert.ok(m.rows.every((r) => !/켜짐|활성|ENABLED/.test(r.value)));
  assert.ok(m.advanced.includes("blocker: X_BLOCKER"));
});
