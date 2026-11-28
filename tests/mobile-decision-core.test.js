const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("the Now screen draws the decision core from counts it already has, and invents nothing", () => {
  const now = read("instrumentNow.tsx"), view = read("nowView.tsx");
  assert.match(now, /<LatticeSphere decisionCount=\{live \? decisionCount : null\} orderCount=\{live \? orderCount : null\} fillCount=\{live \? fillCount : null\} live=\{live && tone === "NORMAL"\}/); // sphere replaced the island on 지금 (2026-11-25)
  assert.match(view, /orderCount=\{blocked \? null : dailyCounts\.paperOrderCount\}/);
  assert.doesNotMatch(read("decisionCore.tsx"), /decisionTrace|fetch\(|Math\.random\(\) *[<>]/, "no data source of its own; randomness only places waves and sparks");
});

test("the core stays still until the OS answers and under reduce-motion, and the risk-gate state shows the day as an hour ring around the sphere (UI v8)", () => {
  const core = read("decisionCore.tsx");
  assert.match(core, /if \(reducedMotion == null\) return undefined;/);
  assert.match(core, /const still = reducedMotion !== false;/);
  assert.match(core, /if \(reducedMotion === false\) \{\s*waves\.current/);
  assert.match(read("riskGateFlow.tsx"), /<HourDial model=\{terrain\}/, "the limit state still shows where the day stopped (amber hours)");
  assert.match(read("hourDialModel.ts"), /limit: model\.stop != null && i >= model\.stop\.row/);
  assert.match(read("recordsView.tsx"), /<HourDial /);
  assert.doesNotMatch(read("recordsView.tsx") + read("riskGateFlow.tsx"), /DecisionRidge/);
});
