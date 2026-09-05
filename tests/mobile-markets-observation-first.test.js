"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

test("Markets uses observation-first navigation language and authority framing", () => {
  assert.match(source, /testID="markets-authority-rail"/);
  assert.match(source, /PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY/);
  assert.match(source, /eyebrow="MARKETS"/);
  assert.match(source, /badge="OBSERVE"/);
  assert.match(source, /segment\("CHART", "관찰 상세", "markets-chart-tab"\)/);
  assert.match(source, /segment\("WATCHLIST", "관찰 목록", "markets-watchlist-tab"\)/);
  assert.doesNotMatch(source, /segment\("WATCHLIST", "시장"/);
  assert.doesNotMatch(source, /segment\("CHART", "차트"/);
});

test("Markets does not overclaim that a selected market is an AI decision or PAPER symbol", () => {
  assert.match(source, /testID="market-observation-context"/);
  assert.match(source, /이 시장은 관찰 데이터입니다/);
  assert.match(source, /전략 신호나 주문 권한으로 자동 승격되지 않습니다/);
  assert.match(source, /공개 시세를 관찰합니다\. 관찰 데이터와 NUSA의 전략 판단을 분리해 표시합니다/);
  assert.doesNotMatch(source, /PUBLIC OBSERVATION/);
});
