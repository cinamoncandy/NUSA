const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homePath = path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx");

// Canonical HOME consumes the verified Cloud PAPER operations projection. LOCAL PAPER is a
// separate ledger and must not be mislabeled as if it came through this Cloud projection.
test("HOME visibly identifies Cloud PAPER capital and never invents LOCAL provenance", () => {
  const home = fs.readFileSync(homePath, "utf8");

  assert.match(home, /const capitalLabel = account == null \? "PAPER CAPITAL UNAVAILABLE" : "CLOUD PAPER CAPITAL"/);
  assert.match(home, /\{capitalLabel\}/);
  assert.match(home, /CLOUD PAPER CAPITAL/);
  assert.doesNotMatch(home, /LOCAL PAPER CAPITAL/);
});
