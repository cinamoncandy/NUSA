const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buttonTokens, cardTokens, createTheme, designSystemSnapshot, fieldTokens } = require("../dist/apps/mobile/src/designSystem.js");

test("classic and master themes are frozen, semantic, and geometrically distinct", () => {
  const classicDark = createTheme("dark", "classic");
  const masterDark = createTheme("dark", "master");
  const masterLight = createTheme("light", "master");
  const defaultDark = createTheme("dark");

  assert.equal(defaultDark.preset, "master");
  assert.equal(classicDark.preset, "classic");
  assert.equal(masterDark.preset, "master");
  assert.notEqual(masterLight.colors.background, masterDark.colors.background);

  assert.equal(classicDark.radii.md, 12);
  assert.equal(masterDark.radii.md, 5);
  assert.equal(classicDark.layout.cardPadding, 20);
  assert.equal(masterDark.layout.cardPadding, 16);
  assert.equal(classicDark.layout.heroRadius, 22);
  assert.equal(masterDark.layout.heroRadius, 8);
  assert.equal(classicDark.typography.hero, 50);
  assert.equal(masterDark.typography.hero, 58);
  assert.notEqual(classicDark.colors.background, masterDark.colors.background);

  assert.equal(masterDark.colors.surfaceSunken, "#020807");
  assert.equal(masterDark.colors.primarySoft, "#17230D");
  assert.equal(masterDark.colors.borderStrong, "#2D443A");
  assert.equal(masterDark.colors.info, "#B4BAC4");
  assert.equal(masterDark.colors.aiSignalStart, "#9B6CFF");
  assert.equal(masterDark.colors.aiSignalMid, "#5B8CFF");
  assert.equal(masterDark.colors.aiSignalEnd, "#36D8CB");
  assert.equal(masterDark.icons.lg, 24);

  assert.equal(Object.isFrozen(masterDark), true);
  assert.equal(Object.isFrozen(masterDark.colors), true);
  assert.equal(Object.isFrozen(masterDark.shadows.sm.offset), true);
  assert.equal(Object.isFrozen(masterDark.interaction), true);
});

test("common component contracts consume the active preset rather than frozen legacy literals", () => {
  const classic = createTheme("dark", "classic");
  const master = createTheme("dark", "master");

  for (const theme of [classic, master]) {
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
    assert.equal(fieldTokens(theme).borderWidth, theme.interaction.borderWidth);
    assert.equal(fieldTokens(theme).focusBorderWidth, theme.interaction.focusBorderWidth);
    assert.equal(cardTokens(theme).padding, theme.layout.cardPadding);
    assert.equal(cardTokens(theme).radius, theme.radii.lg);
  }

  assert.notDeepEqual(buttonTokens(classic), buttonTokens(master));
  assert.notDeepEqual(cardTokens(classic), cardTokens(master));
});

test("design system snapshot is deterministic and preset-aware", () => {
  const classic = createTheme("dark", "classic");
  const master = createTheme("dark", "master");
  const masterSnapshot = designSystemSnapshot(master);

  assert.equal(designSystemSnapshot(master), masterSnapshot);
  assert.notEqual(designSystemSnapshot(classic), masterSnapshot);

  const parsed = JSON.parse(masterSnapshot);
  assert.equal(parsed.preset, "master");
  assert.equal(parsed.mode, "dark");
  assert.equal(parsed.colors.background, master.colors.background);
  assert.deepEqual(parsed.typography, master.typography);
  assert.deepEqual(parsed.layout, master.layout);
  assert.deepEqual(parsed.radii, master.radii);
  assert.deepEqual(parsed.interaction, master.interaction);
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
  assert.match(provider, /CURRENT_DEFAULT_PRESET: DesignPresetName = "master"/);
  assert.match(provider, /DESIGN_PRESET_STORAGE_KEY/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPreset/);
  assert.match(provider, /createTheme\(mode, preset\)/);
});
