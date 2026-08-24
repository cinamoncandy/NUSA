const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

test("Issue #772 keeps public LOCAL PAPER feed independent from Cloud and private credentials", () => {
  const app = fs.readFileSync(path.join(repoRoot, "apps", "mobile", "App.tsx"), "utf8");
  const quotation = fs.readFileSync(path.join(repoRoot, "apps", "mobile", "src", "upbitPublicQuotationClient.ts"), "utf8");

  assert.match(app, /authStatus === "CHECKING" \|\| appState !== "active"/);
  assert.match(app, /recordLocalPaperPublicMarkets\(\[ticker\]\)/);
  assert.match(app, /getLocalPaperLearningReadiness\(\)/);
  assert.match(app, /await refreshPublicMarkets\(\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(quotation, /Authorization/);
  assert.doesNotMatch(quotation, /credentialProvider/);
  assert.match(quotation, /method: "GET"/);
  assert.match(quotation, /https:\/\/api\.upbit\.com/);
});

test("Issue #772 keeps Cloud execution credential-gated while public feed is independent", () => {
  const app = fs.readFileSync(path.join(repoRoot, "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /if \(authStatus !== "SIGNED_IN" \|\| appState !== "active"\) return;/);
  assert.match(app, /loadPersonalPaperOperations/);
  assert.match(app, /loadRealReadOnlyOperations/);
});
