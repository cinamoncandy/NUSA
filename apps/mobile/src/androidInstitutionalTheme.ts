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
 * Android-only presentation overlay for NUSA supervisory UI concepts.
 * Direction: platform-grade neutral content surfaces, expressive hierarchy and restrained control depth.
 * Visual tokens only: no trading, authority, runtime, risk, market-data or credential semantics.
 */
export function applyAndroidInstitutionalTheme(base: Theme): Theme {
  const dark = base.mode === "dark";
  return deepFreezeTheme({
    ...base,
    colors: {
      ...base.colors,
      background: dark ? "#0B0D10" : "#F5F6F7",
      surface: dark ? "#11151A" : "#FFFFFF",
      surfaceRaised: dark ? "#171C22" : "#FFFFFF",
      surfaceSunken: dark ? "#0E1115" : "#ECEFF2",
      text: dark ? "#F5F7F8" : "#15181C",
      textMuted: dark ? "#8F99A5" : "#66707B",
      primary: dark ? "#65E0C2" : "#167A68",
      primarySoft: dark ? "#122A25" : "#DDF2EC",
      onPrimary: dark ? "#071914" : "#FFFFFF",
      aiSignalStart: dark ? "#9FA7FF" : "#5D67C8",
      aiSignalMid: dark ? "#7DBBFF" : "#347DB8",
      aiSignalEnd: dark ? "#65E0C2" : "#167A68",
      aiSignalSoft: dark ? "#192029" : "#E8ECF7",
      terrain: dark ? "#C7CDD4" : "#46515D",
      chartUp: dark ? "#65E0C2" : "#167A68",
      chartDown: dark ? "#F0767E" : "#B7444D",
      navSurface: dark ? "#11151A" : "#FCFDFD",
      border: dark ? "#262C33" : "#D9DEE3",
      borderStrong: dark ? "#444C55" : "#A5AFB9",
      success: dark ? "#6ED9AE" : "#17775D",
      warning: dark ? "#E8B15E" : "#98671F",
      danger: dark ? "#F0767E" : "#B7444D",
      info: dark ? "#79B8EF" : "#356E9F",
      onDanger: dark ? "#250709" : "#FFFFFF",
      focus: dark ? "#A4ABFF" : "#5D67C8",
      neonPurple: dark ? "#A4ABFF" : "#5D67C8",
      neonBlue: dark ? "#79B8EF" : "#347DB8",
      neonTeal: dark ? "#65E0C2" : "#167A68",
      neonGlow: dark ? "rgba(101, 224, 194, 0.10)" : "rgba(22, 122, 104, 0.07)",
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
    radii: { sm: 10, md: 16, lg: 22, xl: 30, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 2 }, opacity: dark ? 0.14 : 0.05, radius: 6, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 10 }, opacity: dark ? 0.18 : 0.07, radius: 22, elevation: 3 },
      focus: { color: dark ? "#A4ABFF" : "#5D67C8", offset: { width: 0, height: 0 }, opacity: 0.24, radius: 8, elevation: 1 },
      glow: { color: dark ? "#65E0C2" : "#167A68", offset: { width: 0, height: 0 }, opacity: dark ? 0.10 : 0.05, radius: 18, elevation: 1 },
    },
    layout: {
      screenPadding: 18,
      sectionGap: 24,
      cardPadding: 20,
      heroRadius: 38,
    },
  });
}
