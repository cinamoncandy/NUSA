const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobile, file), "utf8");

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("AI presents intelligence before one compact authority summary", () => {
  const ai = read("aiView.tsx");
  const thesisIndex = ai.indexOf('testID="ai-thesis-card"');
  const authorityIndex = ai.indexOf('testID="ai-authority-summary"');
  const evidenceIndex = ai.indexOf('testID="ai-evidence-card"');

  assert.ok(thesisIndex >= 0);
  assert.ok(authorityIndex > thesisIndex);
  assert.ok(evidenceIndex > authorityIndex);
  assert.equal(occurrences(ai, "ZERO AUTHORITY"), 1);
  assert.equal(occurrences(ai, "READ ONLY"), 1);
  assert.doesNotMatch(ai, /<AuthorityBanner/);
  assert.match(ai, /testID="ai-authority-card"/);
  assert.match(ai, /DataRow label="AI LIVE 권한"/);
  assert.match(ai, /DataRow label="Production mutation"/);
  assert.match(ai, /DataRow label="킬 스위치"/);
});

test("read-only PAPER uses one zero-mutation card without repeated lock diagnostics", () => {
  const trading = read("tradingView.tsx");

  assert.equal(occurrences(trading, "ZERO MUTATION"), 1);
  assert.doesNotMatch(trading, /<AuthorityBanner/);
  assert.match(trading, /testID="trading-readonly-state"/);
  assert.match(trading, /매수·매도 요청을 만들거나 서버로 전송할 수 없습니다/);
  assert.match(trading, /동작하지 않는 주문 컨트롤은 표시하지 않습니다/);
  assert.doesNotMatch(trading, /<DataRow label="주문 생성"|<DataRow label="서버 전송"|<DataRow label="현재 권한"/);
});

test("authority hierarchy closeout does not add mutation authority", () => {
  const ai = read("aiView.tsx");
  const trading = read("tradingView.tsx");

  assert.doesNotMatch(ai, /onSubmit|ORDER_CREATE|LIVE_EXECUTION/);
  assert.match(trading, /const readOnly = onSubmit === undefined/);
  assert.match(trading, /submitAvailable: onSubmit !== undefined/);
});
