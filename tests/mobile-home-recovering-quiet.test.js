const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src", file), "utf8");

test("a configured PAPER server never falls back to the on-device ₩10,000,000 ledger while recovering", () => {
  const home = read("homeView.tsx");
  assert.match(home, /const localPaperActive = snapshot == null && isLocalPaperActive\(\) && isLocalPaperLedgerDisplayable\(\);/);
  assert.match(read("portfolioView.tsx"), /const localPaperActive = snapshot === null && isLocalPaperActive\(\) && isLocalPaperLedgerDisplayable\(\);/);
  assert.match(read("localPaperLedger.ts"), /return isLocalPaperActive\(\) && getConfiguredPaperEndpoint\(\) == null;/);
  assert.match(home, /"CLOUD PAPER CAPITAL" \+ \(sessionRecovering \? " · 재확인 중" : ""\)/);
});

test("an unknown decision count is a quiet line, and is omitted when a fault banner already explains it", () => {
  const rings = read("decisionRings.tsx");
  assert.match(rings, /model\.state === "UNKNOWN" \? \(status \? null : <Text style=\{\[styles\.pending/);
  assert.match(rings, /pending: \{ fontSize: 14/);
  assert.match(rings, /accessibilityLabel=\{status && model\.state === "UNKNOWN" \? `\$\{status\.title\}/);
});

test("the one-line status rail is hidden while the fault banner is shown", () => {
  const home = read("homeView.tsx");
  assert.match(home, /styles\.glanceRail, ringsStatus && ringsStatus\.tone !== "halt" \? styles\.hiddenAcceptanceHooks : null\]\} testID="home-status-rail"/);
});
