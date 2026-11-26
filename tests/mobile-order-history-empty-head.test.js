const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "apps/mobile/src/orderHistoryView.tsx"), "utf8");

test("the order-history error and empty states keep the head with the corner sphere; loading stays bare", () => {
  assert.match(src, /const emptyHead = <ScreenHeader sphere eyebrow="PAPER 주문 기록" title="주문 이력" description="서버가 제공한 PAPER 주문·체결 기록만 검색하고 필터링합니다\." \/>;/);
  assert.match(src, /if \(error\) return <View style=\{styles\.stateTop\} testID="order-history-error">\{emptyHead\}/);
  assert.match(src, /model\.state === "ERROR"\) return <View style=\{styles\.stateTop\} testID="order-history-error">\{emptyHead\}/);
  assert.match(src, /model\.state === "EMPTY"\) return <View style=\{styles\.stateTop\} testID="order-history-empty">\{emptyHead\}/);
  assert.match(src, /model\.state === "LOADING"\) return <View style=\{styles\.state\} testID="order-history-loading">/);
});

test("the state messages and the refresh button keep their wording", () => {
  assert.match(src, /조건에 맞는 주문이 없습니다/);
  assert.match(src, /완료된 PAPER 주문이 생기면 이 화면에 표시됩니다\./);
  assert.match(src, /주문 이력을 표시할 수 없습니다/);
  assert.match(src, /label="다시 불러오기"/);
});
