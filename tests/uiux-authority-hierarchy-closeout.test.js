const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");
const occurrences = (source, needle) => source.split(needle).length - 1;

test("Home presents a single compact authority state without repeating safety badges", () => {
  const home = read("homeView.tsx");

  assert.equal(occurrences(home, 'statusLabel="PAPER ONLY"'), 1);
  assert.equal(occurrences(home, 'StatusChip label="PAPER"'), 1);
  assert.equal(occurrences(home, 'StatusChip label="LIVE NONE"'), 1);
  assert.equal(occurrences(home, 'StatusChip label="AI READ ONLY"'), 1);
  assert.doesNotMatch(home, /<AuthorityBanner/);
  assert.doesNotMatch(home, /AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /Production mutation/);
});

test("AI view keeps one explicit zero-authority statement and one compact authority row", () => {
  const ai = read("aiView.tsx");

  assert.equal(occurrences(ai, 'statusLabel="READ ONLY"'), 1);
  assert.equal(occurrences(ai, 'label="AI ZERO AUTHORITY"'), 1);
  assert.equal(occurrences(ai, 'label="PAPER"'), 1);
  assert.equal(occurrences(ai, 'label="LIVE"'), 1);
  assert.doesNotMatch(ai, /<AuthorityBanner/);
  assert.doesNotMatch(ai, /AI READ ONLY/);
});

test("PAPER exposes independent local simulation while cloud submit stays authority-gated and LIVE remains forbidden", () => {
  const trading = read("tradingView.tsx");

  assert.equal(occurrences(trading, 'statusLabel="LIVE NONE"'), 1);
  assert.doesNotMatch(trading, /<AuthorityBanner/);
  assert.match(trading, /const builtInSubmitAvailable = Boolean\(configuredEndpoint && credentialSession\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(trading, /const usingLocalPaper = !builtInSubmitAvailable/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && builtInSubmitAvailable/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /StatusChip label=\{usingLocalPaper \? "LOCAL PAPER" : "CLOUD PAPER"\}/);
  assert.match(trading, /testID="paper-order-ticket"/);
  assert.match(trading, /localTradingService\.placePaperOrder\(/);
  assert.match(trading, /submitPersonalPaperOrderWithRetryIdentity\(/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /setConfirming\(true\)/);
  assert.match(trading, /setOrderPhase\("REVIEW"\)/);
  assert.doesNotMatch(trading, /authority:\s*"LIVE"/);
  assert.doesNotMatch(trading, /productionMutationAllowed:\s*true/);
});
