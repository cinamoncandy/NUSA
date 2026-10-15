const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/lossLimitModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildLossLimitLine, buildTodayRealizedLine } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
const contract = fs.readFileSync(path.resolve(__dirname, "../packages/contracts/src/personalPaperOperations.ts"), "utf8");

// 2026-10-14 06:00 UTC = 15:00 KST.
const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);

test("a reached limit tells the owner buying is paused until KST midnight", () => {
  const line = buildLossLimitLine({ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW - 60_000 }, NOW);
  assert.equal(line.state, "STOPPED");
  assert.match(line.text, /연속 3번 손실/);
  assert.match(line.text, /자정/);
});

test("one loss before the limit is a warning; fewer losses show nothing", () => {
  assert.equal(buildLossLimitLine({ consecutiveLossCount: 2, maxConsecutiveLosses: 3, evaluatedAt: NOW }, NOW).state, "WARNING");
  assert.equal(buildLossLimitLine({ consecutiveLossCount: 1, maxConsecutiveLosses: 3, evaluatedAt: NOW }, NOW), null);
  assert.equal(buildLossLimitLine({ consecutiveLossCount: 0, maxConsecutiveLosses: 1, evaluatedAt: NOW }, NOW), null);
});

test("an evaluation from an earlier KST day is not shown, even if it is only minutes old", () => {
  const kstMidnight = Date.UTC(2026, 9, 14, 15, 0, 0);
  assert.equal(buildLossLimitLine({ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: kstMidnight - 1 }, kstMidnight + 60_000), null);
  assert.notEqual(buildLossLimitLine({ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: kstMidnight }, kstMidnight + 60_000), null);
});

test("malformed or future values are never guessed into a line", () => {
  for (const bad of [null, undefined, [], "3/3", { consecutiveLossCount: 3 }, { consecutiveLossCount: 3.5, maxConsecutiveLosses: 3, evaluatedAt: NOW },
    { consecutiveLossCount: 3, maxConsecutiveLosses: 0, evaluatedAt: NOW }, { consecutiveLossCount: -1, maxConsecutiveLosses: 3, evaluatedAt: NOW },
    { consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW + 1 }]) {
    assert.equal(buildLossLimitLine(bad, NOW), null, JSON.stringify(bad));
  }
});

test("the server sends the gateway's own loss state as a display-only heartbeat value, and the contract drops malformed values", () => {
  assert.match(runtime, /productionPaperRiskGate\?\.lossSession\(\)/);
  assert.match(runtime, /\.\.\.lossLimitHeartbeat\(\)/);
  assert.match(contract, /readonly lossLimit\?: PersonalPaperLossLimit;/);
  assert.match(contract, /if \(record\.lossLimit !== undefined && !isValidLossLimit\(record\.lossLimit\)\) delete record\.lossLimit;/);
});

test("the Now tab shows the line and never while the snapshot is stale or blocked", () => {
  assert.match(view, /const lossLimit = blocked \? null : buildLossLimitLine\(heartbeat\?\.lossLimit, Date\.now\(\), /);
  assert.match(view, /testID="now-loss-limit"/);
});

test("with another stop in force the line never promises a midnight restart", () => {
  const line = buildLossLimitLine({ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW }, NOW, true);
  assert.equal(line.state, "STOPPED");
  assert.doesNotMatch(line.text, /자정에 다시 시작해요/);
  assert.match(line.text, /다른 정지 사유/);
  assert.match(view, /buildLossLimitLine\(heartbeat\?\.lossLimit, Date\.now\(\), haltCause != null \|\| field\.phase === "HALTED"\)/);
});

test("the display is read-only for both active and owner-disabled PAPER policies", () => {
  for (const enabled of [true, false]) {
    const payload = Object.freeze({ consecutiveLossCount: 3, maxConsecutiveLosses: 3, evaluatedAt: NOW, consecutiveLossLimitEnabled: enabled });
    const before = JSON.stringify(payload);
    const line = buildLossLimitLine(payload, NOW);
    assert.equal(JSON.stringify(payload), before);
    assert.equal(line.state, enabled ? "STOPPED" : "DISABLED");
    if (!enabled) {
      assert.match(line.text, /제한 해제/);
      assert.doesNotMatch(line.text, /자정에 다시 시작|새로 사지 않아요/);
    }
  }
  const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/lossLimitModel.ts"), "utf8");
  assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(|\bfetch\s*\(|\.evaluate\s*\(|\.execute\s*\(/);
});

test("today's realized P&L reads as a signed won amount, only for today's KST day", () => {
  assert.deepEqual({ ...buildTodayRealizedLine({ realizedPnlKrw: 12345.4, evaluatedAt: NOW }, NOW) }, { tone: "NORMAL", text: "오늘 확정 손익 +12,345원" });
  assert.deepEqual({ ...buildTodayRealizedLine({ realizedPnlKrw: -8000, evaluatedAt: NOW }, NOW) }, { tone: "LOSS", text: "오늘 확정 손익 -8,000원" });
  assert.equal(buildTodayRealizedLine({ realizedPnlKrw: 0.3, evaluatedAt: NOW }, NOW).text, "오늘 확정 손익 0원");
  const kstMidnight = Date.UTC(2026, 9, 14, 15, 0, 0);
  assert.equal(buildTodayRealizedLine({ realizedPnlKrw: 5, evaluatedAt: kstMidnight - 1 }, kstMidnight + 1), null);
  for (const bad of [null, {}, { realizedPnlKrw: Number.NaN, evaluatedAt: NOW }, { realizedPnlKrw: "1", evaluatedAt: NOW }, { realizedPnlKrw: 1, evaluatedAt: NOW + 1 }]) {
    assert.equal(buildTodayRealizedLine(bad, NOW), null, JSON.stringify(bad));
  }
});

test("today's P&L is computed from the PAPER loop's fills outside RISK and wired to the Now tab", () => {
  assert.match(runtime, /computeTodayRealizedPnlKrw\(account\.fills, account\.positions, now\)/);
  assert.match(runtime, /\.\.\.todayRealizedHeartbeat\(\)/);
  assert.doesNotMatch(runtime, /dailyRealized\(\)/);
  assert.match(contract, /if \(record\.todayRealized !== undefined && !isValidTodayRealized\(record\.todayRealized\)\) delete record\.todayRealized;/);
  assert.match(view, /const todayRealized = blocked \? null : buildTodayRealizedLine\(heartbeat\?\.todayRealized, Date\.now\(\)\);/);
  assert.match(view, /testID="now-today-realized"/);
});
