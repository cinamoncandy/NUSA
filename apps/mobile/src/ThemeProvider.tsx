import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type DesignPresetName, type Theme, type ThemeMode } from "./designSystem";

export type ThemePreference = ThemeMode | "system";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly preference: ThemePreference;
  readonly preset: DesignPresetName;
  readonly theme: Theme;
  readonly setMode: (mode: ThemePreference) => void;
  readonly setPreset: (preset: DesignPresetName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialMode = "dark", initialPreset = "master" }: Readonly<{ children: React.ReactNode; initialMode?: ThemePreference; initialPreset?: DesignPresetName }>) {
  const colorScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialMode);
  const [preset, setPreset] = useState<DesignPresetName>(initialPreset);
  useEffect(() => { setPreference(initialMode); }, [initialMode]);
  useEffect(() => { setPreset(initialPreset); }, [initialPreset]);
  const mode: ThemeMode = preference === "system" ? (colorScheme === "light" ? "light" : "dark") : preference;
  const theme = useMemo(() => createTheme(mode, preset), [mode, preset]);
  const value = useMemo(() => Object.freeze({ mode, preference, preset, theme, setMode: setPreference, setPreset }), [mode, preference, preset, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
