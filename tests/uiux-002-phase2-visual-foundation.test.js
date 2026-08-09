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

test("Phase 2 theme keeps the deep-ocean NUSA identity and restrained accent", () => {
  const design = read("designSystem.ts");
  assert.match(design, /background: dark \? "#041019"/);
  assert.match(design, /primary: dark \? "#49DEC9"/);
  assert.match(design, /surfaceRaised: dark \? "#0E2331"/);
  assert.match(design, /radii: \{ sm: 8, md: 12, lg: 16, xl: 24/);
});

test("financial values use stable tabular numerals and touch targets remain accessible", () => {
  const components = read("components.tsx");
  const design = read("designSystem.ts");
  assert.match(components, /fontVariant: \["tabular-nums"\]/);
  assert.match(design, /minHeight: 48/);
  assert.match(components, /accessibilityRole="button"/);
});

test("danger button foreground keeps WCAG AA contrast in both themes", () => {
  const design = read("designSystem.ts");
  const danger = design.match(/danger: dark \? "(#[0-9A-F]{6})" : "(#[0-9A-F]{6})"/i);
  const onDanger = design.match(/onDanger: dark \? "(#[0-9A-F]{6})" : "(#[0-9A-F]{6})"/i);
  assert.ok(danger && onDanger, "danger color pairs must be explicit for light and dark themes");
  assert.ok(contrast(danger[1], onDanger[1]) >= 4.5, "dark danger button contrast must meet WCAG AA");
  assert.ok(contrast(danger[2], onDanger[2]) >= 4.5, "light danger button contrast must meet WCAG AA");
});

test("visual foundation does not introduce profile or avatar UI", () => {
  const components = read("components.tsx");
  assert.doesNotMatch(components, /avatar|profile photo|profile image/i);
});
