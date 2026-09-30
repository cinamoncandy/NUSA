const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buttonTokens, cardTokens, createTheme, designSystemSnapshot, fieldTokens } = require("../dist/apps/mobile/src/designSystem.js");

test("the field theme is the only preset, frozen and semantic", () => {
  const dark = createTheme("dark");
  const light = createTheme("light");

  for (const theme of [dark, light]) {
    assert.equal(theme.preset, "field");
    assert.equal(theme.mode, "dark");
    assert.equal(theme.colors.background, "#010204");
    assert.equal(theme.colors.primary, "#B6F04B");
    assert.equal(theme.radii.md, 8);
    assert.equal(theme.shadows.sm.opacity, 0);
    assert.equal(theme.icons.lg, 24);
  }
  assert.deepEqual(dark.colors, light.colors);

  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume the active theme rather than frozen legacy literals", () => {
  const theme = createTheme("dark");
  assert.deepEqual(buttonTokens(theme), {
    background: theme.colors.primary,
    foreground: theme.colors.onPrimary,
    border: "transparent",
    disabledOpacity: theme.interaction.disabledOpacity,
    pressedOpacity: theme.interaction.pressedOpacity,
    borderWidth: theme.interaction.borderWidth,
    radius: theme.radii.md,
    minHeight: theme.interaction.controlHeight,
    horizontalPadding: theme.spacing.lg,
  });
  assert.equal(buttonTokens(theme, "danger").background, theme.colors.danger);
  assert.equal(buttonTokens(theme, "danger").foreground, theme.colors.onDanger);
  assert.equal(buttonTokens(theme, "neutral").background, theme.colors.surfaceRaised);
  assert.equal(buttonTokens(theme, "neutral").border, theme.colors.border);
  assert.equal(fieldTokens(theme).background, theme.colors.surfaceSunken);
  assert.equal(fieldTokens(theme).focus, theme.colors.focus);
  assert.equal(fieldTokens(theme).radius, theme.radii.md);
  assert.equal(cardTokens(theme).padding, theme.layout.cardPadding);
  assert.equal(cardTokens(theme).radius, theme.radii.lg);
});

test("design system snapshot is deterministic", () => {
  const theme = createTheme("dark");
  const snapshot = designSystemSnapshot(theme);
  assert.equal(designSystemSnapshot(createTheme("dark")), snapshot);
  const parsed = JSON.parse(snapshot);
  assert.equal(parsed.preset, "field");
  assert.equal(parsed.mode, "dark");
  assert.equal(parsed.colors.background, theme.colors.background);
  assert.deepEqual(parsed.radii, theme.radii);
});

test("React Native common intelligence components and preset-aware truthful ThemeProvider are present", () => {
  const components = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/components.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/ThemeProvider.tsx"), "utf8");

  for (const name of ["NusaButton", "NusaTextField", "NusaCard", "StatusChip", "WaveMark", "SectionHeading", "AuthorityBanner", "DataRow"]) {
    assert.match(components, new RegExp(`export function ${name}`));
  }

  assert.match(provider, /export function ThemeProvider/);
  assert.match(provider, /export function useTheme/);
  assert.match(provider, /useColorScheme/);
  assert.match(provider, /ThemePreference = ThemeMode \| "system"/);
  assert.match(provider, /preference === "system"/);
  assert.match(provider, /colorScheme === "light" \? "light" : "dark"/);
  assert.match(provider, /CURRENT_DEFAULT_PRESET: DesignPresetName = "field"/);
  assert.match(provider, /DESIGN_PRESET_STORAGE_KEY/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPreset/);
  assert.match(provider, /createTheme\(mode, preset\)/);
});

test("success stays visually distinct from the AI signal tone", () => {
  const theme = createTheme("dark");
  assert.equal(theme.colors.success, "#3DDC97");
  assert.notEqual(theme.colors.success.toLowerCase(), theme.colors.aiSignalEnd.toLowerCase());
});
