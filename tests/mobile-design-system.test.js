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
  assert.equal(dark.colors.surfaceSunken, "#06151F");
  assert.equal(dark.colors.primarySoft, "#113A38");
  assert.equal(dark.colors.borderStrong, "#225365");
  assert.equal(dark.colors.info, "#66B9F8");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume ocean intelligence theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#49DEC9",
    foreground: "#041F1C",
    border: "transparent",
    disabledOpacity: 0.42,
    pressedOpacity: 0.88,
    borderWidth: 1,
    radius: 12,
    minHeight: 48,
    horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#FF758B");
  assert.equal(buttonTokens(theme, "danger").foreground, "#2B050D");
  assert.equal(buttonTokens(theme, "neutral").background, "#0E2331");
  assert.equal(buttonTokens(theme, "neutral").border, "#225365");
  assert.equal(fieldTokens(theme).background, "#06151F");
  assert.equal(fieldTokens(theme).focus, "#74EBDD");
  assert.equal(fieldTokens(theme).borderWidth, 1);
  assert.equal(fieldTokens(theme).focusBorderWidth, 2);
  assert.equal(cardTokens(theme).padding, 18);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#041019",
      surface: "#091A26",
      surfaceRaised: "#0E2331",
      surfaceSunken: "#06151F",
      text: "#F5FBFD",
      textMuted: "#8DA7B4",
      primary: "#49DEC9",
      primarySoft: "#113A38",
      onPrimary: "#041F1C",
      border: "#153442",
      borderStrong: "#225365",
      success: "#52D49B",
      warning: "#F3C76A",
      danger: "#FF758B",
      info: "#66B9F8",
      onDanger: "#2B050D",
      focus: "#74EBDD",
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
  assert.match(provider, /ThemePreference = ThemeMode \| "system"/);
  assert.match(provider, /preference === "system"/);
  assert.match(provider, /colorScheme === "light" \? "light" : "dark"/);
  assert.match(provider, /createTheme\(mode\)/);
});
