export type ThemeMode = "light" | "dark";
/** The Intelligence Field language is the only design preset; legacy presets were removed. */
export type DesignPresetName = "field";
export type ButtonTone = "primary" | "danger" | "neutral";

export interface ShadowToken {
  readonly color: string;
  readonly offset: Readonly<{ width: number; height: number }>;
  readonly opacity: number;
  readonly radius: number;
  readonly elevation: number;
}

export interface DesignPreset {
  readonly name: DesignPresetName;
  readonly dark: Readonly<{
    background: string; surface: string; surfaceRaised: string; surfaceSunken: string;
    text: string; textMuted: string; primary: string; primarySoft: string; onPrimary: string;
    navSurface: string; border: string; borderStrong: string; info: string; focus: string;
    neonGlow: string;
  }>;
  readonly light: Readonly<{
    background: string; surface: string; surfaceRaised: string; surfaceSunken: string;
    text: string; textMuted: string; primary: string; primarySoft: string; onPrimary: string;
    navSurface: string; border: string; borderStrong: string; info: string; focus: string;
    neonGlow: string;
  }>;
  readonly typography: Readonly<{
    micro: number; caption: number; body: number; title: number; heading: number; display: number; hero: number;
  }>;
  readonly layout: Readonly<{
    screenPadding: number; sectionGap: number; cardPadding: number; heroRadius: number;
  }>;
  readonly radii: Readonly<{ sm: number; md: number; lg: number; xl: number; full: 9999 }>;
}

export interface Theme {
  readonly mode: ThemeMode;
  readonly preset: DesignPresetName;
  readonly colors: Readonly<{
    background: string; surface: string; surfaceRaised: string; surfaceSunken: string;
    text: string; textMuted: string; primary: string; primarySoft: string; onPrimary: string;
    aiSignalStart: string; aiSignalMid: string; aiSignalEnd: string; aiSignalSoft: string;
    terrain: string; chartUp: string; chartDown: string; navSurface: string;
    border: string; borderStrong: string; success: string; warning: string; danger: string;
    info: string; onDanger: string; focus: string;
    neonPurple: string; neonBlue: string; neonTeal: string; neonGlow: string;
  }>;
  readonly typography: Readonly<{
    fontFamily: string; monoFamily: string; micro: number; caption: number; body: number;
    title: number; heading: number; display: number; hero: number; lineHeight: number;
    weights: Readonly<{ regular: "400"; medium: "500"; semibold: "600"; bold: "700"; }>;
  }>;
  readonly spacing: Readonly<{ zero: 0; xs: 4; sm: 8; md: 12; lg: 16; xl: 24; xxl: 32; huge: 48; }>;
  readonly radii: Readonly<{ sm: number; md: number; lg: number; xl: number; full: 9999 }>;
  readonly shadows: Readonly<{ sm: ShadowToken; md: ShadowToken; focus: ShadowToken; glow: ShadowToken; }>;
  readonly icons: Readonly<{ sm: 16; md: 20; lg: 24; xl: 32 }>;
  readonly interaction: Readonly<{
    touchTarget: 48; controlHeight: 48; borderWidth: 1; focusBorderWidth: 2;
    pressedOpacity: 0.88; disabledOpacity: 0.42;
  }>;
  readonly layout: Readonly<{
    screenPadding: number; sectionGap: number; cardPadding: number; heroRadius: number;
  }>;
}

/** Intelligence Field palette: subsystem hues, amber focus and the near-black void. */
export const fieldPalette = Object.freeze({
  void: "#010204",
  paper: "#3DDC97",
  market: "#4FC3F7",
  dim: "#5B6670",
  governance: "#7C8CFF",
  muted: "#8A96A0",
  axiom: "#9B7BFF",
  label: "#C9D2D8",
  text: "#EEF3F6",
  heart: "#F4F8FA",
  halt: "#FF5C5C",
  risk: "#FFA94D",
  focus: "#FFB547",
  /** Selection/focus highlight for field visuals (focused subsystem, selected tab). Amber `focus` is kept for warning tones only. */
  accent: "#B6F04B",
});

