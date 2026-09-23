const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeDecisionSurface.ts"), "utf8");

test("HOME keeps operational recovery as small chrome without replacing the intelligence composition", () => {
  // The board's HOME scan order: the PAPER equity hero, then the runtime status cards, then the
  // capital envelope, and only then the learning route. Recovery chrome stays below all of it.
  const hero = home.indexOf('testID="account-hero-card"');
  const ai = home.indexOf('testID="home-ai-judgement"');
  const capital = home.indexOf('testID="home-capital-limits"');
  const learning = home.indexOf('testID="home-paper-learning"');
  const notice = home.indexOf('testID="home-operational-notice"');

  assert.ok([hero, ai, capital, learning, notice].every((index) => index >= 0), "every HOME landmark must render");
  assert.ok(hero < ai && ai < capital && capital < learning);
  assert.ok(notice > capital, "connection recovery remains operational chrome rather than replacing HOME");
  assert.match(home, /PAPER CONNECTION REQUIRED/);
  assert.match(home, /PAPER READ-ONLY ERROR/);
  assert.match(home, /onPress=\{props\.onGoSettings\}/);
  assert.doesNotMatch(home, /testID="home-supervisor-primary-action"/);

  assert.match(decisionSurface, /const WATCH_RUNTIME_STATES = new Set\(\["DEGRADED", "STOPPED", "STOPPING"\]\)/);
  assert.match(decisionSurface, /runtimeNeedsSupervision\s*\n\s*\? "SUPERVISE PAPER"/);
});

test("HOME connection failure outranks stale AI thesis in the canonical fail-closed decision model", () => {
  assert.match(home, /const disconnected = props\.notConfigured != null && !localPaperActive/);
  assert.match(home, /const decision = buildHomeDecisionSurface\(\{[\s\S]*disconnected,[\s\S]*readOnlyError: props\.readOnlyError != null/);
  // No evidence rows on HOME in the approved layout; the decision surface still gates the signal.
  assert.match(home, /const signalAvailable = decision\.aiInsightAvailable/);

  const whyStart = decisionSurface.indexOf("const why = input.disconnected");
  const degradedIndex = decisionSurface.indexOf(': runtimeState === "DEGRADED"', whyStart);
  const aiInsightIndex = decisionSurface.indexOf(": aiInsightAvailable", whyStart);
  assert.notEqual(whyStart, -1);
  assert.notEqual(degradedIndex, -1);
  assert.notEqual(aiInsightIndex, -1);
  assert.ok(degradedIndex < aiInsightIndex, "runtime failure WHY must win before AI thesis in the safety model");
  assert.match(decisionSurface, /PAPER runtime 상태가 저하되어 감독자의 확인이 필요합니다/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
