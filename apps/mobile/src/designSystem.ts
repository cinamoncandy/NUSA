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
    text: string;
    textMuted: string;
    primary: string;
    onPrimary: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    onDanger: string;
    focus: string;
  }>;
  readonly typography: Readonly<{
    fontFamily: string;
    monoFamily: string;
    caption: number;
    body: number;
    title: number;
    heading: number;
    display: number;
    lineHeight: number;
    weights: Readonly<{ regular: "400"; medium: "500"; semibold: "600"; bold: "700"; }>;
  }>;
  readonly spacing: Readonly<{ zero: 0; xs: 4; sm: 8; md: 12; lg: 16; xl: 24; xxl: 32; huge: 48; }>;
  readonly radii: Readonly<{ sm: 4; md: 8; lg: 12; xl: 16; full: 9999; }>;
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
      background: dark ? "#0f172a" : "#f8fafc",
      surface: dark ? "#1e293b" : "#ffffff",
      surfaceRaised: dark ? "#334155" : "#f1f5f9",
      text: dark ? "#f8fafc" : "#0f172a",
      textMuted: dark ? "#94a3b8" : "#475569",
      primary: dark ? "#2dd4bf" : "#0f766e",
      onPrimary: dark ? "#0f172a" : "#ffffff",
      border: dark ? "#334155" : "#cbd5e1",
      success: dark ? "#34d399" : "#047857",
      warning: dark ? "#fbbf24" : "#b45309",
      danger: dark ? "#fb7185" : "#be123c",
      onDanger: "#ffffff",
      focus: dark ? "#5eead4" : "#0f766e",
    },
    typography: {
      fontFamily: "System",
      monoFamily: "Menlo",
      caption: 12,
      body: 16,
      title: 20,
      heading: 28,
      display: 36,
      lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 2 }, opacity: dark ? 0.18 : 0.08, radius: 6, elevation: 2 },
      md: { color: "#000000", offset: { width: 0, height: 8 }, opacity: dark ? 0.24 : 0.12, radius: 24, elevation: 5 },
      focus: { color: dark ? "#5eead4" : "#0f766e", offset: { width: 0, height: 0 }, opacity: 0.32, radius: 3, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
  });
}

export const themes = Object.freeze({ light: createTheme("light"), dark: createTheme("dark") });

export function buttonTokens(theme: Theme, tone: ButtonTone = "primary") {
  return Object.freeze({
    background: tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.surfaceRaised : theme.colors.primary,
    foreground: tone === "danger" ? theme.colors.onDanger : tone === "neutral" ? theme.colors.text : theme.colors.onPrimary,
    disabledOpacity: 0.48,
    radius: theme.radii.md,
    minHeight: 48,
    horizontalPadding: theme.spacing.lg,
  });
}

export function fieldTokens(theme: Theme) {
  return Object.freeze({
    background: theme.colors.surfaceRaised,
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
