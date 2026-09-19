const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homePath = path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx");

test("HOME visibly distinguishes CLOUD PAPER from LOCAL PAPER capital", () => {
  const home = fs.readFileSync(homePath, "utf8");
  assert.match(home, /const cloudAccount = props\.snapshot\?\.portfolio\?\.account \?\? null/);
  assert.match(home, /const localAccount = localPortfolio\?\.account \?\? null/);
  assert.match(home, /const account = cloudAccount \?\? localAccount/);
  assert.match(home, /const accountSource = cloudAccount != null \? "CLOUD" : localAccount != null \? "LOCAL" : null/);
  assert.match(home, /accountSource,/);
  assert.match(home, /\{accountSource \? `\$\{accountSource\} PAPER` : "NO LINK"\}/);
});
