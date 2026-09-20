const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "paperLearningMonitorView.tsx"), "utf8");

test("PAPER surface leads with a truthful report hero instead of generic stacked infrastructure cards", () => {
  assert.match(source, /function PaperReportHero/);
  assert.match(source, /testID="paper-report-hero"/);
  assert.match(source, /VERIFIED PAPER REPORT/);
  assert.match(source, /TOTAL P&L/);
  assert.match(source, /EQUITY/);
  assert.match(source, /MARKET/);
  assert.match(source, /CYCLE \{state\.currentCycle \?\? "—"\}/);
});

test("PAPER stage timeline reflects observed evidence presence only", () => {
  assert.match(source, /testID="paper-report-stage-timeline"/);
  assert.match(source, /event\.stage === "MARKET_DATA"/);
  assert.match(source, /state\.latestDecision != null/);
  assert.match(source, /state\.latestRisk != null/);
  assert.match(source, /state\.latestFill != null/);
  assert.match(source, /state\.latestEvidence != null/);
  assert.match(source, /stage\.observed \? "OBSERVED" : "WAITING"/);
  assert.match(source, /do not imply approval, profit probability, or execution authority/);
  assert.doesNotMatch(source, /stage\.observed \? "COMPLETE"/);
});

test("PAPER report keeps the canonical authority boundary visible", () => {
  assert.match(source, /AUTONOMOUS PAPER · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(source, /PAPER ONLY/);
  assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(source, /authority:\s*"LIVE"/);
});
