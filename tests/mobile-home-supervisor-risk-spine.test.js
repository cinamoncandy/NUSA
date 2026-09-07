const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical HOME keeps the content-first command center hierarchy instead of restoring the legacy truth rail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const risk = home.indexOf('testID="home-risk-status"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const performance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(ai >= 0 && risk >= 0 && terrain >= 0 && performance >= 0 && learning >= 0);
  assert.ok(terrain < performance && performance < learning && learning < ai && ai < risk);
  assert.doesNotMatch(home, /<TruthCell label="(?:NOW|WHY|RESULT|RISK|LEARNING)"/);
});

test("canonical decision risk remains fail-closed and derives only from PAPER runtime/safety evidence", () => {
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  assert.match(decisionSurface, /const risk = input\.disconnected/);
  assert.match(decisionSurface, /"BLOCKED · PAPER LINK REQUIRED"/);
  assert.match(decisionSurface, /"BLOCKED · READ-ONLY RECOVERY REQUIRED"/);
  assert.match(decisionSurface, /runtimeActionRequired/);
  assert.match(decisionSurface, /runtimeWatch/);
  assert.match(decisionSurface, /input\.accountSource !== "CLOUD"\s*\n\s*\? "INSUFFICIENT · PAPER RUNTIME EVIDENCE UNAVAILABLE"/);
  assert.match(decisionSurface, /signalReady\s*\n\s*\? "PAPER ONLY · SAFETY GATES READY · LIVE NONE"/);
  assert.match(decisionSurface, /"WATCH · PAPER SAFETY GATES NOT READY"/);
  assert.doesNotMatch(decisionSurface, /(?:LIVE READY|LIVE ACTIVE|LIVE ENABLED|LIVE AUTHORIZED)/);
});

test("canonical HOME preserves zero-authority safety and one PAPER learning route", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(home, /testID="home-supervisor-learning"/);
  assert.equal((home.match(/testID="home-paper-learning"/g) ?? []).length, 1);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});
