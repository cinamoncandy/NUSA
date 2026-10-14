const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/lossLimitModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildLossLimitLine } = shim.exports;
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

test("the RISK gateway source is not touched by this display change", () => {
  const { execFileSync } = require("node:child_process");
  const changed = execFileSync("git", ["diff", "--name-only", "origin/main", "--", "apps/cloud/src/cloudPaperCanonicalRiskGateway.ts"], { encoding: "utf8" }).trim();
  assert.equal(changed, "");
});
