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

test('AI hierarchy presents calibrated confidence before raw model probability', () => {
  const source = read('apps/mobile/src/aiView.tsx');
  const trusted = source.indexOf('label="검증 신뢰도"');
  const raw = source.indexOf('label="원시 모델 확률 (미보정)"');
  assert.ok(trusted >= 0 && raw >= 0 && trusted < raw);
  assert.match(source, /testID="ai-zero-authority-status"><StatusChip label="AI ZERO AUTHORITY"/);
  assert.match(source, /READ ONLY/);
});

test('design direction preserves read-only safety identity and Android-only completion scope', () => {
  const source = read('docs/frontend-design-direction.md');
  assert.match(source, /PAPER \/ READ ONLY \/ ZERO AUTHORITY/);
  assert.match(source, /State completeness/);
  assert.match(source, /Android is the product target/);
  assert.match(source, /iOS is not a release blocker/);
  assert.match(source, /exact-head CI success, Android native build success/);
});
