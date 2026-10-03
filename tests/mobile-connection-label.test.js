const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/connectionLabelModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { connectionLabel, connectionLabelKey, CONNECTION_LABEL_KO } = shim.exports;
const base = { recovering: false, stale: false, disconnected: false, readOnlyError: false, readyForPaperOperations: false };
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");

test("every state reads in plain Korean, with no English state word left on the capsule", () => {
  assert.equal(connectionLabel({ ...base, readyForPaperOperations: true }), "작동 중");
  assert.equal(connectionLabel(base), "확인 중");
  assert.equal(connectionLabel({ ...base, readOnlyError: true }), "연결 불안정");
  assert.equal(connectionLabel({ ...base, disconnected: true }), "연결 필요");
  assert.equal(connectionLabel({ ...base, recovering: true, disconnected: true }), "재연결 중");
  assert.equal(connectionLabel({ ...base, stale: true }), "이전 값");
  for (const text of Object.values(CONNECTION_LABEL_KO)) assert.doesNotMatch(text, /[A-Za-z]/);
});

test("the order never softens a problem: recovery, cached and setup win over active, and an error over ready", () => {
  assert.equal(connectionLabelKey({ ...base, recovering: true, stale: true, disconnected: true, readOnlyError: true, readyForPaperOperations: true }), "RECOVERING");
  assert.equal(connectionLabelKey({ ...base, stale: true, readyForPaperOperations: true }), "CACHED", "an old cached value is never 작동 중");
  assert.equal(connectionLabelKey({ ...base, disconnected: true, readyForPaperOperations: true }), "SETUP");
  assert.equal(connectionLabelKey({ ...base, readOnlyError: true, readyForPaperOperations: true }), "DEGRADED");
});

test("HOME renders the capsule from the model", () => {
  assert.match(view, /connectionLabel\(\{ recovering, stale, disconnected/);
  assert.doesNotMatch(view, /"OBSERVING"|"ACTIVE"/, "no English state strings are left in HOME");
});
