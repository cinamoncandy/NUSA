const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");
const flow = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/riskGateFlow.tsx"), "utf8");

test("the Now screen tells where the flow stopped when the loss limit holds buys", () => {
  assert.match(view, /buildRiskGate\(\{ lossLimitState: lossLimit\?\.state \?\? null/);
  assert.match(view, /gate \? <RiskGateFlow gate=\{gate\} windowNote=\{partialWindowNote\(heartbeat\?\.buyCountsSince, Date\.now\(\)\)\} \/> : <View/);
  assert.match(view, /blocked \|\| field\.phase !== "ATTENTION" \? null/, "never over a stale, halted or degraded state");
});

test("the gate motion stops when the OS reduce-motion setting is on and uses only presentation", () => {
  assert.match(flow, /isReduceMotionEnabled\(\)/);
  assert.match(flow, /if \(reducedMotion\) return undefined;/);
  assert.match(flow, /useNativeDriver: true/);
  assert.doesNotMatch(flow, /fetch\(|apiClient|setState\(.*order/i, "no network or trading action");
});

test("the empty path after the gate is drawn as segments (a one-sided dashed border is solid on Android)", () => {
  assert.doesNotMatch(flow, /borderStyle: "dashed"/);
  assert.match(flow, /styles\.dash/);
});
