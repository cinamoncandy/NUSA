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

test("persisted legacy preset cannot silently pin an upgraded install to the old visual generation", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");
  assert.match(provider, /DESIGN_PRESET_SCHEMA_KEY = "nusa:design-preset-schema"/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_VERSION = "2"/);
  assert.match(provider, /CURRENT_DEFAULT_PRESET: DesignPresetName = "master"/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_SCHEMA_KEY, DESIGN_PRESET_SCHEMA_VERSION\)/);
});

test("master and classic presets are intentionally and visibly distinct", () => {
  const design = read("apps/mobile/src/designSystem.ts");
  assert.match(design, /classic: Object\.freeze/);
  assert.match(design, /master: Object\.freeze/);
  assert.match(design, /background: "#05070D"/);
  assert.match(design, /background: "#0A0B0E"/);
  assert.match(design, /background: "#F1EEE6"/);
  assert.match(design, /heroRadius: 22/);
  assert.match(design, /heroRadius: 8/);
  assert.match(design, /radii: Object\.freeze\(\{ sm: 3, md: 5, lg: 8, xl: 12/);
  assert.match(design, /hero: 58/);
});

test("screen composition is preset-owned so information architecture can change without redefining a screen", () => {
  const composition = read("apps/mobile/src/screenComposition.ts");
  assert.match(composition, /Readonly<Record<DesignPresetName, ScreenCompositionManifest>>/);
  assert.match(composition, /primary: \["hero", "nextAction", "metrics", "allocation"\]/);
  assert.match(composition, /primary: \["hero", "allocation", "metrics", "nextAction"\]/);
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
