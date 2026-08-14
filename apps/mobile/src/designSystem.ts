export type ThemeMode = "light" | "dark";
export type ButtonTone = "primary" | "danger" | "neutral";

export interface ShadowToken {
  readonly color: string;
  readonly offset: Readonly<{ width: number; height: number }>;
  readonly opacity: number;
  readonly radius: number;
  readonly elevation: number;
}

export interface Theme {
  readonly mode: ThemeMode;
  readonly colors: Readonly<{
    background: string; surface: string; surfaceRaised: string; surfaceSunken: string;
    text: string; textMuted: string; primary: string; primarySoft: string; onPrimary: string;
    aiSignalStart: string; aiSignalMid: string; aiSignalEnd: string; aiSignalSoft: string;
    border: string; borderStrong: string; success: string; warning: string; danger: string;
    info: string; onDanger: string; focus: string;
  }>;
  readonly typography: Readonly<{
    fontFamily: string; monoFamily: string; micro: number; caption: number; body: number;
    title: number; heading: number; display: number; hero: number; lineHeight: number;
    weights: Readonly<{ regular: "400"; medium: "500"; semibold: "600"; bold: "700"; }>;
  }>;
  readonly spacing: Readonly<{ zero: 0; xs: 4; sm: 8; md: 12; lg: 16; xl: 24; xxl: 32; huge: 48; }>;
  readonly radii: Readonly<{ sm: 8; md: 12; lg: 16; xl: 24; full: 9999; }>;
  readonly shadows: Readonly<{ sm: ShadowToken; md: ShadowToken; focus: ShadowToken }>;
  readonly icons: Readonly<{ sm: 16; md: 20; lg: 24; xl: 32 }>;
  readonly interaction: Readonly<{
    touchTarget: 48; controlHeight: 48; borderWidth: 1; focusBorderWidth: 2;
    pressedOpacity: 0.88; disabledOpacity: 0.42;
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

const freezeTheme = (theme: Theme): Theme => Object.freeze({
  ...theme,
  colors: Object.freeze({ ...theme.colors }),
  typography: Object.freeze({ ...theme.typography, weights: Object.freeze({ ...theme.typography.weights }) }),
  spacing: Object.freeze({ ...theme.spacing }),
  radii: Object.freeze({ ...theme.radii }),
  shadows: Object.freeze(Object.fromEntries(Object.entries(theme.shadows).map(([key, value]) => [key, Object.freeze({ ...value, offset: Object.freeze({ ...value.offset }) })])) as Theme["shadows"]),
  icons: Object.freeze({ ...theme.icons }),
  interaction: Object.freeze({ ...theme.interaction }),
});

export function createTheme(mode: ThemeMode): Theme {
  const dark = mode === "dark";
  return freezeTheme({
    mode,
    colors: {
      // OBSIDIAN FINANCE (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §2): near-black
      // graphite, not blue-black; warm off-white text; one cold-mint accent for selection
      // and primary action.
      background: dark ? "#0B0C0D" : "#F7F5F1",
      surface: dark ? "#121415" : "#FFFFFF",
      surfaceRaised: dark ? "#191C1D" : "#F1EFE9",
      surfaceSunken: dark ? "#08090A" : "#EAEDF1",
      text: dark ? "#F4F0E8" : "#15170F",
      textMuted: dark ? "#8B978F" : "#5E6B62",
      primary: dark ? "#7FE8C6" : "#0C7A56",
      primarySoft: dark ? "#16221D" : "#E3F5EC",
      onPrimary: dark ? "#08120E" : "#FFFFFF",
      aiSignalStart: "#A855F7",
      aiSignalMid: "#4F7CFF",
      aiSignalEnd: "#2DD4BF",
      aiSignalSoft: dark ? "#17152B" : "#F2EAFE",
      border: dark ? "#1E2321" : "#DEDAD1",
      borderStrong: dark ? "#2C332F" : "#C3BFB4",
      success: dark ? "#55C991" : "#147A50",
      warning: dark ? "#DDBD70" : "#8D681B",
      danger: dark ? "#F06F7F" : "#B83249",
      info: dark ? "#AEB7C5" : "#4C5665",
      onDanger: dark ? "#11151B" : "#FFFFFF",
      focus: dark ? "#7FE8C6" : "#0C7A56",
    },
    typography: {
      fontFamily: "System", monoFamily: "Menlo", micro: 10, caption: 12, body: 16,
      title: 20, heading: 28, display: 36, hero: 42, lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 1 }, opacity: dark ? 0.05 : 0.03, radius: 6, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 6 }, opacity: dark ? 0.08 : 0.05, radius: 14, elevation: 2 },
      focus: { color: dark ? "#7FE8C6" : "#0E8F68", offset: { width: 0, height: 0 }, opacity: 0.28, radius: 4, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction,
  });
}

export const themes = Object.freeze({ light: createTheme("light"), dark: createTheme("dark") });

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
  return Object.freeze({ background: theme.colors.surface, border: theme.colors.border, radius: theme.radii.lg, padding: 18, shadow: theme.shadows.sm });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({ mode: theme.mode, colors: theme.colors, spacing: theme.spacing, radii: theme.radii, icons: theme.icons, interaction: theme.interaction });
}
