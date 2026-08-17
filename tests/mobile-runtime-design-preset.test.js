const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("design system exposes runtime-switchable named presets", () => {
  const design = read("apps/mobile/src/designSystem.ts");
  assert.match(design, /export type DesignPresetName = "classic" \| "master"/);
  assert.match(design, /export const designPresets/);
  assert.match(design, /createTheme\(mode: ThemeMode, presetName: DesignPresetName = "master"\)/);
  assert.match(design, /preset: theme\.preset/);
});

test("ThemeProvider recomputes and propagates the shared theme whenever the design preset changes", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /readonly setPreset: \(preset: DesignPresetName\) => void/);
  assert.match(provider, /const \[preset, setPresetState\] = useState<DesignPresetName>\(initialPreset\)/);
  assert.match(provider, /setPresetState\(next\)/);
  assert.match(provider, /createTheme\(mode, preset\)/);
  assert.match(provider, /useMemo\(\(\) => createTheme\(mode, preset\), \[mode, preset\]\)/);
  assert.match(provider, /ThemeContext\.Provider value=\{value\}/);
});

test("master and classic presets are visually distinct without screen-specific edits", () => {
  const design = read("apps/mobile/src/designSystem.ts");
  assert.match(design, /classic: Object\.freeze/);
  assert.match(design, /master: Object\.freeze/);
  assert.match(design, /background: "#05070D"/);
  assert.match(design, /background: "#020308"/);
  assert.match(design, /heroRadius: 22/);
  assert.match(design, /heroRadius: 20/);
});

test("screen composition is preset-owned so information architecture can change without redefining a screen", () => {
  const composition = read("apps/mobile/src/screenComposition.ts");
  assert.match(composition, /Readonly<Record<DesignPresetName, ScreenCompositionManifest>>/);
  assert.match(composition, /primary: \["hero", "nextAction", "metrics", "allocation"\]/);
  assert.match(composition, /primary: \["hero", "metrics", "nextAction", "allocation"\]/);
  assert.match(composition, /secondary: \["aiInsight", "safety"\]/);
  assert.match(composition, /secondary: \["safety", "aiInsight"\]/);
  assert.match(composition, /desktopLayout: "split"/);
  assert.match(composition, /desktopLayout: "stacked"/);
  assert.match(composition, /getScreenComposition\(preset: DesignPresetName\)/);
});

test("HOME production render consumes the active preset composition", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /getScreenComposition\(theme\.preset\)\.home/);
  assert.match(home, /composition\.primary\.map/);
  assert.match(home, /primarySections\[section\]/);
  assert.match(home, /composition\.secondary\.map/);
  assert.match(home, /secondarySections\[section\]/);
  assert.match(home, /composition\.desktopLayout === "split"/);
  assert.match(home, /composition\.heroEmphasis === "dominant"/);
  assert.match(home, /testID=\{`home-layout-\$\{composition\.desktopLayout\}`\}/);
});
