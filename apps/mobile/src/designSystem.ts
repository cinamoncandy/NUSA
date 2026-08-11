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
      // v5 OBSIDIAN FINANCE: near-black canvas, mineral graphite surfaces and one cold mint signature.
      // Semantic green/red remain reserved for actual financial meaning, never decoration.
      background: dark ? "#050708" : "#F6F7F5",
      surface: dark ? "#0A0D0E" : "#FFFFFF",
      surfaceRaised: dark ? "#101415" : "#F0F2EF",
      surfaceSunken: dark ? "#070A0B" : "#E9ECE8",
      text: dark ? "#F3F5F2" : "#111513",
      textMuted: dark ? "#7F8984" : "#606963",
      primary: dark ? "#B8F2DD" : "#176C55",
      primarySoft: dark ? "#15251F" : "#E0F0E9",
      onPrimary: dark ? "#07110D" : "#FFFFFF",
      border: dark ? "#171C1A" : "#DDE2DE",
      borderStrong: dark ? "#29312E" : "#B8C1BB",
      success: dark ? "#65D6A2" : "#08794D",
      warning: dark ? "#E7C46D" : "#8B5A0A",
      danger: dark ? "#F27488" : "#B92343",
      info: dark ? "#9ABBC8" : "#326B7C",
      onDanger: dark ? "#21080D" : "#FFFFFF",
      focus: dark ? "#D0FAEA" : "#176C55",
    },
    typography: {
      fontFamily: "System", monoFamily: "Menlo", micro: 10, caption: 12, body: 16, title: 20,
      heading: 30, display: 40, hero: 52, lineHeight: 1.45,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      // Premium finance hierarchy is created by contrast, typography and negative space rather than floating panels.
      sm: { color: "#000000", offset: { width: 0, height: 1 }, opacity: dark ? 0.08 : 0.035, radius: 6, elevation: 0 },
      md: { color: "#000000", offset: { width: 0, height: 6 }, opacity: dark ? 0.14 : 0.06, radius: 20, elevation: 2 },
      focus: { color: dark ? "#D0FAEA" : "#176C55", offset: { width: 0, height: 0 }, opacity: 0.24, radius: 5, elevation: 0 },
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
