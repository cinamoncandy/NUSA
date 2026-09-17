const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homePath = path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx");

test("HOME visibly distinguishes CLOUD PAPER from LOCAL PAPER capital", () => {
  const home = fs.readFileSync(homePath, "utf8");
  assert.match(home, /const accountSource = snapshot != null \? "CLOUD" : localPortfolio != null \? "LOCAL" : null/);
  assert.match(home, /accountSource === "LOCAL"/);
  assert.match(home, /LOCAL PAPER · 실제 계좌\/Cloud PAPER와 합산하지 않음/);
  assert.match(home, /CLOUD PAPER · REAL account not blended/);
  assert.match(home, /\{accountSource \? `\$\{accountSource\} PAPER` : "NO LINK"\}/);
});
