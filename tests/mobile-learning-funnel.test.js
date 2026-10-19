const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const runtime = read("apps/cloud/src/runtime.ts");
const view = read("apps/mobile/src/learningView.tsx");
const funnel = read("apps/mobile/src/learningFunnel.tsx");
const app = read("apps/mobile/App.tsx");

test("the heartbeat carries the Research funnel as integers from the closed-learning status only", () => {
  assert.match(runtime, /const learningFunnelHeartbeat = \(\): \{ learningFunnel\?: PersonalPaperLearningFunnel \} =>/);
  assert.match(runtime, /Number\.isSafeInteger\(v\) && \(v as number\) >= 0/);
  assert.match(runtime, /\.\.\.research, \.\.\.learningFunnelHeartbeat\(\) \}\)/);
});

test("the Learning screen shows the funnel only from a live snapshot, and its motion respects reduce-motion", () => {
  assert.match(app, /learningFunnel=\{snapshot\?\.operations\.heartbeat\?\.learningFunnel \?\? null\}/);
  assert.match(view, /const funnel = buildLearningFunnel\(learningFunnel\);/);
  assert.match(view, /<PaperShadowMonitorView \{\.\.\.monitorProps\} \/>/, "the detail monitors do not receive the extra prop");
  assert.match(funnel, /isReduceMotionEnabled\(\)/);
  assert.match(funnel, /if \(reducedMotion \|\| width === 0\) return undefined;/);
});
