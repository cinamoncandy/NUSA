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
  assert.equal(dark.colors.surfaceSunken, "#070B13");
  assert.equal(dark.colors.primarySoft, "#10233A");
  assert.equal(dark.colors.borderStrong, "#30445F");
  assert.equal(dark.colors.info, "#8FA9C7");
  assert.equal(dark.colors.aiSignalStart, "#B56BFF");
  assert.equal(dark.colors.aiSignalMid, "#5B8CFF");
  assert.equal(dark.colors.aiSignalEnd, "#49D7C3");
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume Island finance theme tokens", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: "#E8F3FF", foreground: "#05070D", border: "transparent",
    disabledOpacity: 0.42, pressedOpacity: 0.88, borderWidth: 1,
    radius: 12, minHeight: 48, horizontalPadding: 16,
  });
  assert.equal(buttonTokens(theme, "danger").background, "#F17A94");
  assert.equal(buttonTokens(theme, "danger").foreground, "#11151B");
  assert.equal(buttonTokens(theme, "neutral").background, "#101827");
  assert.equal(buttonTokens(theme, "neutral").border, "#182337");
  assert.equal(fieldTokens(theme).background, "#070B13");
  assert.equal(fieldTokens(theme).focus, "#FFFFFF");
  assert.equal(fieldTokens(theme).borderWidth, 1);
  assert.equal(fieldTokens(theme).focusBorderWidth, 2);
  assert.equal(cardTokens(theme).padding, 20);
});

test("design system snapshot is deterministic", () => {
  const expected = JSON.stringify({
    mode: "dark",
    colors: {
      background: "#05070D", surface: "#0A0F19", surfaceRaised: "#101827", surfaceSunken: "#070B13",
      text: "#F4F6F8", textMuted: "#8D96A5", primary: "#E8F3FF", primarySoft: "#10233A",
      onPrimary: "#05070D", aiSignalStart: "#B56BFF", aiSignalMid: "#5B8CFF", aiSignalEnd: "#49D7C3", aiSignalSoft: "#151632",
      terrain: "#DCEBFF", chartUp: "#48D6C0", chartDown: "#F17A94", navSurface: "#080D17",
      border: "#182337", borderStrong: "#30445F", success: "#48D6C0",
      warning: "#E5C06C", danger: "#F17A94", info: "#8FA9C7", onDanger: "#11151B", focus: "#FFFFFF",
      neonPurple: "#B56BFF", neonBlue: "#5B8CFF", neonTeal: "#49D7C3", neonGlow: "rgba(181, 107, 255, 0.2)",
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
