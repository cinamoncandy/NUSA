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

test("the gate scene is a Skia particle picture; reduce-motion draws one settled still frame and no loop", () => {
  assert.match(flow, /isReduceMotionEnabled\(\)/);
  assert.match(flow, /from "@shopify\/react-native-skia"/);
  assert.match(flow, /if \(reducedMotion\) \{ warmGateField\(field, 12, g\); render\(\); return undefined; \}/);
  assert.match(flow, /cancelAnimationFrame\(frame\)/);
  assert.doesNotMatch(flow, /fetch\(|apiClient|setState\(.*order/i, "no network or trading action");
});

test("the scene reads no server value and keeps the channel after the gate empty", () => {
  const model = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/riskGateParticles.ts"), "utf8");
  assert.doesNotMatch(model, /fetch\(|apiClient|heartbeat|snapshot|order(?:Count)?\b.*=/i);
  assert.match(flow, /nothing went out, so the channel stays a dotted, empty line/);
  assert.match(flow, /testID="now-risk-gate-scene"/);
});
