import React, { createContext, useContext, useMemo, useState } from "react";
import { createTheme, type Theme, type ThemeMode } from "./designSystem";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly theme: Theme;
  readonly setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialMode = "dark" }: Readonly<{ children: React.ReactNode; initialMode?: ThemeMode }>) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const theme = useMemo(() => createTheme(mode), [mode]);
  const value = useMemo(() => Object.freeze({ mode, theme, setMode }), [mode, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
