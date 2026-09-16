"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/ownerConnectionExperience.tsx"), "utf8");

test("owner connection UI makes server-verified device auth primary and pairing recovery-only", () => {
  assert.match(source, /NUSA 연결/);
  assert.match(source, /소유자 인증/);
  assert.match(source, /이 휴대폰 승인/);
  assert.match(source, /Secure Session/);
  assert.match(source, /지문·얼굴로 소유자 인증/);
  assert.match(source, /6자리 코드로 복구/);
  assert.match(source, /복구 연결/);
  assert.doesNotMatch(source, /소유자에게 이 확인 코드를 전달하세요/);
  assert.doesNotMatch(source, /users:manage|bootstrap token|PAPER token/);
});

test("owner connection UI keeps authority and completion truth explicit", () => {
  assert.match(source, /✓ 이 휴대폰이 안전하게 연결되었습니다\./);
  assert.match(source, /서버가 소유자와 이 기기의 자격 증명을 검증했습니다/);
  assert.match(source, /PAPER ONLY/);
  assert.match(source, /LIVE 권한 없음/);
  assert.match(source, /주문\/이체\/출금 권한 없음/);
  assert.doesNotMatch(source, /생체인증으로 OWNER 권한|OWNER 권한을 부여/);
});