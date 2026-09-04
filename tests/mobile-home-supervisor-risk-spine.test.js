const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical HOME keeps the approved visual hierarchy instead of restoring the legacy truth rail", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ai = home.indexOf('testID="ai-card"');
  const terrain = home.indexOf('testID="home-decision-stage"');
  const metrics = home.indexOf('testID="home-market-pulse"');
  assert.ok(ai >= 0 && terrain >= 0 && metrics >= 0);
  assert.ok(ai < terrain && terrain < metrics);
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
  assert.match(home, /nativeID="home-supervisor-learning"/);
  assert.match(home, /testID="home-paper-learning"/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});
