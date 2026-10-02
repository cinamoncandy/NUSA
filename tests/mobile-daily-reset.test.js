const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/dailyResetModel.ts"), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { applyDailyBaseline, nextDailyBaseline, resetDayKey } = shim.exports;
const kst = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 9, m);

test("window flips exactly at 09:00 KST, not at midnight KST", () => {
  assert.equal(resetDayKey(kst(2, 8, 59)), resetDayKey(kst(2, 0, 1)));
  assert.notEqual(resetDayKey(kst(2, 8, 59)), resetDayKey(kst(2, 9, 0)));
});
test("counts are relative to the window baseline and reset at 09:00", () => {
  const b = nextDailyBaseline(null, 1000, 5, kst(2, 10));
  assert.deepEqual({ ...applyDailyBaseline(b, 1500, 7, kst(2, 12)) }, { decisionCount: 500, paperOrderCount: 2 });
  assert.deepEqual({ ...applyDailyBaseline(b, 1800, 7, kst(3, 9, 0)) }, { decisionCount: 0, paperOrderCount: 0 });
});
test("server counter going backwards rebases; null stays null", () => {
  const b = nextDailyBaseline(null, 1000, 5, kst(2, 10));
  assert.equal(applyDailyBaseline(b, 10, 0, kst(2, 11)).decisionCount, 0);
  assert.equal(applyDailyBaseline(b, null, null, kst(2, 11)).decisionCount, null);
});
