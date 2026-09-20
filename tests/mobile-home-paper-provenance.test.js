const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homePath = path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx");

// Cloud PAPER and LOCAL PAPER are intentionally separate ledgers. HOME may show either
// account, but the visible performance source must disclose which provenance is rendered.
test("HOME visibly distinguishes CLOUD PAPER from LOCAL PAPER capital", () => {
  const home = fs.readFileSync(homePath, "utf8");

  assert.match(home, /const accountSource = cloudAccount != null \? "CLOUD" : localAccount != null \? "LOCAL" : null/);
  assert.match(home, /\{accountSource \? `\$\{accountSource\} PAPER` : "NO LINK"\}/);
  assert.match(home, /PAPER PERFORMANCE/);
});
