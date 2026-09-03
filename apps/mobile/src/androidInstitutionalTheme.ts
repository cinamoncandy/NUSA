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
 * Android-only visual overlay for the selected temporary physical-device reference.
 * Direction: bright pearl supervisory OS, translucent control surfaces, restrained mint/lavender depth.
 * Presentation only: no trading, authority, runtime, risk, market-data or credential semantics.
 */
export function applyAndroidInstitutionalTheme(base: Theme): Theme {
  return deepFreezeTheme({
    ...base,
    mode: "light",
    colors: {
      ...base.colors,
      background: "#F5F7FB",
      surface: "#FFFFFF",
      surfaceRaised: "#FBFCFF",
      surfaceSunken: "#EEF2F7",
      text: "#11182A",
      textMuted: "#687387",
      primary: "#24B99E",
      primarySoft: "#E4F7F2",
      onPrimary: "#FFFFFF",
      aiSignalStart: "#7D83F7",
      aiSignalMid: "#5CA9F3",
      aiSignalEnd: "#24B99E",
      aiSignalSoft: "#EEF0FF",
      terrain: "#7E8DA3",
      chartUp: "#19A982",
      chartDown: "#D95866",
      navSurface: "#FBFCFF",
      border: "#E0E6EF",
      borderStrong: "#B9C3D2",
      success: "#159A72",
      warning: "#B7781E",
      danger: "#C94E5B",
      info: "#477DB9",
      onDanger: "#FFFFFF",
      focus: "#737BF0",
      neonPurple: "#8B7EF5",
      neonBlue: "#5D9EF1",
      neonTeal: "#24B99E",
      neonGlow: "rgba(125, 131, 247, 0.10)",
    },
    typography: {
      ...base.typography,
      fontFamily: "sans-serif",
      monoFamily: "monospace",
      micro: 9,
      caption: 11,
      body: 14,
      title: 20,
      heading: 28,
      display: 40,
      hero: 54,
      lineHeight: 1.5,
    },
    radii: { sm: 12, md: 18, lg: 24, xl: 32, full: 9999 },
    shadows: {
      sm: { color: "#101828", offset: { width: 0, height: 2 }, opacity: 0.05, radius: 7, elevation: 1 },
      md: { color: "#667085", offset: { width: 0, height: 10 }, opacity: 0.10, radius: 24, elevation: 3 },
      focus: { color: "#737BF0", offset: { width: 0, height: 0 }, opacity: 0.20, radius: 9, elevation: 1 },
      glow: { color: "#24B99E", offset: { width: 0, height: 0 }, opacity: 0.09, radius: 18, elevation: 1 },
    },
    layout: {
      screenPadding: 18,
      sectionGap: 20,
      cardPadding: 20,
      heroRadius: 38,
    },
  });
}
