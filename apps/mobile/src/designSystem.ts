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
    background: string;
    surface: string;
    surfaceRaised: string;
    surfaceSunken: string;
    text: string;
    textMuted: string;
    primary: string;
    primarySoft: string;
    onPrimary: string;
    border: string;
    borderStrong: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    onDanger: string;
    focus: string;
  }>;
  readonly typography: Readonly<{
    fontFamily: string;
    monoFamily: string;
    micro: number;
    caption: number;
    body: number;
    title: number;
    heading: number;
    display: number;
    hero: number;
    lineHeight: number;
    weights: Readonly<{ regular: "400"; medium: "500"; semibold: "600"; bold: "700"; }>;
  }>;
  readonly spacing: Readonly<{ zero: 0; xs: 4; sm: 8; md: 12; lg: 16; xl: 24; xxl: 32; huge: 48; }>;
  readonly radii: Readonly<{ sm: 8; md: 12; lg: 16; xl: 24; full: 9999; }>;
  readonly shadows: Readonly<{ sm: ShadowToken; md: ShadowToken; focus: ShadowToken }>;
  readonly icons: Readonly<{ sm: 16; md: 20; lg: 24; xl: 32 }>;
}

const freezeTheme = (theme: Theme): Theme => Object.freeze({
  ...theme,
  colors: Object.freeze({ ...theme.colors }),
  typography: Object.freeze({ ...theme.typography, weights: Object.freeze({ ...theme.typography.weights }) }),
  spacing: Object.freeze({ ...theme.spacing }),
  radii: Object.freeze({ ...theme.radii }),
  shadows: Object.freeze(Object.fromEntries(Object.entries(theme.shadows).map(([key, value]) => [key, Object.freeze({ ...value, offset: Object.freeze({ ...value.offset }) })])) as Theme["shadows"]),
  icons: Object.freeze({ ...theme.icons }),
});

export function createTheme(mode: ThemeMode): Theme {
  const dark = mode === "dark";
  return freezeTheme({
    mode,
    colors: {
      background: dark ? "#041019" : "#F3F8FA",
      surface: dark ? "#091A26" : "#FFFFFF",
      surfaceRaised: dark ? "#0E2331" : "#EAF2F5",
      surfaceSunken: dark ? "#06151F" : "#E3EDF1",
      text: dark ? "#F5FBFD" : "#102630",
      textMuted: dark ? "#8DA7B4" : "#5A707A",
      primary: dark ? "#49DEC9" : "#087D75",
      primarySoft: dark ? "#113A38" : "#D9F1ED",
      onPrimary: dark ? "#041F1C" : "#FFFFFF",
      border: dark ? "#153442" : "#C9DAE0",
      borderStrong: dark ? "#225365" : "#9AB7C1",
      success: dark ? "#52D49B" : "#08784D",
      warning: dark ? "#F3C76A" : "#A56208",
      danger: dark ? "#FF758B" : "#B91C45",
      info: dark ? "#66B9F8" : "#1768A7",
      onDanger: dark ? "#2B050D" : "#FFFFFF",
      focus: dark ? "#74EBDD" : "#087D75",
    },
    typography: {
      fontFamily: "System",
      monoFamily: "Menlo",
      micro: 10,
      caption: 12,
      body: 16,
      title: 20,
      heading: 28,
      display: 36,
      hero: 42,
      lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 4 }, opacity: dark ? 0.18 : 0.07, radius: 14, elevation: 2 },
      md: { color: "#000000", offset: { width: 0, height: 14 }, opacity: dark ? 0.24 : 0.1, radius: 32, elevation: 6 },
      focus: { color: dark ? "#74EBDD" : "#087D75", offset: { width: 0, height: 0 }, opacity: 0.3, radius: 5, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
  });
}

export const themes = Object.freeze({ light: createTheme("light"), dark: createTheme("dark") });

export function buttonTokens(theme: Theme, tone: ButtonTone = "primary") {
  return Object.freeze({
    background: tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.surfaceRaised : theme.colors.primary,
    foreground: tone === "danger" ? theme.colors.onDanger : tone === "neutral" ? theme.colors.text : theme.colors.onPrimary,
    border: tone === "neutral" ? theme.colors.borderStrong : "transparent",
    disabledOpacity: 0.42,
    radius: theme.radii.md,
    minHeight: 48,
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
    radius: theme.radii.md,
    minHeight: 48,
  });
}

export function cardTokens(theme: Theme) {
  return Object.freeze({
    background: theme.colors.surface,
    border: theme.colors.border,
    radius: theme.radii.lg,
    padding: 18,
    shadow: theme.shadows.sm,
  });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({
    mode: theme.mode,
    colors: theme.colors,
    spacing: theme.spacing,
    radii: theme.radii,
    icons: theme.icons,
  });
}
