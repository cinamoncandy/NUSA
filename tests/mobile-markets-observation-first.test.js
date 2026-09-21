"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

test("Markets uses observation-first navigation language and authority framing", () => {
  assert.match(source, /testID="markets-authority-rail"/);
  assert.match(source, /PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY/);
  assert.match(source, /testID="markets-command-hero"/);
  assert.match(source, /MARKET OBSERVATION/);
  assert.match(source, /UPBIT PUBLIC · VERIFIED/);
  assert.match(source, /testID="markets-summary-strip"/);
  assert.match(source, />AUTHORITY<\/Text>/);
  assert.match(source, />READ ONLY<\/Text>/);
  assert.match(source, /segment\("CHART", "차트", "markets-chart-tab"\)/);
  assert.match(source, /segment\("WATCHLIST", "시장 목록", "markets-watchlist-tab"\)/);
  assert.match(source, /backgroundColor: pressed \? theme\.colors\.primarySoft : "transparent"/);
  assert.match(source, /borderBottomColor: selected \? theme\.colors\.primary : "transparent"/);
  assert.doesNotMatch(source, /backgroundColor: selected \? theme\.colors\.primarySoft : "transparent"/);
});

test("Markets makes verified public terrain the visual hero without inventing prediction semantics", () => {
  assert.match(source, /function MarketTerrain/);
  assert.match(source, /testID="markets-terrain"/);
  assert.match(source, /MARKET TERRAIN/);
  assert.match(source, /VERIFIED UPBIT PUBLIC MOVE · NO PREDICTION/);
  assert.match(source, /<TerrainSignal variant="market" signalStrength=\{strength\}/);
  assert.match(source, /item\.market\.replace\("KRW-",\s*""\)/);
  assert.match(source, /rate\(item\.changeRate\)/);
  assert.doesNotMatch(source, /Risk|Neutral|Opportunity|confidence score|profit probability/i);
});

test("Markets does not overclaim that a selected market is an AI decision or PAPER symbol", () => {
  assert.match(source, /testID="market-observation-context"/);
  assert.match(source, /시장 관측과 PAPER 판단은 분리됩니다/);
  assert.match(source, /공개 시세는 읽기 전용입니다\. 이 데이터만으로 전략 신호나 주문 권한이 생기지 않습니다/);
  assert.doesNotMatch(source, /PUBLIC OBSERVATION/);
  assert.doesNotMatch(source, /AI CONFIDENCE|PROFIT PROBABILITY/);
});
