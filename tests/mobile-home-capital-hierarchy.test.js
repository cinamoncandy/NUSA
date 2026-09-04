const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeDecisionSurface.ts"), "utf8");
const portfolio = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("HOME presents truthful canonical PAPER equity and PnL", () => {
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, />EQUITY<\/Text>/);
  assert.match(home, />P&L<\/Text>/);
  assert.match(home, /const account = snapshot\?\.portfolio\?\.account \?\? localPortfolio\?\.account \?\? null/);
  assert.match(home, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(home, /paperEquity: account\?\.equity/);
  assert.match(home, /paperTotalPnl: totalPnl/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  assert.match(home, /testID="home-supervisor-result"/);
});

test("capital allocation constraints remain visible and PAPER-only", () => {
  assert.match(home, /const cashEnvelope = account == null \? null : createCashInvestmentEnvelope\(account\.cash, investmentPercent\)/);
  assert.match(home, /testID="home-capital-limits"/);
  assert.match(portfolio, /portfolio-investable-cash/);
  assert.match(home, /readonly investmentPercent: number/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?!NONE)/);
});
