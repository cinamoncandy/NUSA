const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("mobile PAPER falls back to a 10M KRW local simulator without Cloud authority", () => {
  const app = read("apps/mobile/App.tsx");
  const shell = read("apps/mobile/src/tradingView.tsx");
  const view = read("apps/mobile/src/tradingViewLegacy.tsx");
  // Issue #637: the 10M KRW simulator is now the one app-level LOCAL PAPER ledger shared with
  // Home and Portfolio (./localPaperLedger), not a Trade-screen-only local.
  const ledger = read("apps/mobile/src/localPaperLedger.ts");
  assert.match(app, /activeTab !== "Portfolio" && activeTab !== "Paper"/);
  assert.match(shell, /TradingView as LegacyTradingView/);
  assert.match(shell, /return <LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(ledger, /10_000_000/);
  assert.match(ledger, /MockTradingService/);
  assert.match(ledger, /currency: "KRW"/);
  assert.match(ledger, /export function isLocalPaperActive/);
  assert.match(ledger, /Boolean\(configuredEndpoint && session\.isConfigured\(\) && isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(ledger, /localPaperLedgerService\.placePaperOrder\(/);
  assert.match(view, /const usingLocalPaper = isLocalPaperActive\(\)/);
  assert.match(view, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(view, /loadUpbitPublicMarkets\(\)/);
  assert.match(view, /await placeLocalPaperOrder\(/);
  assert.match(view, /LOCAL PAPER 체결 완료/);
  assert.match(view, /liveMutationAllowed: false/);
  assert.match(view, /productionMutationAllowed: false/);
  assert.doesNotMatch(view, /authority:\s*"LIVE"/);
  assert.doesNotMatch(view, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(shell, /authority:\s*"LIVE"/);
  assert.doesNotMatch(shell, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(ledger, /authority:\s*"LIVE"/);
  assert.doesNotMatch(ledger, /productionMutationAllowed:\s*true/);
});

test("MockTradingService parses KRW-BTC as KRW quote and BTC base", () => {
  const service = read("apps/mobile/src/tradingService.ts");
  assert.match(service, /market\.includes\("\/"\) \? "\/" : market\.includes\("-"\) \? "-" : null/);
  assert.match(service, /const \[quote, base, \.\.\.rest\] = market\.split\(separator\)/);
  assert.doesNotMatch(service, /market\.split\("\/"\)\[0\] \?\? market\.split\("-"\)\[0\]/);
});
