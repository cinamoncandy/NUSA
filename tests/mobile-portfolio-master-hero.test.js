const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "portfolioView.tsx"), "utf8");

test("Portfolio leads with verified equity and PnL rather than a generic card stack", () => {
  assert.match(source, /function PortfolioHero/);
  assert.match(source, /testID="portfolio-master-hero"/);
  assert.match(source, /PAPER PORTFOLIO/);
  assert.match(source, /TOTAL EQUITY/);
  assert.match(source, /TOTAL P&L/);
  assert.match(source, /VERIFIED ACCOUNTING/);
  assert.match(source, /model == null \? "PAPER DATA UNAVAILABLE"/);
});

test("Portfolio allocation visualization is derived only from canonical cash and exposure", () => {
  assert.match(source, /testID="portfolio-composition"/);
  assert.match(source, /model\.cash \/ total/);
  assert.match(source, /model\.assetValue \/ total/);
  assert.match(source, /CASH \{money\(model\?\.cash\)\}/);
  assert.match(source, /EXPOSURE \{money\(model\?\.assetValue\)\}/);
  assert.match(source, /NO SYNTHETIC CURVE/);
  assert.doesNotMatch(source, /Math\.random\(/);
});

test("Portfolio keeps PAPER and REAL_READ_ONLY provenance separate", () => {
  assert.match(source, /PAPER CAPITAL · REAL ACCOUNT SEPARATE · LIVE NONE/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
