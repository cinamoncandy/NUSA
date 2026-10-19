const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");
const flow = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/riskGateFlow.tsx"), "utf8");

test("the Now screen tells where the flow stopped when the loss limit holds buys", () => {
  assert.match(view, /buildRiskGate\(\{ lossLimitState: lossLimit\?\.state \?\? null/);
  assert.match(view, /gate \? <RiskGateFlow gate=\{gate\} \/> : <View/);
  assert.match(view, /blocked \|\| field\.phase !== "ATTENTION" \? null/, "never over a stale, halted or degraded state");
});

test("the gate motion stops when the OS reduce-motion setting is on and uses only presentation", () => {
  assert.match(flow, /isReduceMotionEnabled\(\)/);
  assert.match(flow, /if \(reducedMotion\) return undefined;/);
  assert.match(flow, /useNativeDriver: true/);
  assert.doesNotMatch(flow, /fetch\(|apiClient|setState\(.*order/i, "no network or trading action");
});
