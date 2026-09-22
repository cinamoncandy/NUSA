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
  // The board states absence as "NO VERIFIED ACCOUNT" rather than "NO LINK". The disclosure
  // contract is the same and the wording is stricter: no account means no claim.
  assert.match(home, /\{accountSource==null\?"NO VERIFIED ACCOUNT":accountSource\+" PAPER"\}/);
  assert.match(home, /PAPER Equity/);
});
