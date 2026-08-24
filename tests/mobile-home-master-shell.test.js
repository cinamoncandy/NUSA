const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME uses one MASTER header instead of the legacy global shell header", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");

  assert.match(app, /const homeShellActive = utilityView === null && activeTab === "Home"/);
  assert.match(app, /\{!homeShellActive \? <View style=\{\[styles\.header/);
  assert.match(home, /styles\.wordmark/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, />NUSA<\/Text>/);
});

test("bottom navigation is restrained and does not restore the legacy neon pill shell", () => {
  const app = read("apps/mobile/App.tsx");

  assert.doesNotMatch(app, /backgroundColor: active \? appTheme\.colors\.neonGlow/);
  assert.doesNotMatch(app, /borderColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /shadowColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /color: active \? appTheme\.colors\.neonTeal/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.aiSignalEnd : appTheme\.colors\.border/);
  assert.match(app, /color: active \? appTheme\.colors\.text : appTheme\.colors\.textMuted/);
});
