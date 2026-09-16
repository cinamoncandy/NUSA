import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const home = read("apps/mobile/src/homeView.tsx");
const markets = read("apps/mobile/src/marketsView.tsx");
const paper = read("apps/mobile/src/tradingView.tsx");
const paperMonitor = read("apps/mobile/src/paperLearningMonitorView.tsx");
const portfolio = read("apps/mobile/src/portfolioView.tsx");
const os = read("apps/mobile/src/intelligenceOs.tsx");
const spec = read("docs/ux/NUSA_INTELLIGENCE_OS_V1.md");

test("Intelligence OS keeps authority and data-integrity boundaries visible", () => {
  for (const source of [home, markets, paper, portfolio, spec]) assert.match(source, /PAPER/);
  assert.match(home, /LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(paper, /LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(portfolio, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(markets, /PUBLIC READ ONLY/);
  assert.doesNotMatch(home, /BULLISH|BEARISH|STRONG SIGNAL|WEAK SIGNAL/);
});

test("HOME follows posture -> capital truth -> observation -> supervision -> learning -> decision detail", () => {
  const anchors = ['testID="home-now"','testID="account-hero-card"','testID="home-decision-stage"','testID="home-paper-performance"','testID="home-paper-learning"','DECISION BASIS','testID="ai-card"','testID="home-risk-status"'];
  let cursor = -1;
  for (const anchor of anchors) { const next = home.indexOf(anchor); assert.ok(next > cursor, `${anchor} must appear after the previous UX stage`); cursor = next; }
  assert.match(home, /공개 시장 데이터 대기 중/);
  assert.match(home, /UNAVAILABLE|—/);
});

test("primary screens share Intelligence OS truth grammar while PAPER specializes as a learning monitor", () => {
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.match(markets, /AuthorityRail/);
  assert.match(portfolio, /AuthorityRail/);
  assert.match(paper, /PaperLearningMonitorView/);
  assert.match(paperMonitor, /PAPER LEARNING · READ ONLY/);
  assert.match(paperMonitor, /DATA SOURCE/);
  assert.match(os, /minHeight: 48/);
  assert.match(os, /fontVariant: \["tabular-nums"\]/);
  assert.match(spec, /3 seconds/);
  assert.match(spec, /10 seconds/);
  assert.match(spec, /30 seconds/);
});

test("market observation is explicitly separated from strategy and order authority", () => {
  assert.match(markets, /시장 관측과 PAPER 판단은 분리됩니다/);
  assert.match(markets, /공개 시세는 읽기 전용입니다\. 이 데이터만으로 전략 신호나 주문 권한이 생기지 않습니다/);
  assert.doesNotMatch(paper, /loadUpbitPublicMarkets|loadUpbitPublicCandles|CloudPaperPublicChart/);
  assert.doesNotMatch(paper, /<LegacyTradingView \{\.\.\.props\} \/>/);
});

test("REAL_READ_ONLY is never presented as PAPER performance", () => {
  assert.match(portfolio, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다/);
  assert.match(spec, /REAL_READ_ONLY account data is never summed into PAPER performance/);
});

test("PRODUCT VERIFIED remains a physical-device release gate", () => {
  assert.match(spec, /protected main merge/);
  assert.match(spec, /Android Stable target SHA equals protected main/);
  assert.match(spec, /installed Galaxy build identity equals that SHA/);
  assert.match(spec, /physical Galaxy screenshot visibly matches the new hierarchy/);
  assert.match(spec, /PRODUCT VERIFIED = NO/);
});
