const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical HOME keeps the approved content-first intelligence hierarchy", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  // The concept board replaced the old market-breadth / top-signals panels with three runtime
  // status cards; the market list itself is the Market tab. The spine that remains: PAPER equity
  // first, then system and per-domain status, then the capital envelope, then the learning route.
  const hero = home.indexOf('testID="account-hero-card"');
  const system = home.indexOf('testID="home-system-status"');
  const pulse = home.indexOf('testID="home-market-status"');
  const paper = home.indexOf('testID="home-paper-status"');
  const ai = home.indexOf('testID="home-ai-judgement"');
  const capital = home.indexOf('testID="home-capital-limits"');
  const learning = home.indexOf('testID="home-paper-learning"');
  assert.ok([hero, system, pulse, paper, ai, capital, learning].every((index) => index >= 0));
  assert.ok(hero < system && system < pulse && pulse < paper && paper < ai && ai < capital && capital < learning);
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
  assert.match(home, /testID="home-paper-learning"/);
  // The Android release contract requires a supervisor-learning role on HOME distinct from the
  // PAPER learning route. It had degenerated into a 1x1 opacity-0 node, so assert the surface as
  // well as the marker: it renders decision.learning, which is fail-closed, and is not hidden.
  assert.match(home, /testID="home-supervisor-learning"><Text style=\{styles\.supervisorLearning\}[^>]*>\{decision\.learning\}/);
  assert.doesNotMatch(home, /position:"absolute",width:1,height:1,opacity:0/);
  assert.equal((home.match(/testID="home-paper-learning"/g) ?? []).length, 1);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
});
