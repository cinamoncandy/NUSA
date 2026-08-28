const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeDecisionSurface.ts"), "utf8");

test("HOME keeps PAPER result truth in the supervisor deck without repeating a second equity/PnL hero", () => {
  assert.match(home, /label="RESULT" value=\{supervisorResult\}/);
  assert.match(home, /const supervisorResult = decisionSurface\.result/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  assert.doesNotMatch(home, />TOTAL EQUITY</);
  assert.doesNotMatch(home, />CUMULATIVE PAPER P&L</);
  assert.doesNotMatch(home, /testID="account-hero-card"/);
});

test("HOME retains actionable capital constraints after removing the duplicated result hero", () => {
  assert.match(home, /testID="home-capital-limits"/);
  assert.match(home, />01 \/\/ CAPITAL LIMITS</);
  assert.match(home, /DEPLOYABLE \{cashEnvelope\.investmentPercent\}%/);
  assert.match(home, /RESERVE \{cashEnvelope\.reservePercent\}%/);
  assert.match(home, /PAPER ONLY · LIVE NONE/);
  assert.match(home, /AI ZERO AUTHORITY/);
  assert.match(home, /productionMutationAllowed=false/);
  assert.match(home, /liveAuthority=NONE/);
});
