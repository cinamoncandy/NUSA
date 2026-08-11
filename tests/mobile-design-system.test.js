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
  assert.equal(dark.radii.md, 12);
  assert.equal(dark.icons.lg, 24);
  assert.equal(dark.colors.surfaceSunken, "#070A0B");
  assert.equal(dark.colors.primarySoft, "#15251F");
  assert.equal(dark.colors.borderStrong, "#29312E");
  assert.equal(dark.colors.info, "#9ABBC8");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume v5 obsidian finance theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#B8F2DD",
    foreground: "#07110D",
    border: "transparent",
    disabledOpacity: 0.42,
    pressedOpacity: 0.88,
    borderWidth: 1,
    radius: 12,
    minHeight: 48,
    horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#F27488");
  assert.equal(buttonTokens(theme, "danger").foreground, "#21080D");
  assert.equal(buttonTokens(theme, "neutral").background, "#101415");
  assert.equal(buttonTokens(theme, "neutral").border, "#29312E");
  assert.equal(fieldTokens(theme).background, "#070A0B");
  assert.equal(fieldTokens(theme).focus, "#D0FAEA");
  assert.equal(fieldTokens(theme).borderWidth, 1);
  assert.equal(fieldTokens(theme).focusBorderWidth, 2);
  assert.equal(cardTokens(theme).padding, 18);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#050708",
      surface: "#0A0D0E",
      surfaceRaised: "#101415",
      surfaceSunken: "#070A0B",
      text: "#F3F5F2",
      textMuted: "#7F8984",
      primary: "#B8F2DD",
      primarySoft: "#15251F",
      onPrimary: "#07110D",
      border: "#171C1A",
      borderStrong: "#29312E",
      success: "#65D6A2",
      warning: "#E7C46D",
      danger: "#F27488",
      info: "#9ABBC8",
      onDanger: "#21080D",
      focus: "#D0FAEA",
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction: {
      touchTarget: 48,
      controlHeight: 48,
      borderWidth: 1,
      focusBorderWidth: 2,
      pressedOpacity: 0.88,
      disabledOpacity: 0.42,
    },
  });
  assert.equal(designSystemSnapshot(createTheme("dark")), expected);
});

test("React Native common intelligence components and truthful system ThemeProvider are present", () => {
  const components = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/components.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/ThemeProvider.tsx"), "utf8");
  for (const name of ["NusaButton", "NusaTextField", "NusaCard", "StatusChip", "WaveMark", "SectionHeading", "AuthorityBanner", "DataRow"]) assert.match(components, new RegExp(`export function ${name}`));
  assert.match(provider, /export function ThemeProvider/);
  assert.match(provider, /export function useTheme/);
  assert.match(provider, /useColorScheme/);
  assert.match(provider, /ThemePreference = ThemeMode \\| "system"/);
  assert.match(provider, /preference === "system"/);
  assert.match(provider, /colorScheme === "light" \\? "light" : "dark"/);
  assert.match(provider, /createTheme\\(mode\\)/);
});
