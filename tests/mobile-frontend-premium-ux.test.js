const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shared controls expose focus, pressed and disabled semantics', () => {
  const source = read('apps/mobile/src/components.tsx');
  assert.match(source, /accessibilityState=\{\{ disabled \}\}/);
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
  assert.match(source, /minHeight: 40/);
});

test('design direction preserves read-only safety identity and Android-only completion scope', () => {
  const source = read('docs/frontend-design-direction.md');
  assert.match(source, /PAPER \/ READ ONLY \/ ZERO AUTHORITY/);
  assert.match(source, /State completeness/);
  assert.match(source, /Android is the product target/);
  assert.match(source, /iOS is not a release blocker/);
  assert.match(source, /exact-head CI success, Android native build success/);
});
