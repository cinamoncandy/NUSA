const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

test("primary navigation renders one dependency-free icon for every product destination", () => {
  assert.match(app, /function NavIcon/);
  for (const tab of ["Home", "Markets", "Paper", "Portfolio", "AiSignal"]) {
    assert.match(app, new RegExp(`testID="nav-icon-${tab}"`));
  }
  assert.match(app, /<NavIcon tab=\{tab\} active=\{active\} \/>/);
  assert.doesNotMatch(app, /react-native-vector-icons|@expo\/vector-icons/);
});

test("navigation keeps an accessible touch target and uses acid-lime only for active state", () => {
  assert.match(app, /navItem: \{ flex: 1, minHeight: 66/);
  assert.match(app, /const color = active \? intelligenceFieldColors\.terminalSignal : intelligenceFieldColors\.textSubtle/);
  assert.match(app, /accessibilityRole="tab"/);
  assert.match(app, /accessibilityState=\{\{ selected: active \}\}/);
});
