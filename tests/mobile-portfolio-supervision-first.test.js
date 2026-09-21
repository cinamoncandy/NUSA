"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "portfolioView.tsx"), "utf8");

test("Portfolio is framed as NUSA operating supervision, not a personal trading wallet", () => {
  assert.match(source, /testID="portfolio-authority-rail"/);
  assert.match(source, /detail="PAPER CAPITAL · REAL ACCOUNT SEPARATE · LIVE NONE"/);
  assert.match(source, /PAPER CAPITAL · VERIFIED ACCOUNTING/);
  assert.match(source, /EQUITY \/ P&L/);
  assert.match(source, /testID="portfolio-master-hero"/);
  assert.match(source, /testID="portfolio-supervisor-summary"/);
  assert.match(source, /testID="portfolio-command-hero"/);
  assert.doesNotMatch(source, /KNOW WHAT IS WORKING\./);
  assert.match(source, /PAPER RESULT = CANONICAL/);
  assert.match(source, /REAL_READ_ONLY = REFERENCE ONLY/);
  assert.doesNotMatch(source, /eyebrow="MY ISLAND"/);
});

test("Portfolio keeps PAPER result and REAL_READ_ONLY reference separate", () => {
  assert.match(source, /testID="portfolio-account-breakdown"/);
  assert.match(source, /PAPER RESULT/);
  assert.match(source, /testID="portfolio-upbit-read-only"/);
  assert.match(source, /REAL ACCOUNT · READ ONLY/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다/);
});

test("Portfolio surfaces supervision facts and learning evidence without inventing authority", () => {
  assert.match(source, /label: "TOTAL PNL"/);
  assert.match(source, /label="MARKET EXPOSURE"/);
  assert.match(source, /label="PROTECTED CASH"/);
  assert.match(source, /label="OPEN ORDERS"/);
  assert.match(source, /학습 \/ 평가 근거 보기/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(source, /LIVE ENABLED|LIVE ACTIVE|실거래 주문 실행/);
});
