const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shared controls expose focus, pressed, disabled and selected semantics', () => {
  const source = read('apps/mobile/src/components.tsx');
  assert.match(source, /selected\?: boolean/);
  assert.match(source, /accessibilityState=\{\{ disabled, selected \}\}/);
  assert.match(source, /onFocus=\{\(\) => setFocused\(true\)\}/);
  assert.match(source, /onBlur=\{\(\) => setFocused\(false\)\}/);
  assert.match(source, /tokens\.pressedOpacity/);
  assert.match(source, /tokens\.focus/);
});

test('markets use semantic segmented tabs rather than competing primary CTAs', () => {
  const source = read('apps/mobile/src/marketsView.tsx');
  assert.match(source, /accessibilityRole="tab"/);
  assert.match(source, /accessibilityState=\{\{ selected \}\}/);
  assert.match(source, /accessibilityRole="tablist"/);
  assert.match(source, /segment: \{ flex: 1, minHeight: 48/);
});

test('paper and history selectors expose their current selection', () => {
  const trading = read('apps/mobile/src/tradingViewLegacy.tsx');
  const history = read('apps/mobile/src/orderHistoryView.tsx');
  assert.match(trading, /selectedKey=\{side\}/);
  assert.match(trading, /selectedKey=\{orderType\}/);
  assert.match(history, /selectedKey=\{filter\}/);
  assert.match(history, /selectedKey=\{period\}/);
  assert.match(history, /selectedKey=\{sort\}/);
});

test('Signal Detail exposes confidence only when calibrated and preserves zero authority', () => {
  const source = read('apps/mobile/src/aiView.tsx');
  assert.match(source, /const calibrated=ai\?\.calibrationStatus===\"CALIBRATED\"/);
  assert.match(source, /const trusted=calibrated\?percent\(ai\?\.confidence\):\"UNVERIFIED\"/);
  assert.match(source, /검증 신뢰도/);
  assert.match(source, /보정되지 않은 출력입니다\. 수익 확률로 표시하지 않습니다\./);
  assert.match(source, /AI ZERO AUTHORITY/);
  assert.match(source, /PUBLIC READ ONLY/);
});
test('design direction preserves read-only safety identity and Android-only completion scope', () => {
  const source = read('docs/frontend-design-direction.md');
  assert.match(source, /PAPER \/ READ ONLY \/ ZERO AUTHORITY/);
  assert.match(source, /State completeness/);
  assert.match(source, /Android is the product target/);
  assert.match(source, /iOS is not a release blocker/);
  assert.match(source, /exact-head CI success, Android native build success/);
});
