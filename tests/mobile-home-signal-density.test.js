const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME keeps verified market observation substantial and mobile-first", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const \{ width \} = useWindowDimensions\(\);/);
  assert.match(home, /const compact = width < 380;/);
  assert.match(home, /maxWidth: 720/);
  assert.match(home, /contentCompact/);
  assert.match(home, /const publicState = publicMarketStale \? "STALE"/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, />MARKET \{publicState\}</);
  assert.match(home, /testID="home-market-canvas-reveal"/);
  assert.match(home, /OBSERVATION CONTEXT/);
  assert.match(home, /publicMarketConnectionState \|\| "UNKNOWN"/);
});

test("HOME runtime canvas prioritizes truth, judgment, validation, then progressive context", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const runtime = home.indexOf('testID="home-status-rail"');
  const judgment = home.indexOf('testID="home-intelligence-reveal"');
  const evidence = home.indexOf('>근거</Text>');
  const validation = home.indexOf('>불확실성 / 검증</Text>');
  const aiDetail = home.indexOf('testID="home-ai-detail-action"');
  const market = home.indexOf('testID="home-market-canvas-reveal"');
  const paper = home.indexOf('testID="home-capital-reveal"');
  const learning = home.indexOf('testID="home-paper-learning"');

  assert.ok(runtime >= 0, "runtime truth must exist");
  assert.ok(judgment >= 0, "judgment brief must exist");
  assert.ok(evidence >= 0, "evidence must exist");
  assert.ok(validation >= 0, "validation/uncertainty must exist");
  assert.ok(aiDetail >= 0, "progressive AI detail action must exist");
  assert.ok(market >= 0, "market observation context must exist");
  assert.ok(paper >= 0, "PAPER context must exist");
  assert.ok(learning >= 0, "learning evidence action must exist");

  assert.ok(runtime < judgment, "operational and market truth must lead the judgment brief");
  assert.ok(judgment < evidence, "judgment must lead detailed evidence");
  assert.ok(evidence < validation, "evidence must lead validation detail");
  assert.ok(validation < market, "decision validation must lead secondary market context");
  assert.ok(market < paper, "market context must lead secondary PAPER capital context");
  assert.ok(paper < learning, "PAPER context must contain the learning drill-down");
});

test("HOME avoids false precision and AI theatre", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const calibrated = aiAvailable && ai\.calibrationStatus === "CALIBRATED";/);
  assert.match(home, /calibrated \? probability\(ai\.confidence\) : "표시 안 함"/);
  assert.match(home, /runtime\?\.pipelineStage \|\| "UNAVAILABLE"/);
  assert.match(home, /LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /IntelligenceMotionField/);
  assert.doesNotMatch(home, /OBSERVE → REASON → VERIFY → DECIDE/);
  assert.doesNotMatch(home, /BUY|SELL|주문 제출/);
});