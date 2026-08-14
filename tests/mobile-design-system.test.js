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
  assert.equal(dark.colors.surfaceSunken, "#08090A");
  assert.equal(dark.colors.primarySoft, "#16221D");
  assert.equal(dark.colors.borderStrong, "#2C332F");
  assert.equal(dark.colors.info, "#AEB7C5");
  assert.equal(dark.colors.aiSignalStart, "#A855F7");
  assert.equal(dark.colors.aiSignalMid, "#4F7CFF");
  assert.equal(dark.colors.aiSignalEnd, "#2DD4BF");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume Island finance theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#7FE8C6", foreground: "#08120E", border: "transparent",
    disabledOpacity: 0.42, pressedOpacity: 0.88, borderWidth: 1,
    radius: 12, minHeight: 48, horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#F06F7F");
  assert.equal(buttonTokens(theme, "danger").foreground, "#11151B");
  assert.equal(buttonTokens(theme, "neutral").background, "#191C1D");
  assert.equal(buttonTokens(theme, "neutral").border, "#1E2321");
  assert.equal(fieldTokens(theme).background, "#08090A");
  assert.equal(fieldTokens(theme).focus, "#7FE8C6");
  assert.equal(fieldTokens(theme).borderWidth, 1);
  assert.equal(fieldTokens(theme).focusBorderWidth, 2);
  assert.equal(cardTokens(theme).padding, 18);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#0B0C0D", surface: "#121415", surfaceRaised: "#191C1D", surfaceSunken: "#08090A",
      text: "#F4F0E8", textMuted: "#8B978F", primary: "#7FE8C6", primarySoft: "#16221D",
      onPrimary: "#08120E", aiSignalStart: "#A855F7", aiSignalMid: "#4F7CFF", aiSignalEnd: "#2DD4BF", aiSignalSoft: "#17152B",
      border: "#1E2321", borderStrong: "#2C332F", success: "#55C991",
      warning: "#DDBD70", danger: "#F06F7F", info: "#AEB7C5", onDanger: "#11151B", focus: "#7FE8C6",
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