const interaction = Object.freeze({
  touchTarget: 48 as const,
  controlHeight: 48 as const,
  borderWidth: 1 as const,
  focusBorderWidth: 2 as const,
  pressedOpacity: 0.88 as const,
  disabledOpacity: 0.42 as const,
});

/** Near-black void, hairline structure, one lime accent with a cyan focus ring. Identical in light and dark. Amber stays a warning-only tone; red stays a halt/danger-only tone. */
const fieldSurface = Object.freeze({
  background: "#010204", surface: "#06090D", surfaceRaised: "#0B1016", surfaceSunken: "#030507",
  text: "#EEF3F6", textMuted: "#8A96A0", primary: "#B6F04B", primarySoft: "#0C1606", onPrimary: "#010204",
  navSurface: "#010204", border: "#1A2129", borderStrong: "#39434D", info: "#4FC3F7", focus: "#4FC3F7",
  neonGlow: "rgba(182, 240, 75, 0.10)",
});

export const designPresets: Readonly<Record<DesignPresetName, DesignPreset>> = Object.freeze({
  field: Object.freeze({
    name: "field" as const,
    dark: fieldSurface,
    light: fieldSurface,
    typography: Object.freeze({ micro: 10, caption: 12, body: 14, title: 20, heading: 28, display: 36, hero: 44 }),
    layout: Object.freeze({ screenPadding: 20, sectionGap: 18, cardPadding: 16, heroRadius: 6 }),
    radii: Object.freeze({ sm: 4, md: 8, lg: 12, xl: 16, full: 9999 as const }),
  }),
});

const freezeTheme = (theme: Theme): Theme => Object.freeze({
  ...theme,
  colors: Object.freeze({ ...theme.colors }),
  typography: Object.freeze({ ...theme.typography, weights: Object.freeze({ ...theme.typography.weights }) }),
  spacing: Object.freeze({ ...theme.spacing }),
  radii: Object.freeze({ ...theme.radii }),
  shadows: Object.freeze(Object.fromEntries(Object.entries(theme.shadows).map(([key, value]) => [key, Object.freeze({ ...value, offset: Object.freeze({ ...value.offset }) })])) as Theme["shadows"]),
  icons: Object.freeze({ ...theme.icons }),
  interaction: Object.freeze({ ...theme.interaction }),
  layout: Object.freeze({ ...theme.layout }),
});

