"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

test("Markets uses observation-first navigation language", () => {
  assert.match(source, /관찰 목록/);
  assert.match(source, /관찰 상세/);
  assert.match(source, /PUBLIC OBSERVATION/);
  assert.doesNotMatch(source, /segment\("WATCHLIST", "시장"/);
  assert.doesNotMatch(source, /segment\("CHART", "차트"/);
});

test("Markets does not overclaim that a selected market is an AI decision or PAPER symbol", () => {
  assert.match(source, /공개 시세 관찰 컨텍스트/);
  assert.match(source, /AI 판단 대상이나 PAPER 주문 종목으로 자동 승격되지 않습니다/);
  assert.match(source, /PAPER 감독 보기/);
});
