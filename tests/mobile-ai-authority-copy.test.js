const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/components.tsx"), "utf8");

test("AI zero-authority banner is scoped to AI and does not deny the PAPER user path", () => {
  assert.match(source, /AI는 주문, 이체, 출금 또는 운영 상태를 변경할 권한이 없습니다/);
  assert.match(source, /AI는 읽기 전용이며 PAPER 주문은 별도의 사용자 승인·PAPER 실행 경로에서만 처리됩니다/);
  assert.doesNotMatch(source, /실제 주문 권한은 없습니다/);
});