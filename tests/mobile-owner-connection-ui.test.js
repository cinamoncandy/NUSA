"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/ownerConnectionExperience.tsx"), "utf8");

test("PAPER UI makes one-time device approval primary and pairing recovery-only", () => {
  assert.match(source, /PAPER 서버 확인/);
  assert.match(source, /최초 기기 승인/);
  assert.match(source, /이 휴대폰 등록/);
  assert.match(source, /자동 연결 준비/);
  assert.match(source, /이 휴대폰 승인/);
  assert.match(source, /6자리 코드/);
  assert.match(source, /복구 연결/);
  assert.doesNotMatch(source, /소유자에게 이 확인 코드를 전달하세요/);
  assert.doesNotMatch(source, /users:manage|bootstrap token|PAPER token/);
});

test("PAPER UI separates unauthenticated observation, authenticated mutation and LIVE authority", () => {
  assert.match(source, /공개 관측/);
  assert.match(source, /시세 · 서버 상태/);
  assert.match(source, /인증 없음/);
  assert.match(source, /PAPER 변경/);
  assert.match(source, /주문 · 포지션 · 설정/);
  assert.match(source, /기기 세션/);
  assert.match(source, /Upbit LIVE/);
  assert.match(source, /별도 사용자 인증 · 권한 검증/);
  assert.match(source, /LIVE AUTH SEPARATE/);
});

test("Evidence Glass states automatic reconnect and fail-closed session truth", () => {
  assert.match(source, /PAPER 자동 연결/);
  assert.match(source, /토큰을 다시 입력할 필요가 없습니다/);
  assert.match(source, /자동으로 복원/);
  assert.match(source, /다시 승인하기 전까지 변경 작업은 차단/);
  assert.match(source, /이 휴대폰이 안전하게 연결되었습니다\./);
  assert.match(source, /PAPER ONLY/);
  assert.match(source, /AI ZERO AUTHORITY/);
});

test("Evidence Glass avoids decorative intelligence theater", () => {
  assert.doesNotMatch(source, /IntelligenceMotionField|orbit|scanline|particle|globe/i);
  assert.match(source, /truthPanel/);
  assert.match(source, /authorityRail/);
  assert.match(source, /accessGrid/);
});