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
  assert.match(ai, /viewport\.narrow\?styles\.analysisRowNarrow:null/);
  assert.match(ai, /viewport\.narrow\?styles\.assetHeadNarrow:null/);
});

test("narrow responsive behavior does not change AI authority", () => {
  const ai = read("src/aiView.tsx");
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(ai, /ORDER_CREATE|LIVE_EXECUTION|onSubmit|productionMutationAllowed:\s*true/);
});
