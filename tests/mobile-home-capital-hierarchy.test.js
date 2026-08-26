const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");

test("HOME keeps PAPER result truth in the supervisor deck without repeating a second equity/PnL hero", () => {
  assert.match(source, /label="RESULT" value=\{supervisorResult\}/);
  assert.match(source, /PAPER P&L .*EQUITY/);
  assert.doesNotMatch(source, />TOTAL EQUITY</);
  assert.doesNotMatch(source, />CUMULATIVE PAPER P&L</);
  assert.doesNotMatch(source, /testID="account-hero-card"/);
});

test("HOME retains actionable capital constraints after removing the duplicated result hero", () => {
  assert.match(source, /testID="home-capital-limits"/);
  assert.match(source, />01 \/\/ CAPITAL LIMITS</);
  assert.match(source, /DEPLOYABLE \{cashEnvelope\.investmentPercent\}%/);
  assert.match(source, /RESERVE \{cashEnvelope\.reservePercent\}%/);
  assert.match(source, /PAPER ONLY · LIVE NONE/);
  assert.match(source, /AI ZERO AUTHORITY/);
  assert.match(source, /productionMutationAllowed=false/);
  assert.match(source, /liveAuthority=NONE/);
});
