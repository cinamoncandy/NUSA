const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homePath = path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx");

// Cloud PAPER and LOCAL PAPER are intentionally separate ledgers. HOME may show either
// account, but the visible capital label must disclose which provenance is being rendered.
test("HOME visibly distinguishes CLOUD PAPER from LOCAL PAPER capital", () => {
  const home = fs.readFileSync(homePath, "utf8");

  assert.match(home, /accountSource === "LOCAL" \? "PAPER 자산 · 기기"/);
  assert.match(home, /accountSource === "CLOUD" \? "PAPER 자산 · 서버"/);
  assert.match(home, /const capitalLabel = /);
  assert.match(home, /\{capitalLabel\}/);
});
