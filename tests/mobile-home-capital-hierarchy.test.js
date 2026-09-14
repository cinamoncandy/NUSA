const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeView.tsx"), "utf8");
const decisionSurface = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/homeDecisionSurface.ts"), "utf8");
const portfolio = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("HOME keeps truthful PAPER performance as secondary Runtime Canvas context", () => {
  assert.match(home, /testID="home-capital-reveal"/);
  assert.match(home, /testID="home-paper-performance"/);
  assert.match(home, /PAPER CONTEXT · SECONDARY/);
  assert.match(home, /CLOUD PAPER CAPITAL/);
  assert.match(home, /label="PAPER EQUITY"/);
  assert.match(home, /money\(account\?\.equity\)/);
  assert.match(home, /label="TOTAL PNL"/);
  assert.match(home, /signedMoney\(totalPnl\)/);
  assert.match(home, /label="CASH"/);
  assert.match(home, /label="EXPOSURE"/);
  assert.match(home, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(decisionSurface, /PAPER P&L .*EQUITY/);
  assert.doesNotMatch(home, />오늘<\/Text>/);
  assert.doesNotMatch(home, /const equity\s*=\s*10000000|totalPnl\s*=\s*[+-]?\d+(?:\.\d+)?;/);
});

test("detailed capital allocation stays in Portfolio while HOME shows only the allocation policy", () => {
  assert.match(portfolio, /portfolio-investable-cash/);
  assert.match(home, /readonly investmentPercent: number/);
  assert.match(home, /label="ALLOCATION POLICY"/);
  assert.doesNotMatch(home, /home-investable-cash|RESERVED CASH|createCashInvestmentEnvelope/);
  assert.match(home, /PAPER ONLY · LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /productionMutationAllowed\s*=\s*true/);
  assert.doesNotMatch(home, /liveAuthority\s*=\s*["'](?!NONE)/);
});
