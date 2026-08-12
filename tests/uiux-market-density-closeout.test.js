const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/watchlistView.tsx"), "utf8");

test("market rows keep authority messaging at screen level instead of repeating it per row", () => {
  assert.doesNotMatch(source, /PUBLIC · READ ONLY/);
  assert.equal((source.match(/READ ONLY/g) ?? []).length, 1);
  assert.match(source, /StatusChip label="READ ONLY"/);
});

test("watchlist favorite action uses explicit text instead of unicode star glyphs", () => {
  assert.doesNotMatch(source, /★|☆/);
  assert.match(source, /active \? "관심중" : "관심"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /favorite: \{[^}]*minWidth: 52, minHeight: 48/);
});

test("market rows keep price change and volume scannable without a separate metadata row", () => {
  assert.match(source, /volumeInline:/);
  assert.match(source, /거래량 \{formatVolume\(market\.volume\)\}/);
  assert.doesNotMatch(source, /marketMeta:/);
  assert.match(source, /marketIdentity: \{[^}]*minWidth: 84/);
  assert.match(source, /price: \{[^}]*fontVariant: \["tabular-nums"\]/);
  assert.match(source, /change: \{[^}]*fontVariant: \["tabular-nums"\]/);
  assert.match(source, /volumeInline: \{[^}]*fontVariant: \["tabular-nums"\]/);
});

test("market data remains explicitly public and read only at the screen boundary", () => {
  assert.match(source, /workspaceHeader/);
  assert.match(source, /StatusChip label="READ ONLY"/);
  assert.match(source, /readOnlyNote/);
  assert.doesNotMatch(source, /ORDER_CREATE|LIVE_EXECUTION|productionMutationAllowed/);
  assert.match(source, /계좌·주문 권한과 연결되지 않습니다/);
});