/** `mode` is accepted for API stability; the field language renders the same in both. */
export function createTheme(_mode: ThemeMode = "dark", presetName: DesignPresetName = "field"): Theme {
  const preset = designPresets[presetName];
  const palette = preset.dark;
  const flat = { color: "#000000", offset: { width: 0, height: 0 }, opacity: 0, radius: 0, elevation: 0 };
  return freezeTheme({
    mode: "dark",
    preset: preset.name,
    colors: {
      background: palette.background,
      surface: palette.surface,
      surfaceRaised: palette.surfaceRaised,
      surfaceSunken: palette.surfaceSunken,
      text: palette.text,
      textMuted: palette.textMuted,
      primary: palette.primary,
      primarySoft: palette.primarySoft,
      onPrimary: palette.onPrimary,
      aiSignalStart: fieldPalette.axiom,
      aiSignalMid: fieldPalette.market,
      // Informational AI tone stays distinct from success green.
      aiSignalEnd: fieldPalette.label,
      aiSignalSoft: "#0B0A14",
      terrain: fieldPalette.label,
      chartUp: fieldPalette.paper,
      chartDown: fieldPalette.halt,
      navSurface: palette.navSurface,
      border: palette.border,
      borderStrong: palette.borderStrong,
      success: fieldPalette.paper,
      warning: fieldPalette.focus,
      danger: fieldPalette.halt,
      info: palette.info,
      onDanger: fieldPalette.void,
      focus: palette.focus,
      neonPurple: fieldPalette.axiom,
      neonBlue: fieldPalette.market,
      neonTeal: fieldPalette.paper,
      neonGlow: palette.neonGlow,
    },
    typography: {
      fontFamily: "Noto Sans KR", monoFamily: "Menlo",
      ...preset.typography,
      lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: preset.radii,
    shadows: {
      sm: flat,
      md: flat,
      focus: { color: palette.focus, offset: { width: 0, height: 0 }, opacity: 0.24, radius: 4, elevation: 0 },
      glow: { color: palette.focus, offset: { width: 0, height: 0 }, opacity: 0.2, radius: 24, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction,
    layout: preset.layout,
  });
}

export const themes = Object.freeze({
  light: createTheme("light"),
  dark: createTheme("dark"),
});

export function buttonTokens(theme: Theme, tone: ButtonTone = "primary") {
  return Object.freeze({
    background: tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.surfaceRaised : theme.colors.primary,
    foreground: tone === "danger" ? theme.colors.onDanger : tone === "neutral" ? theme.colors.text : theme.colors.onPrimary,
    border: tone === "neutral" ? theme.colors.border : "transparent",
    disabledOpacity: theme.interaction.disabledOpacity,
    pressedOpacity: theme.interaction.pressedOpacity,
    borderWidth: theme.interaction.borderWidth,
    radius: theme.radii.md,
    minHeight: theme.interaction.controlHeight,
    horizontalPadding: theme.spacing.lg,
  });
}

export function fieldTokens(theme: Theme) {
  return Object.freeze({
    background: theme.colors.surfaceSunken,
    foreground: theme.colors.text,
    placeholder: theme.colors.textMuted,
    border: theme.colors.border,
    focus: theme.colors.focus,
    borderWidth: theme.interaction.borderWidth,
    focusBorderWidth: theme.interaction.focusBorderWidth,
    radius: theme.radii.md,
    minHeight: theme.interaction.controlHeight,
  });
}

export function cardTokens(theme: Theme) {
  return Object.freeze({ background: theme.colors.surface, border: theme.colors.border, radius: theme.radii.lg, padding: theme.layout.cardPadding, shadow: theme.shadows.sm });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({ preset: theme.preset, mode: theme.mode, colors: theme.colors, typography: theme.typography, layout: theme.layout, spacing: theme.spacing, radii: theme.radii, icons: theme.icons, interaction: theme.interaction });
}

/**
 * Field motion tokens. Every field animation reads its timing from here so a redesign can retune
 * or replace motion in one place. Motion always runs only on a semantic state change.
 */
export const fieldMotion = Object.freeze({
  settleMs: 900,
  settleStaggerMs: 90,
  coreTurnMs: 700,
  signalMs: 950,
  signalStaggerMs: 110,
  pulseInMs: 260,
  pulseOutMs: 900,
  flareDelayMs: 700,
  flareMs: 900,
  headerGlowMs: 800,
  headerSignalMs: 900,
  tabTransitionMs: 320,
  poseMs: 1100,
  orbitStepDeg: 18,
  revealMs: 320,
  revealStaggerMs: 55,
  revealMaxIndex: 6,
});

/**
 * Readability floors shared by every screen (owner rule: UI changes apply to the whole app). Body, value and detail
 * text is never smaller than 12 px; tracked uppercase labels and eyebrows are never smaller than 11 px. Presenters
 * wrap their font sizes in these instead of hard-coding a smaller number.
 */
export const MIN_BODY_FONT = 12;
export const MIN_LABEL_FONT = 11;
export const readableFont = (size: number): number => Math.max(size, MIN_BODY_FONT);
export const labelFont = (size: number): number => Math.max(size, MIN_LABEL_FONT);
export const readableLineHeight = (size: number, lineHeight: number): number => Math.max(lineHeight, Math.round(size * 1.4));
