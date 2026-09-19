const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical HOME keeps the Runtime Canvas hierarchy and does not restore a synthetic risk veto", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const runtime = home.indexOf('testID="home-status-rail"');
  const judgment = home.indexOf('testID="home-intelligence-reveal"');
  const evidence = home.indexOf('testID="ai-card"');
  const validation = home.indexOf('testID="home-confidence-evidence-quality"');
  const market = home.indexOf('testID="home-market-canvas-reveal"');
  const performance = home.indexOf('testID="home-paper-performance"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok(runtime >= 0 && judgment >= 0 && evidence >= 0 && validation >= 0 && market >= 0 && performance >= 0 && learning >= 0);
  assert.ok(runtime < judgment && judgment < evidence && evidence < validation && validation < market && market < performance && performance < learning);
  assert.doesNotMatch(home, /RISK VETO|REJECTED SIGNALS|SIGNAL FUNNEL/);
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
  assert.match(home, /PAPER ONLY · LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.match(home, /testID="home-supervisor-learning"/);
  assert.equal((home.match(/testID="home-paper-learning"/g) ?? []).length, 1);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});
