const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeDecisionSurface.ts"), "utf8");
const portfolio = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("HOME presents truthful PAPER equity and cumulative PnL in the approved performance block", () => {
  assert.match(home, /testID="account-hero-card"/);
  // The approved concept board labels this "PAPER Equity" in English; the PAPER boundary is
  // declared by the risk-authority row, whose visibility tests/mobile-home-ai-surface.test.js
  // asserts.
  assert.match(home, /PAPER Equity/);
  assert.match(home, /testID="home-ai-judgement"/);
  assert.match(home, /won\(account\?\.equity\)/);
  assert.match(home, /won\(totalPnl\)/);
  assert.match(home, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  // "오늘" stays forbidden: the rendered figure is cumulative, not a daily basis, and labelling it
  // as today's would be a false claim. The board's own tagline is a different matter — it is the
  // approved reference wording, so it is no longer prohibited here.
  assert.doesNotMatch(home, /오늘/);
  assert.ok(home.indexOf('testID="account-hero-card"') < home.indexOf('testID="home-capital-limits"'));
  assert.doesNotMatch(home, /const equity\s*=\s*10000000|totalPnl\s*=\s*[+-]?\d+(?:\.\d+)?;/);
});

test("capital allocation constraints remain visible without creating authority", () => {
  assert.match(home, /testID="home-capital-limits"/);
  assert.match(portfolio, /portfolio-investable-cash/);
  assert.match(home, /readonly investmentPercent: number/);
  assert.match(home, /createCashInvestmentEnvelope\(account\.cash, props\.investmentPercent\)/);
  assert.match(home, /testID="home-investable-cash"/);
  assert.match(home, /testID="home-reserved-cash"/);
  assert.match(home, />INVESTABLE<\/Text>/);
  assert.match(home, />RESERVED<\/Text>/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?!NONE)/);
});
