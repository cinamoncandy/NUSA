const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const app = read("apps/mobile/App.tsx");
const paper = read("apps/mobile/src/tradingView.tsx");
const markets = read("apps/mobile/src/marketsView.tsx");

test("public quotation stays on the observation surface, not the PAPER execution route", () => {
  assert.match(app, /loadUpbitPublicMarkets/);
  assert.match(markets, /PUBLIC READ ONLY/);
  assert.match(markets, /loadUpbitPublicCandles/);
  assert.match(markets, /parseWatchlistMarkets/);
  assert.match(markets, /전략 신호나 주문 권한으로 자동 승격되지 않습니다/);
  assert.doesNotMatch(paper, /loadUpbitPublicMarkets|loadUpbitPublicCandles|CloudPaperPublicChart|paper-upbit-market-panel|paper-upbit-chart/);
});

test("production PAPER is a read-only learning monitor and never exposes a manual workspace", () => {
  assert.match(paper, /PaperLearningMonitorView/);
  assert.match(paper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(paper, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.doesNotMatch(paper, /CLOUD PAPER NOT CONNECTED|EXECUTION WORKSPACE|SIMULATED EXECUTION/);
});
