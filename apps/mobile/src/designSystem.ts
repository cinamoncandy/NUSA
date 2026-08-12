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
      background: dark ? "#071014" : "#F4F8F7",
      surface: dark ? "#0B171C" : "#FFFFFF",
      surfaceRaised: dark ? "#102229" : "#EDF5F2",
      surfaceSunken: dark ? "#081317" : "#E7F0ED",
      text: dark ? "#F2F8F6" : "#10201C",
      textMuted: dark ? "#8CA19A" : "#61746D",
      primary: dark ? "#70E0C1" : "#0C745C",
      primarySoft: dark ? "#11332D" : "#D7F3E9",
      onPrimary: dark ? "#06241D" : "#FFFFFF",
      border: dark ? "#183039" : "#D2E2DD",
      borderStrong: dark ? "#294852" : "#A8C2B9",
      success: dark ? "#67D8A4" : "#167A50",
      warning: dark ? "#EBCB76" : "#8E6817",
      danger: dark ? "#FF7D91" : "#B72D49",
      info: dark ? "#7DC5DA" : "#2E7388",
      onDanger: dark ? "#2A0810" : "#FFFFFF",
      focus: dark ? "#A5F0DC" : "#0C745C",
    },
    typography: {
      fontFamily: "System", monoFamily: "Menlo", micro: 10, caption: 12, body: 16,
      title: 20, heading: 28, display: 36, hero: 42, lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 6 }, opacity: dark ? 0.22 : 0.06, radius: 18, elevation: 2 },
      md: { color: "#000000", offset: { width: 0, height: 18 }, opacity: dark ? 0.3 : 0.09, radius: 36, elevation: 7 },
      focus: { color: dark ? "#70E0C1" : "#0C745C", offset: { width: 0, height: 0 }, opacity: 0.32, radius: 6, elevation: 0 },
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
    border: tone === "neutral" ? theme.colors.borderStrong : "transparent",
    disabledOpacity: theme.interaction.disabledOpacity,
    pressedOpacity: theme.interaction.pressedOpacity,
    borderWidth: theme.interaction.borderWidth,
    radius: theme.radii.lg,
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
    radius: theme.radii.lg,
    minHeight: theme.interaction.controlHeight,
  });
}

export function cardTokens(theme: Theme) {
  return Object.freeze({ background: theme.colors.surface, border: theme.colors.border, radius: theme.radii.xl, padding: 20, shadow: theme.shadows.sm });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({ mode: theme.mode, colors: theme.colors, spacing: theme.spacing, radii: theme.radii, icons: theme.icons, interaction: theme.interaction });
}
