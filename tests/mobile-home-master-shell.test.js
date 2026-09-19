const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HOME uses one canonical Intelligence OS authority rail instead of the legacy global shell header", () => {
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const os = read("apps/mobile/src/intelligenceOs.tsx");

  assert.match(app, /const homeShellActive = utilityView === null && activeTab === "Home"/);
  assert.match(app, /\{!homeShellActive \? <View style=\{\[styles\.header/);
  assert.match(home, /testID="home-status-rail"/);
  assert.match(home, /testID="home-master-rail"/);
  assert.match(home, /PAPER ONLY/);
  assert.match(home, /LIVE NONE/);
  assert.match(home, /AI ZERO/);
  assert.match(os, />NUSA<\/Text>/);
  assert.match(os, />PAPER ONLY<\/Text>/);
});

test("bottom navigation is restrained and does not restore the legacy neon pill shell", () => {
  const app = read("apps/mobile/App.tsx");

  assert.doesNotMatch(app, /backgroundColor: active \? appTheme\.colors\.neonGlow/);
  assert.doesNotMatch(app, /borderColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /shadowColor: active \? appTheme\.colors\.neonBlue/);
  assert.doesNotMatch(app, /color: active \? appTheme\.colors\.neonTeal/);
  assert.match(app, /backgroundColor: active \? appTheme\.colors\.primarySoft : "transparent"/);
  assert.match(app, /navigationFrame/);
  // The active marker is a thin indicator bar in the product navigation, not a filled pill.
  assert.match(app, /navIndicator.*backgroundColor: active \? appTheme\.colors\.primary : "transparent"/s);
  assert.match(app, /color: active \? appTheme\.colors\.primary : appTheme\.colors\.textMuted/);

  // Every tab carries a drawn icon built from View primitives, so navigation reads as a product
  // surface rather than a row of labels. Icons are the requirement now, not an optional extra.
  for (const tab of ["Home", "Markets", "Paper", "Portfolio", "AiSignal"]) {
    assert.match(app, new RegExp(`testID="nav-icon-${tab}"`), `${tab} tab must render an icon`);
  }
  assert.doesNotMatch(app, /react-native-vector-icons|@expo\/vector-icons/, "icons stay dependency-free View primitives");
  // 48dp minimum touch target.
  assert.match(app, /navItem: \{ flex: 1, minHeight: (?:4[89]|[5-9]\d|\d{3,})/);
});
