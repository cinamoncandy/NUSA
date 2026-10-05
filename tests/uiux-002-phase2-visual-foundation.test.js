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

const loadDesign = () => {
  const ts = require("typescript");
  const file = path.join(src, "designSystem.ts");
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText;
  const shim = { exports: {} };
  new Function("module", "exports", "require", out)(shim, shim.exports, require);
  return shim.exports;
};

test("Phase 2 theme follows the field preset identity and restrained accent", () => {
  const { themes } = loadDesign();
  for (const theme of [themes.dark, themes.light]) {
    assert.equal(theme.preset, "field");
    assert.equal(theme.colors.background, "#02050A");
    assert.equal(theme.colors.primary, "#5CE1FF");
  }
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
  const { themes } = loadDesign();
  for (const theme of [themes.dark, themes.light]) assert.ok(contrast(theme.colors.danger, theme.colors.onDanger) >= 4.5, "danger button contrast must meet WCAG AA");
});

test("status chip foregrounds remain readable in both themes", () => {
  const { themes } = loadDesign();
  for (const theme of [themes.dark, themes.light]) {
    for (const name of ["success", "warning", "danger", "info", "primary", "text", "textMuted"]) {
      assert.ok(contrast(theme.colors[name], theme.colors.background) >= 4.5, `${name} must be readable on the field background`);
    }
  }
});

test("visual foundation does not introduce profile or avatar UI", () => {
  const components = read("components.tsx");
  assert.doesNotMatch(components, /avatar|profile photo|profile image/i);
});
