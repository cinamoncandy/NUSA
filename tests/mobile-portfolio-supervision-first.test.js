"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "portfolioView.tsx"), "utf8");

test("Portfolio is framed as NUSA operating supervision, not a personal trading wallet", () => {
  assert.match(source, /eyebrow="NUSA SUPERVISION"/);
  assert.match(source, /title="운용 결과"/);
  assert.match(source, /testID="portfolio-supervisor-summary"/);
  assert.match(source, /NUSA OPERATING RESULT/);
  assert.doesNotMatch(source, /eyebrow="MY ISLAND"/);
});

test("Portfolio keeps PAPER result and REAL_READ_ONLY reference separate", () => {
  assert.match(source, /PAPER RESULT/);
  assert.match(source, /REAL_READ_ONLY · REFERENCE/);
  assert.match(source, /REAL_READ_ONLY 기준선은 PAPER 결과와 합산하지 않습니다/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 합산하지 않습니다/);
});

test("Portfolio surfaces supervision facts and learning evidence without inventing authority", () => {
  assert.match(source, /누적 PAPER 손익/);
  assert.match(source, /현재 시장 노출/);
  assert.match(source, /보호 현금/);
  assert.match(source, /열린 주문/);
  assert.match(source, /학습 \/ 평가 근거 보기/);
  assert.doesNotMatch(source, /LIVE ENABLED|LIVE ACTIVE|실거래 주문 실행/);
});
