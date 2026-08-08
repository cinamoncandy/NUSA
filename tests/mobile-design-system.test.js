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

test("light and dark themes expose frozen semantic intelligence tokens", () => {
  const light = createTheme("light");
  const dark = createTheme("dark");
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.equal(light.spacing.lg, 16);
  assert.equal(dark.radii.md, 10);
  assert.equal(dark.icons.lg, 24);
  assert.equal(dark.colors.surfaceSunken, "#071722");
  assert.equal(dark.colors.primarySoft, "#153E3C");
  assert.equal(dark.colors.borderStrong, "#24566C");
  assert.equal(dark.colors.info, "#6AB8FF");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
});

test("common component contracts consume ocean intelligence theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#4DE3D0",
    foreground: "#06211F",
    border: "transparent",
    disabledOpacity: 0.44,
    radius: 10,
    minHeight: 48,
    horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#FF718A");
  assert.equal(buttonTokens(theme, "neutral").background, "#112837");
  assert.equal(buttonTokens(theme, "neutral").border, "#183A4B");
  assert.equal(fieldTokens(theme).background, "#071722");
  assert.equal(fieldTokens(theme).focus, "#79F5E6");
  assert.equal(cardTokens(theme).padding, 16);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#06121C",
      surface: "#0B1B27",
      surfaceRaised: "#112837",
      surfaceSunken: "#071722",
      text: "#F4FBFF",
      textMuted: "#8FA8B7",
      primary: "#4DE3D0",
      primarySoft: "#153E3C",
      onPrimary: "#06211F",
      border: "#183A4B",
      borderStrong: "#24566C",
      success: "#52D49B",
      warning: "#F7C760",
      danger: "#FF718A",
      info: "#6AB8FF",
      onDanger: "#FFFFFF",
      focus: "#79F5E6",
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
  });
  assert.equal(designSystemSnapshot(createTheme("dark")), expected);
});

test("React Native common intelligence components and ThemeProvider are present", () => {
  const components = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/components.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/ThemeProvider.tsx"), "utf8");
  for (const name of ["NusaButton", "NusaTextField", "NusaCard", "StatusChip", "WaveMark", "SectionHeading", "AuthorityBanner", "DataRow"]) assert.match(components, new RegExp(`export function ${name}`));
  assert.match(provider, /export function ThemeProvider/);
  assert.match(provider, /export function useTheme/);
});
