const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..", "apps", "mobile");
const read = (relative) => fs.readFileSync(path.join(mobileRoot, relative), "utf8");

test("frontend design system centralizes interaction contracts", () => {
  const source = read("src/designSystem.ts");
  assert.match(source, /readonly interaction: Readonly</);
  assert.match(source, /touchTarget: 48/);
  assert.match(source, /controlHeight: 48/);
  assert.match(source, /focusBorderWidth: 2/);
  assert.match(source, /pressedOpacity: 0\.88/);
  assert.match(source, /disabledOpacity: 0\.42/);
  assert.match(source, /disabledOpacity: theme\.interaction\.disabledOpacity/);
  assert.match(source, /minHeight: theme\.interaction\.controlHeight/);
  assert.match(source, /interaction: theme\.interaction/);
});

test("shared button exposes disabled state and tokenized press feedback", () => {
  const source = read("src/components.tsx");
  assert.match(source, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(source, /pressed \? tokens\.pressedOpacity : 1/);
  assert.match(source, /borderWidth: tokens\.borderWidth/);
});

test("shared text field exposes visible focus treatment", () => {
  const source = read("src/components.tsx");
  assert.match(source, /const \[focused, setFocused\] = useState\(false\)/);
  assert.match(source, /onBlur=\{\(\) => setFocused\(false\)\}/);
  assert.match(source, /onFocus=\{\(\) => setFocused\(true\)\}/);
  assert.match(source, /borderColor: focused \? tokens\.focus : tokens\.border/);
  assert.match(source, /borderWidth: focused \? tokens\.focusBorderWidth : tokens\.borderWidth/);
  assert.match(source, /selectionColor=\{theme\.colors\.primary\}/);
});

test("shared read-only data rows announce label and value as one unit", () => {
  const source = read("src/components.tsx");
  assert.match(source, /<View accessible accessibilityLabel=\{`\$\{label\}: \$\{value\}`\}/);
});
