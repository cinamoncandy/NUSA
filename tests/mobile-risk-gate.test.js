const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/nowView.tsx"), "utf8");
const flow = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/riskGateFlow.tsx"), "utf8");

test("the Now screen tells where the flow stopped when the loss limit holds buys", () => {
  assert.match(view, /buildRiskGate\(\{ lossLimitState: lossLimit\?\.state \?\? null/);
  assert.match(view, /gate \? <RiskGateFlow gate=\{gate\} lossText=\{lossLimit\?\.text \?\? null\} windowNote=\{partialWindowNote\(heartbeat\?\.buyCountsSince, Date\.now\(\)\)\} terrain=\{terrain\} decisionCount=\{dailyCounts\.decisionCount\} \/> : <InstrumentNow/);
  // The main motion graphic: the decision terrain is drawn from the server trace only while the snapshot is live.
  assert.match(view, /const terrain = buildDecisionTerrain\(\{ trace: blocked \? null : traceSource\?\.decisionTrace, now: Date\.now\(\), limitReachedAt: blocked \? null : rawLossLimit\?\.limitReachedAt \}\);/);
  assert.match(view, /consecutiveLossCount: rawLossLimit\?\.consecutiveLossCount, maxConsecutiveLosses: rawLossLimit\?\.maxConsecutiveLosses/);
  assert.match(view, /blocked \|\| field\.phase !== "ATTENTION" \? null/, "never over a stale, halted or degraded state");
});

test("the instrument block keeps every loop on the native driver and stops it for reduce-motion", () => {
  const kit = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/instrumentKit.tsx"), "utf8");
  assert.match(kit, /isReduceMotionEnabled\(\)/);
  assert.doesNotMatch(flow + kit, /useNativeDriver: false/);
  assert.match(flow, /if \(reducedMotion !== false \|\| width <= 0\) return undefined;/);
  assert.match(kit, /if \(reducedMotion !== false \|\| width <= 0\) \{ x\.setValue\(0\); return undefined; \}/);
  assert.match(kit, /useState<boolean \| null>\(null\)/, "nothing moves before the OS answers");
  assert.doesNotMatch(flow + kit, /fetch\(|apiClient|setState\(.*order/i, "no network or trading action");
});

test("an unknown counter is left out, never drawn as 0, and the order side stays empty", () => {
  assert.match(flow, /gate\.signals == null \? null :/);
  assert.match(flow, /gate\.waiting == null \? null :/);
  assert.match(flow, /\(n == null \? "\u2014"/);
  assert.match(flow, /styles\.dash/);
  assert.doesNotMatch(flow, /borderStyle: "dashed"/, "a one-sided dashed border renders solid on Android");
});
