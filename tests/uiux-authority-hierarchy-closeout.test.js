const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("AI presents intelligence and evidence before one explicit zero-authority boundary", () => {
  const ai = read("aiView.tsx");
  const thesisIndex = ai.indexOf('testID="ai-thesis-card"');
  const evidenceIndex = ai.indexOf('testID="ai-signal-factors"');
  const authorityIndex = ai.indexOf('AI ZERO AUTHORITY');
  const readOnlyIndex = ai.indexOf('SIGNAL IS READ ONLY');
  const zeroAuthorityIndex = ai.indexOf('testID="ai-zero-authority-status"');

  assert.ok(thesisIndex >= 0, "thesis must remain present");
  assert.ok(evidenceIndex > thesisIndex, "verified evidence must follow thesis");
  assert.ok(zeroAuthorityIndex > evidenceIndex, "zero-authority panel must follow intelligence/evidence");
  assert.ok(authorityIndex > zeroAuthorityIndex, "visible authority copy must live inside the zero-authority panel");
  assert.ok(readOnlyIndex > authorityIndex, "read-only action affordance must follow authority summary");
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.match(ai, /PAPER ONLY · LIVE \{liveAuthority\?\?"NONE"\} · PRODUCTION MUTATION/);
  assert.match(ai, /KILL SWITCH/);
  assert.match(ai, /testID="ai-signal-factors"/);
  assert.equal(occurrences(ai, "SIGNAL IS READ ONLY"), 1);
  assert.doesNotMatch(ai, /<AuthorityBanner|testID="ai-authority-card"|ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
});

test("production PAPER supervises learning while isolated legacy simulation remains PAPER-only", () => {
  // The two order surfaces this block covered were deleted with the ORDER destination.
  // The guards now cover the PAPER surfaces that replaced them.
  const combinedTrading = `${read("paperLearningMonitorView.tsx")}\n${read("homeView.tsx")}`;

  assert.doesNotMatch(combinedTrading, /<AuthorityBanner/);
  assert.match(read("localPaperLedger.ts"), /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.doesNotMatch(combinedTrading, /authority: "LIVE"|productionMutationAllowed: true|liveMutationAllowed: true/);
});

test("authority hierarchy closeout preserves AI zero-authority and PAPER-only mutation", () => {
  const ai = read("aiView.tsx");
  // The two order surfaces this block covered were deleted with the ORDER destination.
  // The guards now cover the PAPER surfaces that replaced them.
  const combinedTrading = `${read("paperLearningMonitorView.tsx")}\n${read("homeView.tsx")}`;

  assert.doesNotMatch(ai, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(combinedTrading, /authority: "LIVE"|productionMutationAllowed: true|liveMutationAllowed: true/);
  assert.doesNotMatch(combinedTrading, /\/live(?:\/|\b)|\/withdraw(?:\/|\b)|\/transfer(?:\/|\b)/i);
});
