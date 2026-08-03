const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buttonTokens,
  cardTokens,
  createTheme,
  designSystemSnapshot,
  fieldTokens,
} = require("../dist/apps/mobile/src/designSystem.js");

test("light and dark themes expose frozen semantic tokens", () => {
  const light = createTheme("light");
  const dark = createTheme("dark");
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.equal(light.spacing.lg, 16);
  assert.equal(dark.radii.md, 8);
  assert.equal(dark.icons.lg, 24);
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
});

test("common component contracts consume theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), { background: "#2dd4bf", foreground: "#0f172a", disabledOpacity: 0.48, radius: 8, minHeight: 48, horizontalPadding: 16 });
  assert.equal(buttonTokens(theme, "danger").background, "#fb7185");
  assert.equal(fieldTokens(theme).focus, "#5eead4");
  assert.equal(cardTokens(theme).padding, 16);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: { background: "#0f172a", surface: "#1e293b", surfaceRaised: "#334155", text: "#f8fafc", textMuted: "#94a3b8", primary: "#2dd4bf", onPrimary: "#0f172a", border: "#334155", success: "#34d399", warning: "#fbbf24", danger: "#fb7185", onDanger: "#ffffff", focus: "#5eead4" },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
  });
  assert.equal(designSystemSnapshot(createTheme("dark")), expected);
});

test("React Native common components and ThemeProvider are present", () => {
  const components = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/components.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/ThemeProvider.tsx"), "utf8");
  for (const name of ["NusaButton", "NusaTextField", "NusaCard"]) assert.match(components, new RegExp(`export function ${name}`));
  assert.match(provider, /export function ThemeProvider/);
  assert.match(provider, /export function useTheme/);
});
