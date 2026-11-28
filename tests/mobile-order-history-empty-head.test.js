const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "apps/mobile/src/orderHistoryView.tsx"), "utf8");

test("the order-history error and empty states keep the head with the corner sphere; loading stays bare", () => {
  assert.match(src, /const HEAD_TEXT = \{ eyebrow: "PAPER 주문 기록", title: "주문 이력", description: "서버가 제공한 PAPER 주문·체결 기록만 검색하고 필터링합니다\." \} as const;/);
  assert.match(src, /const emptyHead = <ScreenHeader sphere \{\.\.\.HEAD_TEXT\} \/>;/);
  assert.match(src, /<ScreenHeader sphere \{\.\.\.HEAD_TEXT\} statusLabel/);
  const lines = src.split("\n");
  for (const id of ["order-history-error", "order-history-empty"]) {
    const rows = lines.filter((l) => l.includes(`testID="${id}"`) && l.includes("stateTop"));
    assert.ok(rows.length >= 1, id);
    for (const row of rows) assert.match(row, /\{emptyHead\}/);
  }
  assert.match(src, /stateTop: \{/);
  const loading = lines.find((l) => l.includes('testID="order-history-loading"'));
  assert.match(loading, /styles\.state\b/);
  assert.doesNotMatch(loading, /emptyHead/);
});

test("the state messages and the refresh button keep their wording", () => {
  assert.match(src, /조건에 맞는 주문이 없습니다/);
  assert.match(src, /완료된 PAPER 주문이 생기면 이 화면에 표시됩니다\./);
  assert.match(src, /주문 이력을 표시할 수 없습니다/);
  assert.match(src, /label="다시 불러오기"/);
});
