import type { Theme } from "./designSystem";

function deepFreezeTheme(theme: Theme): Theme {
  return Object.freeze({
    ...theme,
    colors: Object.freeze({ ...theme.colors }),
    typography: Object.freeze({ ...theme.typography, weights: Object.freeze({ ...theme.typography.weights }) }),
    spacing: Object.freeze({ ...theme.spacing }),
    radii: Object.freeze({ ...theme.radii }),
    shadows: Object.freeze({
      sm: Object.freeze({ ...theme.shadows.sm, offset: Object.freeze({ ...theme.shadows.sm.offset }) }),
      md: Object.freeze({ ...theme.shadows.md, offset: Object.freeze({ ...theme.shadows.md.offset }) }),
      focus: Object.freeze({ ...theme.shadows.focus, offset: Object.freeze({ ...theme.shadows.focus.offset }) }),
      glow: Object.freeze({ ...theme.shadows.glow, offset: Object.freeze({ ...theme.shadows.glow.offset }) }),
    }),
    icons: Object.freeze({ ...theme.icons }),
    interaction: Object.freeze({ ...theme.interaction }),
    layout: Object.freeze({ ...theme.layout }),
  });
}

/**
 * Android-only presentation overlay for the NUSA mobile cockpit.
 * Reference direction: luxury editorial intelligence OS, not exchange-terminal chrome.
 * Visual tokens only: no trading, authority, runtime, risk, market-data or credential semantics.
 */
export function applyAndroidInstitutionalTheme(base: Theme): Theme {
  const dark = base.mode === "dark";
  return deepFreezeTheme({
    ...base,
    colors: {
      ...base.colors,
      background: dark ? "#020405" : "#F2F1ED",
      surface: dark ? "#050809" : "#FBFAF6",
      surfaceRaised: dark ? "#080D0E" : "#ECEAE4",
      surfaceSunken: dark ? "#030607" : "#E5E2DB",
      text: dark ? "#E7E2DA" : "#171815",
      textMuted: dark ? "#7C807B" : "#62655F",
      primary: dark ? "#0BB8B0" : "#08736D",
      primarySoft: dark ? "#06201F" : "#D9ECE8",
      onPrimary: dark ? "#001110" : "#F8FFFD",
      aiSignalStart: dark ? "#3B7F91" : "#315F6B",
      aiSignalMid: dark ? "#0F9D9A" : "#0A7773",
      aiSignalEnd: dark ? "#0BB8B0" : "#08736D",
      aiSignalSoft: dark ? "#071817" : "#DDEDE9",
      terrain: dark ? "#B7C7C1" : "#314842",
      chartUp: dark ? "#0BB8B0" : "#08736D",
      chartDown: dark ? "#D75F65" : "#A33A42",
      navSurface: dark ? "#030607" : "#F7F5EF",
      border: dark ? "#141C1D" : "#D2D0C9",
      borderStrong: dark ? "#293233" : "#979A94",
      success: dark ? "#0BB8B0" : "#08736D",
      warning: dark ? "#C89236" : "#8B641F",
      danger: dark ? "#D75F65" : "#A33A42",
      info: dark ? "#7E9297" : "#52686D",
      onDanger: dark ? "#170405" : "#FFFFFF",
      focus: dark ? "#2BD8CC" : "#08736D",
      neonPurple: dark ? "#6E7284" : "#626678",
      neonBlue: dark ? "#3B7F91" : "#315F6B",
      neonTeal: dark ? "#0BB8B0" : "#08736D",
      neonGlow: dark ? "rgba(11, 184, 176, 0.06)" : "rgba(8, 115, 109, 0.05)",
    },
    typography: {
      ...base.typography,
      fontFamily: "sans-serif",
      monoFamily: "monospace",
      micro: 9,
      caption: 11,
      body: 14,
      title: 19,
      heading: 26,
      display: 37,
      hero: 52,
      lineHeight: 1.5,
    },
    radii: { sm: 3, md: 5, lg: 8, xl: 10, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 1 }, opacity: dark ? 0.12 : 0.03, radius: 3, elevation: 0 },
      md: { color: "#000000", offset: { width: 0, height: 4 }, opacity: dark ? 0.16 : 0.05, radius: 8, elevation: 1 },
      focus: { color: dark ? "#0BB8B0" : "#08736D", offset: { width: 0, height: 0 }, opacity: 0.2, radius: 3, elevation: 0 },
      glow: { color: dark ? "#0BB8B0" : "#08736D", offset: { width: 0, height: 0 }, opacity: dark ? 0.07 : 0.04, radius: 8, elevation: 0 },
    },
    layout: {
      screenPadding: 18,
      sectionGap: 16,
      cardPadding: 15,
      heroRadius: 8,
    },
  });
}
