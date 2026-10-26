const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("the Now screen draws the decision core from counts it already has, and invents nothing", () => {
  const now = read("instrumentNow.tsx"), view = read("nowView.tsx");
  assert.match(now, /<AuroraCore tone=\{live \? "live" : "idle"\} decisionCount=\{live \? decisionCount : null\} orderCount=\{live \? orderCount : null\} lastHeartbeatAt=\{live \? lastHeartbeatAt : null\}/);
  assert.match(view, /orderCount=\{blocked \? null : dailyCounts\.paperOrderCount\}/);
  assert.doesNotMatch(read("decisionCore.tsx"), /decisionTrace|fetch\(|Math\.random\(\) *[<>]/, "no data source of its own; randomness only places waves and sparks");
});

test("the core stays still until the OS answers and under reduce-motion, and the risk-gate state keeps the amber ridge", () => {
  const core = read("decisionCore.tsx");
  assert.match(core, /if \(reducedMotion == null\) return undefined;/);
  assert.match(core, /const still = reducedMotion !== false;/);
  assert.match(core, /if \(reducedMotion === false\) \{\s*waves\.current/);
  assert.match(read("riskGateFlow.tsx"), /<DecisionRidge model=\{terrain\} tone="limit"/, "the limit state still shows where the day stopped");
  assert.match(read("recordsView.tsx"), /<DecisionRidge /);
});
