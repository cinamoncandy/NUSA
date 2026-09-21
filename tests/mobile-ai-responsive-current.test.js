const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Signal Detail explicitly supports 360 390 and 430px mobile acceptance widths", () => {
  const profile = read("src/mobileViewportProfile.ts");
  const ai = read("src/aiView.tsx");
  assert.match(profile, /MOBILE_ACCEPTANCE_WIDTHS = \[360, 390, 430\] as const/);
  assert.match(profile, /MOBILE_NARROW_MAX_WIDTH = 360/);
  assert.match(profile, /MOBILE_MIN_TOUCH_TARGET = 48/);
  assert.match(ai, /useWindowDimensions/);
  assert.match(ai, /getMobileViewportProfile\(width\)/);
  assert.match(ai, /viewport\.narrow\?styles\.titleRowNarrow:null/);
  assert.match(ai, /narrow\?styles\.analysisRowNarrow:null/);
  assert.match(ai, /style=\{styles\.aiDecisionSummary\}/);
});

test("narrow responsive behavior does not change AI authority", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit|productionMutationAllowed:\s*true/);
});

test("Signal Detail makes truthful convergence the visual hero without duplicate product chrome", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /testID="ai-convergence-signal"/);
  assert.match(ai, /testID="ai-stage-timeline"/);
  assert.match(ai, /AI 분석 진행 중/);
  assert.match(ai, /GATHER → ANALYZE → CONVERGE → DECIDE/);
  assert.match(ai, /GATHER/);
  assert.match(ai, /ANALYZE/);
  assert.match(ai, /VERIFY/);
  assert.match(ai, /DECIDE/);
  assert.match(ai, /stage\.observed\?"OBSERVED":"WAITING"/);
  assert.doesNotMatch(ai, /<View style=\{styles\.topbar\}>/);
  assert.match(ai, /watchButton:\{minHeight:48,borderWidth:1,borderColor:wealthProductColors\.c24/);
  assert.match(ai, /backgroundColor:"transparent"/);
});
