const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("DesktopPersistenceStore delegates scenario evidence storage to its domain module", () => {
  const facade = read("apps/desktop/src/persistence/desktopPersistenceStore.ts");
  const store = read("apps/desktop/src/persistence/scenarioEvidenceStore.ts");

  assert.match(facade, /import \* as scenarioEvidenceStore from "\.\/scenarioEvidenceStore"/);
  assert.match(facade, /scenarioEvidenceStore\.appendScenarioEvents\(this\.db, events\)/);
  assert.match(facade, /return scenarioEvidenceStore\.loadScenarioEvents\(this\.db\)/);
  assert.doesNotMatch(facade, /SELECT COALESCE\(MAX\(sequence\), 0\).*desktop_paper_scenario_evidence/);
  assert.doesNotMatch(facade, /scenario evidence sequence is not contiguous/);

  assert.match(store, /export function appendScenarioEvents/);
  assert.match(store, /export function loadScenarioEvents/);
  assert.match(store, /scenario evidence sequence is not contiguous/);
  assert.match(store, /unsupported scenario evidence event type/);
  assert.match(store, /scenario evidence ordering is invalid/);
});
