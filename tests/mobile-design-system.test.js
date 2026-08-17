const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buttonTokens, cardTokens, createTheme, designSystemSnapshot, fieldTokens } = require("../dist/apps/mobile/src/designSystem.js");

test("light and dark themes expose frozen semantic preset tokens", () => {
  const light = createTheme("light", "master");
  const dark = createTheme("dark", "master");
  const classic = createTheme("dark", "classic");

  assert.equal(light.preset, "master");
  assert.equal(dark.preset, "master");
  assert.equal(classic.preset, "classic");
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.notEqual(classic.colors.background, dark.colors.background);
  assert.notEqual(classic.layout.cardPadding, dark.layout.cardPadding);
  assert.notEqual(classic.radii.md, dark.radii.md);
  assert.ok(light.spacing.lg > 0);
  assert.ok(dark.radii.md >= 0);
  assert.ok(dark.icons.lg > 0);
  assert.match(dark.colors.aiSignalMid, /^#[0-9A-F]{6}$/i);
  assert.equal(Object.isFrozen(dark), true);
  assert.equal(Object.isFrozen(dark.colors), true);
  assert.equal(Object.isFrozen(dark.typography), true);
  assert.equal(Object.isFrozen(dark.layout), true);
  assert.equal(Object.isFrozen(dark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(dark.interaction), true);
});

test("common component contracts consume whichever preset theme is supplied", () => {
  for (const preset of ["classic", "master"]) {
    const theme = createTheme("dark", preset);
    const primary = buttonTokens(theme);
    const danger = buttonTokens(theme, "danger");
    const neutral = buttonTokens(theme, "neutral");
    const field = fieldTokens(theme);
    const card = cardTokens(theme);

    assert.equal(primary.background, theme.colors.primary);
    assert.equal(primary.foreground, theme.colors.onPrimary);
    assert.equal(primary.border, "transparent");
    assert.equal(primary.radius, theme.radii.md);
    assert.equal(primary.minHeight, theme.interaction.controlHeight);
    assert.equal(primary.horizontalPadding, theme.spacing.lg);
    assert.equal(danger.background, theme.colors.danger);
    assert.equal(danger.foreground, theme.colors.onDanger);
    assert.equal(neutral.background, theme.colors.surfaceRaised);
    assert.equal(neutral.border, theme.colors.border);
    assert.equal(field.background, theme.colors.surfaceSunken);
    assert.equal(field.focus, theme.colors.focus);
    assert.equal(field.borderWidth, theme.interaction.borderWidth);
    assert.equal(field.focusBorderWidth, theme.interaction.focusBorderWidth);
    assert.equal(card.background, theme.colors.surface);
    assert.equal(card.border, theme.colors.border);
    assert.equal(card.padding, theme.layout.cardPadding);
  }
});

test("design system snapshots are deterministic and preset-aware", () => {
  for (const preset of ["classic", "master"]) {
    const first = designSystemSnapshot(createTheme("dark", preset));
    const second = designSystemSnapshot(createTheme("dark", preset));
    assert.equal(first, second);
    const parsed = JSON.parse(first);
    assert.equal(parsed.preset, preset);
    assert.equal(parsed.mode, "dark");
    assert.ok(parsed.colors);
    assert.ok(parsed.typography);
    assert.ok(parsed.layout);
    assert.ok(parsed.spacing);
    assert.ok(parsed.radii);
    assert.ok(parsed.icons);
    assert.ok(parsed.interaction);
  }
  assert.notEqual(
    designSystemSnapshot(createTheme("dark", "classic")),
    designSystemSnapshot(createTheme("dark", "master")),
  );
});

test("React Native common intelligence components and preset-aware truthful system ThemeProvider are present", () => {
  const components = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/components.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/ThemeProvider.tsx"), "utf8");
  for (const name of ["NusaButton", "NusaTextField", "NusaCard", "StatusChip", "WaveMark", "SectionHeading", "AuthorityBanner", "DataRow"]) assert.match(components, new RegExp(`export function ${name}`));
  assert.match(provider, /export function ThemeProvider/);
  assert.match(provider, /export function useTheme/);
  assert.match(provider, /useColorScheme/);
  assert.match(provider, /ThemePreference = ThemeMode \| "system"/);
  assert.match(provider, /preference === "system"/);
  assert.match(provider, /colorScheme === "light" \? "light" : "dark"/);
  assert.match(provider, /CURRENT_DEFAULT_PRESET: DesignPresetName = "master"/);
  assert.match(provider, /initialPreset = CURRENT_DEFAULT_PRESET/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_KEY/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /setPreset/);
  assert.match(provider, /createTheme\(mode, preset\)/);
});
