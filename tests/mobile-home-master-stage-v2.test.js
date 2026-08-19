const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", relative), "utf8");

test("HOME upper half is one dominant signal stage, not stacked document sections", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /testID="home-signal-stage"/);
  assert.match(home, /signalStage: \{ minHeight: 510/);
  assert.match(home, /testID="home-stage-canvas"/);
  assert.match(home, /stageCanvas: \{ height: 300/);
  assert.match(home, /testID="home-ai-judgement"/);
  assert.match(home, /testID="home-indicator-strip"/);
  assert.doesNotMatch(home, /PRIMARY INDICATORS/);
  assert.doesNotMatch(home, /<InsightPanel/);
  assert.doesNotMatch(home, /<CompactMetric/);
});

test("HOME keeps unavailable data honest while preserving the visual composition", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /account \? krw\(account\.equity\) : "-"/);
  assert.match(home, /NO VERIFIED SIGNAL/);
  assert.match(home, /실제 근거가 확인되기 전에는 판단을 만들지 않습니다/);
  assert.match(home, /PAPER 연결이 필요합니다/);
  assert.match(home, /<OperationalNotice/);
});

test("HOME preserves PAPER-only and AI zero-authority boundaries", () => {
  const home = read("src/homeView.tsx");
  assert.match(home, /AI JUDGEMENT · READ ONLY/);
  assert.match(home, /ZERO AUTHORITY/);
  assert.match(home, /LIVE \{snapshot\?\.liveAuthority \?\? "NONE"\}/);
  assert.match(home, /PRODUCTION MUTATION \{snapshot\?\.productionMutationAllowed \? "ALLOWED" : "BLOCKED"\}/);
  assert.doesNotMatch(home, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(home, /authority:\s*"LIVE"/);
});
