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

export function ThemeProvider({ children, initialMode = "system" }: Readonly<{ children: React.ReactNode; initialMode?: ThemePreference }>) {
  const colorScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialMode);
  useEffect(() => { setPreference(initialMode); }, [initialMode]);
  const mode: ThemeMode = preference === "system" ? (colorScheme === "light" ? "light" : "dark") : preference;
  const theme = useMemo(() => createTheme(mode), [mode]);
  const value = useMemo(() => Object.freeze({ mode, preference, theme, setMode: setPreference }), [mode, preference, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
