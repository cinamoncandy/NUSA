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

export const wealthProductColors = Object.freeze({
  c71: "#0D171B",
  c72: "#0A1116",
  c73: "#1B2830",
  c74: "#081018",
  c75: "#061019",
  c76: "#16212A",
  c77: "#06101A",
  c78: "#1A2B38",
  c79: "#76C7FF",
  c80: "#7FE6B0",
  c81: "#39586C",
  c82: "#0A1722",
  c83: "#23455B",
  c84: "#DDF9A8",
  c85: "#D7DEE0",
  c86: "#F4F7F6",
  c87: "#7D8A90",
  c88: "#1B2A33",
  c89: "#0B1218",
  c90: "#16232C",
  c91: "#C7D2D6",
  c92: "#0A1217",
  c93: "#07101A",
  c94: "#18283A",
  c95: "#152A38",
  c96: "#0D1C28",
  c97: "#050A0F",
  c98: "#A8E66A",
  c99: "#F7F8F5",
  c100: "#99A3A9",
  c101: "#B7C1C5",
  c102: "#20303A",
  c103: "#0B1117",
  c104: "#9CA7AC",
  c105: "#F5F7F4",
  c106: "#768187",
  c107: "#919CA2",
  c108: "#A5B0B4",
  c109: "#99A4AA",
  c110: "#C8D0D2",
  c111: "#66747B",
  c112: "#071018",
  c113: "#0A1114",
  c114: "#1B2B35",
  c115: "#D9E1E3",
  c01: "#05060B", c02: "#090C14", c03: "#171D2B", c04: "#8993A8", c05: "#FF5E7A",
  c06: "#F6F7FB", c07: "#1A2940", c08: "#FFFFFF", c09: "#D9F7FF", c10: "#77859B",
  c11: "#EEF1F7", c12: "#9BA5B8", c13: "#15112C", c14: "#2A2850", c15: "#070914",
  c16: "#202047", c17: "#1B2542", c18: "#232753", c19: "#22375C", c20: "#255078",
  c21: "#8290A8", c22: "#ECF0F7", c23: "#8F99AD", c24: "#334B7A", c25: "#060813",
  c26: "#C9D1DF", c27: "#718098", c28: "#050710", c29: "#11182A", c30: "#7B61FF",
  c31: "#0D1121", c32: "#5366C9", c33: "#F0F3F8", c34: "#121725", c35: "#A9B3C5",
  c36: "#3D4961", c37: "#E4E8F0", c38: "#F5F7FB", c39: "#EEF2F8", c40: "#6E7A90",
  c41: "#080B13", c42: "#CED5E1", c43: "#62708A", c44: "#E9EDF4", c45: "#5B303E",
  c46: "#160A0F", c47: "#B8A5AD", c48: "#FFB1C0", c49: "#7D8DA8", c50: "#74849F",
  c51: "#D7DEE9", c52: "#18223D", c53: "#191C26", c54: "#2F4463", c55: "#B9C6D8",
  c56: "#F5F7FB", c57: "#D3E8F8", c58: "#6F819D", c59: "#F4F7FB", c60: "#FF9C3D",
  c61: "#F7F8FB", c62: "#24324D", c63: "#090C15", c64: "#94A5BF", c65: "#151B29",
  c66: "#BAC4D4", c67: "#101727", c68: "#62708A", c69: "#74839B", c70: "#0A0D16",
});

/**
 * MASTER VISUAL REFERENCE palette, sampled from the owner-provided NUSA concept board rather than
 * chosen here. The board is the visual source of truth for issue #536; every value below was read
 * off its pixels.
 *
 * The accent is a pale lime. An earlier written directive described this product as
 * "purple -> blue -> cyan/teal" and listed acid-lime as forbidden; the board it was meant to
 * describe is lime-accented on near-black, so the board wins per the owner's decision.
 *
 * Usage ratio target from #536: 75-80% near-black surface, 15-20% white/grey type and structure,
 * <=5% accent. The accent is for active state, verified signal and primary action only.
 */
