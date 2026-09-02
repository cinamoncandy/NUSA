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
 *
 * This changes visual tokens only. It must not change trading, authority,
 * runtime, risk, market-data, freshness, or credential semantics.
 */
export function applyAndroidInstitutionalTheme(base: Theme): Theme {
  const dark = base.mode === "dark";
  return deepFreezeTheme({
    ...base,
    colors: {
      ...base.colors,
      background: dark ? "#020506" : "#F2F5F3",
      surface: dark ? "#07100F" : "#FBFDFC",
      surfaceRaised: dark ? "#0B1513" : "#E8EEEB",
      surfaceSunken: dark ? "#030908" : "#E2E9E5",
      text: dark ? "#F4F8F6" : "#101613",
      textMuted: dark ? "#82918B" : "#5C6A64",
      primary: dark ? "#41E0C2" : "#086D5D",
      primarySoft: dark ? "#0D2A24" : "#D7EEE8",
      onPrimary: dark ? "#01110D" : "#F7FFFC",
      aiSignalStart: dark ? "#7895FF" : "#315CC7",
      aiSignalMid: dark ? "#51B9F3" : "#147AA8",
      aiSignalEnd: dark ? "#41E0C2" : "#086D5D",
      aiSignalSoft: dark ? "#0A1B1B" : "#DDEFEA",
      terrain: dark ? "#D8EEE8" : "#24483E",
      chartUp: dark ? "#41E0C2" : "#08785F",
      chartDown: dark ? "#FF718A" : "#B62C49",
      navSurface: dark ? "#040A09" : "#F8FBF9",
      border: dark ? "#14231F" : "#CBD6D0",
      borderStrong: dark ? "#2D443C" : "#889A91",
      success: dark ? "#41E0C2" : "#08785F",
      warning: dark ? "#E7BC68" : "#8A6515",
      danger: dark ? "#FF718A" : "#A92540",
      info: dark ? "#91A9B8" : "#49616D",
      onDanger: dark ? "#160207" : "#FFFFFF",
      focus: dark ? "#74F7D9" : "#086D5D",
      neonPurple: dark ? "#8EA0FF" : "#536CC7",
      neonBlue: dark ? "#65B8FF" : "#256E9B",
      neonTeal: dark ? "#41E0C2" : "#086D5D",
      neonGlow: dark ? "rgba(65, 224, 194, 0.10)" : "rgba(8, 109, 93, 0.08)",
    },
    typography: {
      ...base.typography,
      fontFamily: "sans-serif",
      monoFamily: "monospace",
      micro: 9,
      caption: 11,
      body: 14,
      title: 19,
      heading: 27,
      display: 38,
      hero: 54,
      lineHeight: 1.45,
    },
    radii: { sm: 3, md: 5, lg: 7, xl: 10, full: 9999 },
    shadows: {
      sm: { color: "#000000", offset: { width: 0, height: 2 }, opacity: dark ? 0.18 : 0.04, radius: 5, elevation: 1 },
      md: { color: "#000000", offset: { width: 0, height: 6 }, opacity: dark ? 0.24 : 0.06, radius: 12, elevation: 2 },
      focus: { color: dark ? "#41E0C2" : "#086D5D", offset: { width: 0, height: 0 }, opacity: 0.24, radius: 3, elevation: 0 },
      glow: { color: dark ? "#41E0C2" : "#086D5D", offset: { width: 0, height: 0 }, opacity: dark ? 0.14 : 0.08, radius: 12, elevation: 1 },
    },
    layout: {
      screenPadding: 14,
      sectionGap: 12,
      cardPadding: 14,
      heroRadius: 6,
    },
  });
}
