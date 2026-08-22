export type ThemeMode = "light" | "dark";
export type DesignPresetName = "classic" | "master";
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

const interaction = Object.freeze({
  touchTarget: 48 as const,
  controlHeight: 48 as const,
  borderWidth: 1 as const,
  focusBorderWidth: 2 as const,
  pressedOpacity: 0.88 as const,
  disabledOpacity: 0.42 as const,
});

export const designPresets: Readonly<Record<DesignPresetName, DesignPreset>> = Object.freeze({
  classic: Object.freeze({
    name: "classic" as const,
    dark: Object.freeze({
      background: "#05070D", surface: "#0A0F19", surfaceRaised: "#101827", surfaceSunken: "#070B13",
      text: "#F4F6F8", textMuted: "#8D96A5", primary: "#E8F3FF", primarySoft: "#10233A", onPrimary: "#05070D",
      navSurface: "#080D17", border: "#182337", borderStrong: "#30445F", info: "#8FA9C7", focus: "#FFFFFF",
      neonGlow: "rgba(181, 107, 255, 0.2)",
    }),
    light: Object.freeze({
      background: "#F6F7F9", surface: "#FFFFFF", surfaceRaised: "#F0F2F5", surfaceSunken: "#EAEDF1",
      text: "#11151B", textMuted: "#626C7A", primary: "#11151B", primarySoft: "#EEF1F5", onPrimary: "#FFFFFF",
      navSurface: "#FFFFFF", border: "#DDE1E7", borderStrong: "#BFC6D1", info: "#4C5665", focus: "#11151B",
      neonGlow: "rgba(181, 107, 255, 0.1)",
    }),
    typography: Object.freeze({ micro: 10, caption: 12, body: 16, title: 21, heading: 30, display: 40, hero: 50 }),
    layout: Object.freeze({ screenPadding: 20, sectionGap: 22, cardPadding: 20, heroRadius: 22 }),
    radii: Object.freeze({ sm: 8, md: 12, lg: 16, xl: 24, full: 9999 as const }),
  }),
  master: Object.freeze({
    name: "master" as const,
    dark: Object.freeze({
      background: "#030607", surface: "#07100E", surfaceRaised: "#0B1714", surfaceSunken: "#020807",
      text: "#F3F7F4", textMuted: "#7F918A", primary: "#B7FF38", primarySoft: "#17230D", onPrimary: "#071005",
      navSurface: "#040A08", border: "#14231E", borderStrong: "#2D443A", info: "#7FD8FF", focus: "#B7FF38",
      neonGlow: "rgba(183, 255, 56, 0.18)",
    }),
    light: Object.freeze({
      background: "#F1F3EE", surface: "#FAFCF7", surfaceRaised: "#E8ECE4", surfaceSunken: "#E1E6DD",
      text: "#101512", textMuted: "#58645E", primary: "#18220D", primarySoft: "#DDEBCB", onPrimary: "#F9FFF1",
      navSurface: "#F7F9F4", border: "#CBD3C8", borderStrong: "#87948B", info: "#235C72", focus: "#18220D",
      neonGlow: "rgba(89, 130, 20, 0.10)",
    }),
    typography: Object.freeze({ micro: 9, caption: 11, body: 14, title: 20, heading: 29, display: 40, hero: 58 }),
    layout: Object.freeze({ screenPadding: 14, sectionGap: 12, cardPadding: 16, heroRadius: 8 }),
    radii: Object.freeze({ sm: 3, md: 5, lg: 8, xl: 12, full: 9999 as const }),
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

export function createTheme(mode: ThemeMode, presetName: DesignPresetName = "master"): Theme {
  const dark = mode === "dark";
  const preset = designPresets[presetName];
  const palette = dark ? preset.dark : preset.light;
  return freezeTheme({
    mode,
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
      aiSignalStart: dark ? "#B7FF38" : "#477A12",
      aiSignalMid: dark ? "#43D9B4" : "#087C68",
      aiSignalEnd: dark ? "#7FD8FF" : "#17677F",
      aiSignalSoft: dark ? "#0C1A14" : "#E4F1E9",
      terrain: dark ? "#DFFFEA" : "#183B2D",
      chartUp: dark ? "#B7FF38" : "#397312",
      chartDown: dark ? "#FF6B78" : "#B83249",
      navSurface: palette.navSurface,
      border: palette.border,
      borderStrong: palette.borderStrong,
      success: dark ? "#B7FF38" : "#397312",
      warning: dark ? "#FFD166" : "#8D681B",
      danger: dark ? "#FF6B78" : "#B83249",
      info: palette.info,
      onDanger: dark ? "#090C0B" : "#FFFFFF",
      focus: palette.focus,
      neonPurple: "#9B6CFF",
      neonBlue: "#7FD8FF",
      neonTeal: "#43D9B4",
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
      sm: { color: "#000000", offset: { width: 0, height: 3 }, opacity: dark ? 0.28 : 0.04, radius: 10, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 10 }, opacity: dark ? 0.38 : 0.07, radius: 22, elevation: 3 },
      focus: { color: palette.focus, offset: { width: 0, height: 0 }, opacity: 0.30, radius: 5, elevation: 0 },
      glow: { color: dark ? "#B7FF38" : "#477A12", offset: { width: 0, height: 0 }, opacity: dark ? 0.30 : 0.14, radius: 26, elevation: 2 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction,
    layout: preset.layout,
  });
}

export const themes = Object.freeze({
  light: createTheme("light", "master"),
  dark: createTheme("dark", "master"),
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
