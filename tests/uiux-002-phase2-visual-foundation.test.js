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
const colorPair = (design, name) => {
  const match = design.match(new RegExp(`${name}: dark \\? "(#[0-9A-F]{6})" : "(#[0-9A-F]{6})"`, "i"));
  assert.ok(match, `${name} must have explicit light and dark colors`);
  return { dark: match[1], light: match[2] };
};

test("Phase 2 theme follows the canonical graphite identity and restrained accent", () => {
  const design = read("designSystem.ts");
  assert.match(design, /background: dark \? "#05070D"/);
  assert.match(design, /primary: dark \? "#E8F3FF"/);
  assert.match(design, /surfaceRaised: dark \? "#101827"/);
  assert.match(design, /terrain: dark \? "#DCEBFF"/);
  assert.match(design, /radii: \{ sm: 8, md: 12, lg: 16, xl: 24/);
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
  const danger = colorPair(design, "danger");
  const onDanger = colorPair(design, "onDanger");
  assert.ok(contrast(danger.dark, onDanger.dark) >= 4.5, "dark danger button contrast must meet WCAG AA");
  assert.ok(contrast(danger.light, onDanger.light) >= 4.5, "light danger button contrast must meet WCAG AA");
});

test("status chip foregrounds remain readable in both themes", () => {
  const design = read("designSystem.ts");
  const surfaceSunken = colorPair(design, "surfaceSunken");
  const primarySoft = colorPair(design, "primarySoft");
  const toneColors = {
    primary: colorPair(design, "primary"),
    success: colorPair(design, "success"),
    warning: colorPair(design, "warning"),
    danger: colorPair(design, "danger"),
    info: colorPair(design, "info"),
    neutral: colorPair(design, "textMuted"),
  };
  for (const mode of ["dark", "light"]) {
    for (const [tone, foreground] of Object.entries(toneColors)) {
      const background = tone === "primary" ? primarySoft[mode] : surfaceSunken[mode];
      const minimum = tone === "warning" && mode === "light" ? 3 : 4.5;
      assert.ok(contrast(foreground[mode], background) >= minimum, `${mode} ${tone} status chip contrast must remain readable`);
    }
  }
});

test("visual foundation does not introduce profile or avatar UI", () => {
  const components = read("components.tsx");
  assert.doesNotMatch(components, /avatar|profile photo|profile image/i);
});
