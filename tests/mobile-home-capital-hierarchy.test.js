const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeDecisionSurface.ts"), "utf8");
const portfolio = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("HOME presents truthful PAPER equity and cumulative PnL basis in the canonical capital strip", () => {
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /PAPER EQUITY/);
  assert.match(home, /krw\(account\?\.equity\)/);
  assert.match(home, /TOTAL PNL/);
  assert.match(home, /signedMoney\(totalPnl\)/);
  assert.match(home, /CASH/);
  assert.match(home, /EXPOSURE/);
  assert.match(home, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(home, /hasDailyPnlBasis: false/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  assert.doesNotMatch(home, />오늘<\/Text>/);
  assert.doesNotMatch(home, /const equity\s*=\s*10000000|totalPnl\s*=\s*[+-]?\d+(?:\.\d+)?;/);
});

test("capital allocation constraints remain actionable in PAPER portfolio/trading while canonical HOME stays truthful", () => {
  assert.doesNotMatch(home, /testID="home-capital-limits"/);
  assert.match(portfolio, /portfolio-investable-cash/);
  assert.match(home, /readonly investmentPercent: number/);
  assert.match(home, /createCashInvestmentEnvelope\(account\.cash, investmentPercent\)/);
  assert.match(home, /testID="home-investable-cash"/);
  assert.match(home, /label="RESERVED CASH"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?!NONE)/);
});
