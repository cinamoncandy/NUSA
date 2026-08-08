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
  readonly radii: Readonly<{ sm: 6; md: 10; lg: 14; xl: 20; full: 9999; }>;
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
      background: dark ? "#06121C" : "#F2F8FA",
      surface: dark ? "#0B1B27" : "#FFFFFF",
      surfaceRaised: dark ? "#112837" : "#EAF3F6",
      surfaceSunken: dark ? "#071722" : "#E1EDF1",
      text: dark ? "#F4FBFF" : "#102733",
      textMuted: dark ? "#8FA8B7" : "#58717D",
      primary: dark ? "#4DE3D0" : "#087F78",
      primarySoft: dark ? "#153E3C" : "#D8F3EF",
      onPrimary: dark ? "#06211F" : "#FFFFFF",
      border: dark ? "#183A4B" : "#C9DCE3",
      borderStrong: dark ? "#24566C" : "#9CBBC6",
      success: dark ? "#52D49B" : "#087A4F",
      warning: dark ? "#F7C760" : "#A66208",
      danger: dark ? "#FF718A" : "#B91C45",
      info: dark ? "#6AB8FF" : "#1769AA",
      onDanger: "#FFFFFF",
      focus: dark ? "#79F5E6" : "#087F78",
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
    radii: { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 3 }, opacity: dark ? 0.2 : 0.08, radius: 10, elevation: 2 },
      md: { color: "#000000", offset: { width: 0, height: 12 }, opacity: dark ? 0.28 : 0.12, radius: 28, elevation: 6 },
      focus: { color: dark ? "#79F5E6" : "#087F78", offset: { width: 0, height: 0 }, opacity: 0.34, radius: 4, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
  });
}

export const themes = Object.freeze({ light: createTheme("light"), dark: createTheme("dark") });

export function buttonTokens(theme: Theme, tone: ButtonTone = "primary") {
  return Object.freeze({
    background: tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.surfaceRaised : theme.colors.primary,
    foreground: tone === "danger" ? theme.colors.onDanger : tone === "neutral" ? theme.colors.text : theme.colors.onPrimary,
    border: tone === "neutral" ? theme.colors.border : "transparent",
    disabledOpacity: 0.44,
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
    padding: theme.spacing.lg,
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
