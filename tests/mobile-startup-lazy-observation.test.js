const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

function between(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return app.slice(from, to);
}

test("cold-start PAPER refresh does not wait on secondary observation surfaces", () => {
  const coreRefresh = between("const refresh = useCallback", "const refreshSupplemental = useCallback");
  assert.match(coreRefresh, /loadPersonalPaperOperations/);
  assert.doesNotMatch(coreRefresh, /loadShadowOperations/);
  assert.doesNotMatch(coreRefresh, /loadRealReadOnlyOperations/);
  assert.doesNotMatch(coreRefresh, /loadLiveReadinessOperations/);
});

test("secondary observation is navigation-driven and PAPER-only unavailable surfaces are not polled", () => {
  const supplemental = between("const refreshSupplemental = useCallback", "const refreshPublicMarkets = useCallback");
  assert.match(supplemental, /paperLearningOpen \|\| activeTab === "Paper"/);
  assert.match(supplemental, /activeTab === "Live"/);
  assert.match(supplemental, /Promise\.all\(\[/);
  assert.match(supplemental, /loadShadowOperations/);
  assert.match(supplemental, /loadRealReadOnlyOperations/);
  assert.match(supplemental, /loadLiveReadinessOperations/);
  assert.match(supplemental, /lastSupplementalRefreshKeyRef\.current === key/);

  const pollingMatch = app.match(/useEffect\(\(\) => \{\r?\n\s+refreshGenerationRef\.current \+= 1;[\s\S]*?useEffect\(\(\) => \{\r?\n\s+publicRefreshGenerationRef\.current \+= 1;/);
  assert.ok(pollingMatch, "missing canonical PAPER polling effect");
  const polling = pollingMatch[0];
  assert.match(polling, /PAPER_REFRESH_INTERVAL_MS/);
  assert.match(polling, /void refresh\(\)/);
  assert.doesNotMatch(polling, /refreshSupplemental/);
});

test("explicit pull-to-refresh can refresh the visible supplemental surface without serializing startup", () => {
  const manual = between("const onRefresh = useCallback", "const entryProfile =");
  assert.match(manual, /Promise\.all\(\[refresh\(\), refreshSupplemental\(true\)\]\)/);
});
