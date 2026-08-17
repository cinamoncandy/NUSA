const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");

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

test("Phase 2 theme follows the canonical graphite identity and restrained accent", () => {
  const classic = createTheme("dark", "classic");
  const master = createTheme("dark", "master");
  const defaultDark = createTheme("dark");

  assert.equal(classic.colors.background, "#05070D");
  assert.equal(classic.colors.primary, "#E8F3FF");
  assert.equal(classic.colors.surfaceRaised, "#101827");
  assert.equal(classic.radii.lg, 16);
  assert.equal(classic.radii.xl, 24);
  assert.equal(master.preset, "master");
  assert.equal(defaultDark.preset, "master");
  assert.notEqual(master.colors.background, classic.colors.background);
  assert.notEqual(master.colors.surfaceRaised, classic.colors.surfaceRaised);
  assert.equal(master.colors.terrain, "#DCEBFF");
  assert.equal(master.colors.aiSignalStart, "#9B6CFF");
  assert.equal(master.colors.aiSignalEnd, "#36D8CB");
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
  for (const preset of ["classic", "master"]) {
    for (const mode of ["dark", "light"]) {
      const theme = createTheme(mode, preset);
      assert.ok(contrast(theme.colors.danger, theme.colors.onDanger) >= 4.5, `${preset} ${mode} danger button contrast must meet WCAG AA`);
    }
  }
});

test("status chip foregrounds remain readable in both themes", () => {
  for (const preset of ["classic", "master"]) {
    for (const mode of ["dark", "light"]) {
      const theme = createTheme(mode, preset);
      const toneColors = {
        primary: theme.colors.primary,
        success: theme.colors.success,
        warning: theme.colors.warning,
        danger: theme.colors.danger,
        info: theme.colors.info,
        neutral: theme.colors.textMuted,
      };
      for (const [tone, foreground] of Object.entries(toneColors)) {
        const background = tone === "primary" ? theme.colors.primarySoft : theme.colors.surfaceSunken;
        const minimum = tone === "warning" && mode === "light" ? 3 : 4.5;
        assert.ok(contrast(foreground, background) >= minimum, `${preset} ${mode} ${tone} status chip contrast must remain readable`);
      }
    }
  }
});

test("visual foundation does not introduce profile or avatar UI", () => {
  const components = read("components.tsx");
  assert.doesNotMatch(components, /avatar|profile photo|profile image/i);
});
