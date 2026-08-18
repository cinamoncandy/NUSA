import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type Theme, type ThemeMode } from "./designSystem";

export type ThemePreference = ThemeMode | "system";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly preference: ThemePreference;
  readonly theme: Theme;
  readonly setMode: (mode: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function createCanonicalRuntimeTheme(mode: ThemeMode): Theme {
  const base = createTheme(mode, "master");
  const dark = mode === "dark";
  return Object.freeze({
    ...base,
    colors: Object.freeze({
      ...base.colors,
      background: dark ? "#070A0F" : "#F3F6F5",
      surface: dark ? "#0D131B" : "#FFFFFF",
      surfaceRaised: dark ? "#131D28" : "#E9F0EE",
      surfaceSunken: dark ? "#091019" : "#E2EBE8",
      text: dark ? "#F4F8F7" : "#101816",
      textMuted: dark ? "#8EA09C" : "#5A6965",
      primary: dark ? "#68E3D2" : "#10675E",
      primarySoft: dark ? "#102B28" : "#D7EEE9",
      onPrimary: dark ? "#06100E" : "#FFFFFF",
      navSurface: dark ? "#090F16" : "#F8FBFA",
      border: dark ? "#20303B" : "#CFDCD8",
      borderStrong: dark ? "#35505E" : "#93AAA3",
      focus: dark ? "#68E3D2" : "#10675E",
      neonTeal: dark ? "#68E3D2" : "#10675E",
      neonGlow: dark ? "rgba(104, 227, 210, 0.18)" : "rgba(16, 103, 94, 0.10)",
    }),
    layout: Object.freeze({
      ...base.layout,
      screenPadding: 16,
      sectionGap: 14,
      cardPadding: 18,
      heroRadius: 10,
    }),
    radii: Object.freeze({ ...base.radii, sm: 4, md: 7, lg: 10, xl: 14 }),
  });
}

export function ThemeProvider({ children, initialMode = "dark" }: Readonly<{ children: React.ReactNode; initialMode?: ThemePreference }>) {
  const colorScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialMode);
  useEffect(() => { setPreference(initialMode); }, [initialMode]);
  const mode: ThemeMode = preference === "system" ? (colorScheme === "light" ? "light" : "dark") : preference;
  const theme = useMemo(() => createCanonicalRuntimeTheme(mode), [mode]);
  const value = useMemo(() => Object.freeze({ mode, preference, theme, setMode: setPreference }), [mode, preference, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
