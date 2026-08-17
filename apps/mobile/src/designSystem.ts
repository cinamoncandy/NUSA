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
  readonly radii: Readonly<{ sm: 8; md: 12; lg: 16; xl: 24; full: 9999; }>;
  readonly shadows: Readonly<{ sm: ShadowToken; md: ShadowToken; focus: ShadowToken; glow: ShadowToken; }>;
  readonly icons: Readonly<{ sm: 16; md: 20; lg: 24; xl: 32 }>;
  readonly interaction: Readonly<{
    touchTarget: 48; controlHeight: 48; borderWidth: 1; focusBorderWidth: 2;
    pressedOpacity: 0.88; disabledOpacity: 0.42;
  }>;
  readonly layout: Readonly<{
    screenPadding: 20; sectionGap: 22; cardPadding: 20; heroRadius: 22;
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
  layout: Object.freeze({ ...theme.layout }),
});

export function createTheme(mode: ThemeMode): Theme {
  const dark = mode === "dark";
  return freezeTheme({
    mode,
    colors: {
      background: dark ? "#05070D" : "#F6F7F9",
      surface: dark ? "#0A0F19" : "#FFFFFF",
      surfaceRaised: dark ? "#101827" : "#F0F2F5",
      surfaceSunken: dark ? "#070B13" : "#EAEDF1",
      text: dark ? "#F4F6F8" : "#11151B",
      textMuted: dark ? "#8D96A5" : "#626C7A",
      // Brand actions stay monochrome. Chromatic signal colors are reserved for AI surfaces.
      primary: dark ? "#E8F3FF" : "#11151B",
      primarySoft: dark ? "#10233A" : "#EEF1F5",
      onPrimary: dark ? "#05070D" : "#FFFFFF",
      aiSignalStart: "#B56BFF",
      aiSignalMid: "#5B8CFF",
      aiSignalEnd: "#49D7C3",
      aiSignalSoft: dark ? "#151632" : "#F2EAFE",
      terrain: dark ? "#DCEBFF" : "#23334A",
      chartUp: dark ? "#48D6C0" : "#147A50",
      chartDown: dark ? "#F17A94" : "#B83249",
      navSurface: dark ? "#080D17" : "#FFFFFF",
      border: dark ? "#182337" : "#DDE1E7",
      borderStrong: dark ? "#30445F" : "#BFC6D1",
      success: dark ? "#48D6C0" : "#147A50",
      warning: dark ? "#E5C06C" : "#8D681B",
      danger: dark ? "#F17A94" : "#B83249",
      info: dark ? "#8FA9C7" : "#4C5665",
      onDanger: dark ? "#11151B" : "#FFFFFF",
      focus: dark ? "#FFFFFF" : "#11151B",
      // Neon colors for enhanced visual redesign
      neonPurple: "#B56BFF",
      neonBlue: "#5B8CFF",
      neonTeal: "#49D7C3",
      neonGlow: dark ? "rgba(181, 107, 255, 0.2)" : "rgba(181, 107, 255, 0.1)",
    },
    typography: {
      fontFamily: "Noto Sans KR", monoFamily: "Menlo", micro: 10, caption: 12, body: 16,
      title: 21, heading: 30, display: 40, hero: 50, lineHeight: 1.5,
      weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    },
    spacing: { zero: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },
    radii: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
    shadows: {
      sm: { color: dark ? "#02040A" : "#000000", offset: { width: 0, height: 3 }, opacity: dark ? 0.2 : 0.04, radius: 10, elevation: 1 },
      md: { color: dark ? "#02040A" : "#000000", offset: { width: 0, height: 10 }, opacity: dark ? 0.3 : 0.07, radius: 22, elevation: 3 },
      focus: { color: dark ? "#FFFFFF" : "#11151B", offset: { width: 0, height: 0 }, opacity: 0.24, radius: 4, elevation: 0 },
      glow: { color: "#B56BFF", offset: { width: 0, height: 0 }, opacity: dark ? 0.4 : 0.2, radius: 24, elevation: 2 },
    },
    icons: { sm: 16, md: 20, lg: 24, xl: 32 },
    interaction,
    layout: { screenPadding: 20, sectionGap: 22, cardPadding: 20, heroRadius: 22 },
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
  return Object.freeze({ background: theme.colors.surface, border: theme.colors.border, radius: theme.radii.lg, padding: theme.layout.cardPadding, shadow: theme.shadows.sm });
}

export function designSystemSnapshot(theme: Theme): string {
  return JSON.stringify({ mode: theme.mode, colors: theme.colors, spacing: theme.spacing, radii: theme.radii, icons: theme.icons, interaction: theme.interaction });
}
