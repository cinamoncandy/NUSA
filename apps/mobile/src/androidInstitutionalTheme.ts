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
 * Android-only presentation overlay for NUSA temporary concept E.
 * Direction: calm cinematic supervisory OS, adaptive glass surfaces and restrained depth.
 * Visual tokens only: no trading, authority, runtime, risk, market-data or credential semantics.
 */
export function applyAndroidInstitutionalTheme(base: Theme): Theme {
  const dark = base.mode === "dark";
  return deepFreezeTheme({
    ...base,
    colors: {
      ...base.colors,
      background: dark ? "#07101D" : "#EEF3F8",
      surface: dark ? "#0D192A" : "#F8FBFD",
      surfaceRaised: dark ? "#13233A" : "#FFFFFF",
      surfaceSunken: dark ? "#0A1423" : "#E5EDF5",
      text: dark ? "#F2F5F7" : "#17202D",
      textMuted: dark ? "#93A1B4" : "#637184",
      primary: dark ? "#65E0C2" : "#147A68",
      primarySoft: dark ? "#102E35" : "#D9F1EA",
      onPrimary: dark ? "#06201B" : "#FFFFFF",
      aiSignalStart: dark ? "#8F9CFF" : "#5868CC",
      aiSignalMid: dark ? "#65B9FF" : "#347DB8",
      aiSignalEnd: dark ? "#65E0C2" : "#147A68",
      aiSignalSoft: dark ? "#182743" : "#E5E9FF",
      terrain: dark ? "#C1CAD7" : "#435268",
      chartUp: dark ? "#65E0C2" : "#147A68",
      chartDown: dark ? "#F06E78" : "#B9424D",
      navSurface: dark ? "#0B1727" : "#F6F9FC",
      border: dark ? "#22334A" : "#CFD9E4",
      borderStrong: dark ? "#425775" : "#91A1B4",
      success: dark ? "#73E5B5" : "#17795E",
      warning: dark ? "#F0B35A" : "#9A681D",
      danger: dark ? "#F06E78" : "#B9424D",
      info: dark ? "#71B5F5" : "#356E9F",
      onDanger: dark ? "#26070A" : "#FFFFFF",
      focus: dark ? "#9AA6FF" : "#5868CC",
      neonPurple: dark ? "#8F9CFF" : "#5868CC",
      neonBlue: dark ? "#65B9FF" : "#347DB8",
      neonTeal: dark ? "#65E0C2" : "#147A68",
      neonGlow: dark ? "rgba(143, 156, 255, 0.16)" : "rgba(88, 104, 204, 0.09)",
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
      sm: { color: "#000000", offset: { width: 0, height: 2 }, opacity: dark ? 0.16 : 0.06, radius: 6, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 10 }, opacity: dark ? 0.22 : 0.08, radius: 22, elevation: 3 },
      focus: { color: dark ? "#8F9CFF" : "#5868CC", offset: { width: 0, height: 0 }, opacity: 0.28, radius: 8, elevation: 1 },
      glow: { color: dark ? "#65E0C2" : "#147A68", offset: { width: 0, height: 0 }, opacity: dark ? 0.12 : 0.06, radius: 18, elevation: 1 },
    },
    layout: {
      screenPadding: 20,
      sectionGap: 20,
      cardPadding: 20,
      heroRadius: 30,
    },
  });
}
