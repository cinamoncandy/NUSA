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
