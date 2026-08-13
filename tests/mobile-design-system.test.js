const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buttonTokens, cardTokens, createTheme, designSystemSnapshot, fieldTokens } = require("../dist/apps/mobile/src/designSystem.js");

test("light and dark themes expose frozen semantic Island finance tokens", () => {
  const light = createTheme("light");
  const dark = createTheme("dark");
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.equal(light.spacing.lg, 16);
  assert.equal(dark.radii.md, 12);
  assert.equal(dark.icons.lg, 24);
  assert.equal(dark.colors.surfaceSunken, "#081317");
  assert.equal(dark.colors.primarySoft, "#11332D");
  assert.equal(dark.colors.borderStrong, "#294852");
  assert.equal(dark.colors.info, "#7DC5DA");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume Island finance theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#70E0C1", foreground: "#06241D", border: "transparent",
    disabledOpacity: 0.42, pressedOpacity: 0.88, borderWidth: 1,
    radius: 16, minHeight: 48, horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#FF7D91");
  assert.equal(buttonTokens(theme, "danger").foreground, "#2A0810");
  assert.equal(buttonTokens(theme, "neutral").background, "#102229");
  assert.equal(buttonTokens(theme, "neutral").border, "#294852");
  assert.equal(fieldTokens(theme).background, "#081317");
  assert.equal(fieldTokens(theme).focus, "#A5F0DC");
  assert.equal(fieldTokens(theme).borderWidth, 1);
  assert.equal(fieldTokens(theme).focusBorderWidth, 2);
  assert.equal(cardTokens(theme).padding, 18);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#071014", surface: "#0B171C", surfaceRaised: "#102229", surfaceSunken: "#081317",
      text: "#F2F8F6", textMuted: "#8CA19A", primary: "#70E0C1", primarySoft: "#11332D",
      onPrimary: "#06241D", border: "#183039", borderStrong: "#294852", success: "#67D8A4",
      warning: "#EBCB76", danger: "#FF7D91", info: "#7DC5DA", onDanger: "#2A0810", focus: "#A5F0DC",
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction: { touchTarget: 48, controlHeight: 48, borderWidth: 1, focusBorderWidth: 2, pressedOpacity: 0.88, disabledOpacity: 0.42 },
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
