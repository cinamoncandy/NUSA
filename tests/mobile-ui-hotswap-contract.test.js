const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("classic and master presets are materially distinct visual systems", () => {
  const profile = read("apps/mobile/src/homeVisualProfile.ts");
  assert.match(profile, /classic:[\s\S]*?horizontalPadding:\s*20/);
  assert.match(profile, /master:[\s\S]*?horizontalPadding:\s*14/);
  assert.match(profile, /classic:[\s\S]*?minHeight:\s*300/);
  assert.match(profile, /master:[\s\S]*?minHeight:\s*228/);
  assert.match(profile, /classic:[\s\S]*?radius:\s*22/);
  assert.match(profile, /master:[\s\S]*?radius:\s*6/);
  assert.match(profile, /classic:[\s\S]*?balanceSize:\s*52/);
  assert.match(profile, /master:[\s\S]*?balanceSize:\s*44/);
  assert.match(profile, /classic:[\s\S]*?contentGap:\s*22/);
  assert.match(profile, /master:[\s\S]*?contentGap:\s*12/);
  assert.match(profile, /classic:[\s\S]*?metricGap:\s*10/);
  assert.match(profile, /master:[\s\S]*?metricGap:\s*6/);
});

test("HomeView consumes the selected preset for MASTER geometry and composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /getHomeVisualProfile\(theme\.preset\)/);
  assert.match(home, /paddingHorizontal:\s*profile\.screen\.horizontalPadding/);
  assert.match(home, /paddingTop:\s*profile\.screen\.topPadding/);
  assert.match(home, /gap:\s*tablet \? 24 : 18/);
  assert.match(home, /paddingBottom:\s*profile\.screen\.bottomPadding/);
  assert.match(home, /maxWidth:\s*tablet \? Math\.max\(profile\.screen\.maxWidth, 980\) : profile\.screen\.maxWidth/);
  assert.match(home, /fontSize:\s*tablet \? Math\.max\(profile\.hero\.tabletBalanceSize, 58\) : Math\.max\(profile\.hero\.balanceSize, 42\)/);
  assert.match(home, /lineHeight:\s*tablet \? Math\.max\(profile\.hero\.tabletBalanceLineHeight, 64\) : Math\.max\(profile\.hero\.balanceLineHeight, 48\)/);
  assert.match(home, /letterSpacing:\s*profile\.hero\.balanceLetterSpacing/);
  assert.match(home, /testID="home-screen"/);
  assert.match(home, /testID="home-signal-trace"/);
  assert.match(home, /<InsightPanel/);
  assert.match(home, /<CompactMetric/);
  assert.match(home, /<OperationalNotice/);
  assert.doesNotMatch(home, /styles\.grid, \{ gap: profile\.density\.metricGap \}/);
});

test("fresh or stale installs converge on the canonical master preset", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET:\s*DesignPresetName\s*=\s*"master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
});
