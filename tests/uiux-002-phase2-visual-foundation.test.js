const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(src, file), "utf8");

const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (left, right) => {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const presetColorPair = (design, presetName, name) => {
  const presetStart = design.indexOf(`${presetName}: Object.freeze({`);
  assert.ok(presetStart >= 0, `${presetName} preset must exist`);
  const nextPresetName = presetName === "classic" ? "master" : null;
  const presetEnd = nextPresetName
    ? design.indexOf(`${nextPresetName}: Object.freeze({`, presetStart)
    : design.indexOf("\n});\n\nconst freezeTheme", presetStart);
  assert.ok(presetEnd > presetStart, `${presetName} preset block must be bounded`);
  const preset = design.slice(presetStart, presetEnd);
  const darkStart = preset.indexOf("dark: Object.freeze({");
  const lightStart = preset.indexOf("light: Object.freeze({");
  assert.ok(darkStart >= 0 && lightStart > darkStart, `${presetName} must define dark and light palettes`);
  const dark = preset.slice(darkStart, lightStart);
  const light = preset.slice(lightStart);
  const extract = (block, mode) => {
    const match = block.match(new RegExp(`${name}: "(#[0-9A-F]{6})"`, "i"));
    assert.ok(match, `${presetName}.${mode}.${name} must be explicit`);
    return match[1];
  };
  return { dark: extract(dark, "dark"), light: extract(light, "light") };
};
const explicitThemeColorPair = (design, name) => {
  const match = design.match(new RegExp(`${name}: dark \\? "(#[0-9A-F]{6})"(?: : preset\\.name === "master" \\? "(#[0-9A-F]{6})" : "(#[0-9A-F]{6})"| : "(#[0-9A-F]{6})")`, "i"));
  assert.ok(match, `${name} must have explicit theme colors`);
  return { dark: match[1], light: match[2] ?? match[4] };
};

test("Phase 2 theme follows the canonical preset identity and restrained accent", () => {
  const design = read("designSystem.ts");
  assert.match(design, /export type DesignPresetName = "classic" \| "master"/);
  assert.match(design, /const palette = dark \? preset\.dark : preset\.light/);
  assert.match(design, /background: palette\.background/);
  assert.match(design, /primary: palette\.primary/);
  assert.match(design, /surfaceRaised: palette\.surfaceRaised/);
  assert.match(design, /terrain: dark \? "#DCEBFF"/);
  assert.match(design, /classic: Object\.freeze\(/);
  assert.match(design, /master: Object\.freeze\(/);
  assert.match(design, /radii: preset\.radii/);
});

test("financial values use stable tabular numerals and touch targets remain accessible", () => {
  const components = read("components.tsx");
  const design = read("designSystem.ts");
  assert.match(components, /fontVariant: \["tabular-nums"\]/);
  assert.match(design, /controlHeight: 48/);
  assert.match(design, /minHeight: theme\.interaction\.controlHeight/);
  assert.match(components, /accessibilityRole="button"/);
});

test("danger button foreground keeps WCAG AA contrast in both themes", () => {
  const design = read("designSystem.ts");
  const danger = explicitThemeColorPair(design, "danger");
  const onDanger = explicitThemeColorPair(design, "onDanger");
  assert.ok(contrast(danger.dark, onDanger.dark) >= 4.5, "dark danger button contrast must meet WCAG AA");
  assert.ok(contrast(danger.light, onDanger.light) >= 4.5, "light danger button contrast must meet WCAG AA");
});

test("status chip foregrounds remain readable in both themes", () => {
  const design = read("designSystem.ts");
  for (const presetName of ["classic", "master"]) {
    const surfaceSunken = presetColorPair(design, presetName, "surfaceSunken");
    const primarySoft = presetColorPair(design, presetName, "primarySoft");
    const presetTones = {
      primary: presetColorPair(design, presetName, "primary"),
      info: presetColorPair(design, presetName, "info"),
      neutral: presetColorPair(design, presetName, "textMuted"),
    };
    const explicitTones = {
      success: explicitThemeColorPair(design, "success"),
      warning: explicitThemeColorPair(design, "warning"),
      danger: explicitThemeColorPair(design, "danger"),
    };
    for (const mode of ["dark", "light"]) {
      for (const [tone, foreground] of Object.entries({ ...presetTones, ...explicitTones })) {
        const background = tone === "primary" ? primarySoft[mode] : surfaceSunken[mode];
        const minimum = tone === "warning" && mode === "light" ? 3 : 4.5;
        assert.ok(contrast(foreground[mode], background) >= minimum, `${presetName} ${mode} ${tone} status chip contrast must remain readable`);
      }
    }
  }
});

test("visual foundation does not introduce profile or avatar UI", () => {
  const components = read("components.tsx");
  assert.doesNotMatch(components, /avatar|profile photo|profile image/i);
});
