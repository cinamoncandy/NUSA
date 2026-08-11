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
    background: string; surface: string; surfaceRaised: string; surfaceSunken: string; text: string; textMuted: string;
    primary: string; primarySoft: string; onPrimary: string; border: string; borderStrong: string; success: string;
    warning: string; danger: string; info: string; onDanger: string; focus: string;
  }>;
  readonly typography: Readonly<{
    fontFamily: string; monoFamily: string; micro: number; caption: number; body: number; title: number; heading: number;
    display: number; hero: number; lineHeight: number;
    weights: Readonly<{ regular: "400"; medium: "500"; semibold: "600"; bold: "700"; }>;
  }>;
  readonly spacing: Readonly<{ zero: 0; xs: 4; sm: 8; md: 12; lg: 16; xl: 24; xxl: 32; huge: 48; }>;
  readonly radii: Readonly<{ sm: 8; md: 12; lg: 16; xl: 24; full: 9999; }>;
  readonly shadows: Readonly<{ sm: ShadowToken; md: ShadowToken; focus: ShadowToken }>;
  readonly icons: Readonly<{ sm: 16; md: 20; lg: 24; xl: 32 }>;
  readonly interaction: Readonly<{ touchTarget: 48; controlHeight: 48; borderWidth: 1; focusBorderWidth: 2; pressedOpacity: 0.88; disabledOpacity: 0.42; }>;
}

const freezeTheme = (theme: Theme): Theme => Object.freeze({
  ...theme,
  colors: Object.freeze({ ...theme.colors }),
  typography: Object.freeze({ ...theme.typography, weights: Object.freeze({ ...theme.typography.weights }) }),
  spacing: Object.freeze({ ...theme.spacing }), radii: Object.freeze({ ...theme.radii }),
  shadows: Object.freeze(Object.fromEntries(Object.entries(theme.shadows).map(([key, value]) => [key, Object.freeze({ ...value, offset: Object.freeze({ ...value.offset }) })])) as Theme["shadows"]),
  icons: Object.freeze({ ...theme.icons }), interaction: Object.freeze({ ...theme.interaction }),
});

export function createTheme(mode: ThemeMode): Theme {
  const dark = mode === "dark";
  return freezeTheme({
    mode,
    colors: {
      // v4: restrained institutional-finance palette. Accent is reserved for action/selection;
      // green/red remain semantic only so financial meaning is never decorative.
      background: dark ? "#071015" : "#F5F7F8",
      surface: dark ? "#0C171D" : "#FFFFFF",
      surfaceRaised: dark ? "#111F27" : "#F0F4F5",
      surfaceSunken: dark ? "#081319" : "#E9EFF1",
      text: dark ? "#F4F7F8" : "#122128",
      textMuted: dark ? "#8D9DA5" : "#5B6B72",
      primary: dark ? "#42D7C5" : "#08756B",
      primarySoft: dark ? "#123430" : "#DDF1EE",
      onPrimary: dark ? "#041B18" : "#FFFFFF",
      border: dark ? "#1A2A32" : "#D6E0E3",
      borderStrong: dark ? "#2B414B" : "#A9BCC3",
      success: dark ? "#4FD19A" : "#08784D",
      warning: dark ? "#EFC76D" : "#925808",
      danger: dark ? "#FF7189" : "#B91C45",
      info: dark ? "#72B8EC" : "#1768A7",
      onDanger: dark ? "#2B050D" : "#FFFFFF",
      focus: dark ? "#73E6D8" : "#087D75",
    },
    typography: {
      fontFamily: "System", monoFamily: "Menlo", micro: 10, caption: 12, body: 16, title: 20,
      heading: 28, display: 38, hero: 46, lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      // Finance surfaces stay quiet; hierarchy comes from spacing/typography rather than floating cards.
      sm: { color: "#000000", offset: { width: 0, height: 2 }, opacity: dark ? 0.12 : 0.045, radius: 10, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 8 }, opacity: dark ? 0.18 : 0.07, radius: 24, elevation: 4 },
      focus: { color: dark ? "#73E6D8" : "#087D75", offset: { width: 0, height: 0 }, opacity: 0.28, radius: 5, elevation: 0 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction: { touchTarget: 48, controlHeight: 48, borderWidth: 1, focusBorderWidth: 2, pressedOpacity: 0.88, disabledOpacity: 0.42 },
  });
}

export const themes = Object.freeze({ light: createTheme("light"), dark: createTheme("dark") });

export function buttonTokens(theme: Theme, tone: ButtonTone = "primary") {
  return Object.freeze({
    background: tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.surfaceRaised : theme.colors.primary,
    foreground: tone === "danger" ? theme.colors.onDanger : tone === "neutral" ? theme.colors.text : theme.colors.onPrimary,
    border: tone === "neutral" ? theme.colors.borderStrong : "transparent",
    disabledOpacity: theme.interaction.disabledOpacity, pressedOpacity: theme.interaction.pressedOpacity,
    borderWidth: theme.interaction.borderWidth, radius: theme.radii.md, minHeight: theme.interaction.controlHeight,
    horizontalPadding: theme.spacing.lg,
  });
}

export function fieldTokens(theme: Theme) {
  return Object.freeze({ background: theme.colors.surfaceSunken, foreground: theme.colors.text, placeholder: theme.colors.textMuted,
    border: theme.colors.border, focus: theme.colors.focus, borderWidth: theme.interaction.borderWidth,
    focusBorderWidth: theme.interaction.focusBorderWidth, radius: theme.radii.md, minHeight: theme.interaction.controlHeight });
}

export function cardTokens(theme: Theme) {
  return Object.freeze({ background: theme.colors.surface, border: theme.colors.border, radius: theme.radii.lg, padding: 18, shadow: theme.shadows.sm });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({ mode: theme.mode, colors: theme.colors, spacing: theme.spacing, radii: theme.radii, icons: theme.icons, interaction: theme.interaction });
}