export const masterReferenceColors = Object.freeze({
  /** Board background: near-black with a faint blue-green cast. */
  canvas: "#091012",
  /** Primary accent: filled CTA, active navigation, verified chips. Carries dark text. */
  accent: "#D0F8B0",
  /** Accent at rest: sparklines, positive deltas, softer active state. */
  accentSoft: "#9BDBA3",
  /** Accent mid: gradient stops and secondary markers between accent and accentSoft. */
  accentMuted: "#B1E6AC",
  /** Text colour to place on an accent fill. The accent is light, so its foreground is dark. */
  onAccent: "#0B1210",
});

export const intelligenceFieldColors = Object.freeze({
  surface: "#060812",
  border: "#202A42",
  ambientPurple: "#17112F",
  ambientTeal: "#08242A",
  textMuted: "#9099AE",
  textSubtle: "#69758E",
  grid: "#1C2640",
  text: "#F8FAFF",
  heroBorder: "#27314B",
  heroMuted: "#9AA5BA",
  terminalSignal: "#33D7C7",
});

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
      background: "#05060B", surface: "#090C14", surfaceRaised: "#101522", surfaceSunken: "#060811",
      text: "#F7F8FC", textMuted: "#8C94A7", primary: "#7B61FF", primarySoft: "#14052C", onPrimary: "#FFFFFF",
      navSurface: "#070911", border: "#171D2C", borderStrong: "#2B3550", info: "#59C9FF", focus: "#8C6CFF",
      neonGlow: "rgba(123, 97, 255, 0.28)",
    }),
    light: Object.freeze({
      background: "#F4F5F8", surface: "#FFFFFF", surfaceRaised: "#F0F3FA", surfaceSunken: "#EDF0F6",
      text: "#171D2B", textMuted: "#616B7E", primary: "#304EE8", primarySoft: "#E9EEFF", onPrimary: "#FFFFFF",
      navSurface: "#FFFFFF", border: "#E3E7EE", borderStrong: "#8994AA", info: "#43567D", focus: "#304EE8",
      neonGlow: "rgba(155, 108, 255, 0.08)",
    }),
    typography: Object.freeze({ micro: 11, caption: 12, body: 14, title: 20, heading: 30, display: 42, hero: 54 }),
    layout: Object.freeze({ screenPadding: 20, sectionGap: 20, cardPadding: 18, heroRadius: 28 }),
    radii: Object.freeze({ sm: 8, md: 14, lg: 20, xl: 28, full: 9999 as const }),
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
      aiSignalStart: dark ? "#7B61FF" : "#7C3AED",
      aiSignalMid: dark ? "#4B8DFF" : "#2563EB",
      aiSignalEnd: dark ? "#33D7C7" : "#0B6B60",
      aiSignalSoft: dark ? "#11142A" : "#F2EAFE",
      terrain: dark ? "#8A75FF" : "#23334A",
      chartUp: dark ? "#34D6B4" : "#147A50",
      chartDown: dark ? "#FF6482" : "#B83249",
      navSurface: palette.navSurface,
      border: palette.border,
      borderStrong: palette.borderStrong,
      success: dark ? "#59C88A" : preset.name === "master" ? "#0F6843" : "#147A50",
      warning: dark ? "#E5C06C" : "#8D681B",
      danger: dark ? "#F17A94" : preset.name === "master" ? "#8F263B" : "#B83249",
      info: palette.info,
      onDanger: dark ? "#11151B" : "#FFFFFF",
      focus: palette.focus,
      neonPurple: "#9B6CFF",
      neonBlue: "#5B8CFF",
      neonTeal: "#36D8CB",
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
      sm: { color: dark ? "#02040A" : "#000000", offset: { width: 0, height: 3 }, opacity: dark ? 0.2 : 0.04, radius: 10, elevation: 1 },
      md: { color: dark ? "#02040A" : "#000000", offset: { width: 0, height: 10 }, opacity: dark ? 0.3 : 0.07, radius: 22, elevation: 3 },
      focus: { color: palette.focus, offset: { width: 0, height: 0 }, opacity: 0.24, radius: 4, elevation: 0 },
      glow: { color: "#6F63FF", offset: { width: 0, height: 0 }, opacity: dark ? 0.42 : 0.2, radius: 28, elevation: 2 },
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
