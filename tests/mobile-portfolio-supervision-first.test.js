"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "portfolioView.tsx"), "utf8");

test("Portfolio is framed as NUSA operating supervision, not a personal trading wallet", () => {
  assert.match(source, /testID="portfolio-authority-rail"/);
  assert.match(source, /detail="모의투자 자산 · 실계좌 분리 · 실거래 권한 없음"/);
  assert.match(source, /eyebrow="자산 구성"/);
  assert.match(source, /title="모의투자 자산과 결과"/);
  assert.match(source, /badge="자산 구성"/);
  assert.match(source, /testID="portfolio-supervisor-summary"/);
  assert.doesNotMatch(source, /eyebrow="MY ISLAND"/);
});

test("Portfolio keeps PAPER result and REAL_READ_ONLY reference separate", () => {
  assert.match(source, /testID="portfolio-account-breakdown"/);
  assert.match(source, /모의투자 결과/);
  assert.match(source, /testID="portfolio-upbit-read-only"/);
  assert.match(source, /실계좌 · 보기 전용/);
  assert.match(source, /실계좌 보기 전용 잔고는 확인용 기준선이며 모의투자 성과와 절대 합산하지 않습니다/);
});

test("Portfolio surfaces supervision facts and learning evidence without inventing authority", () => {
  assert.match(source, /label: "총 손익"/);
  assert.match(source, /label="시장 노출"/);
  assert.match(source, /label="보호 현금"/);
  assert.match(source, /label="미체결 주문"/);
  assert.match(source, /학습 \/ 평가 근거 보기/);
  assert.match(source, /모의투자 전용 · 실거래 권한 없음 · AI 실행 권한 없음/);
  assert.doesNotMatch(source, /LIVE ENABLED|LIVE ACTIVE|실거래 주문 실행/);
});
