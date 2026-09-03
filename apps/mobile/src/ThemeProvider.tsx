import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type DesignPresetName, type Theme, type ThemeMode } from "./designSystem";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";

export type ThemePreference = ThemeMode | "system";

const DESIGN_PRESET_STORAGE_KEY = "nusa:design-preset";
const DESIGN_PRESET_SCHEMA_KEY = "nusa:design-preset-schema";
const RELEASE_BUILD_SOURCE_SHA = /^[0-9a-f]{40}$/i.test(BUILD_SOURCE_SHA) ? BUILD_SOURCE_SHA.toLowerCase() : null;
const DESIGN_PRESET_SCHEMA_VERSION = RELEASE_BUILD_SOURCE_SHA == null ? "dev-v3" : `build:${RELEASE_BUILD_SOURCE_SHA}`;
const CURRENT_DEFAULT_PRESET: DesignPresetName = "master";
const isDesignPresetName = (value: string | null): value is DesignPresetName => value === "classic" || value === "master";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly preference: ThemePreference;
  readonly preset: DesignPresetName;
  readonly theme: Theme;
  readonly setMode: (mode: ThemePreference) => void;
  readonly setPreset: (preset: DesignPresetName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialMode = "dark", initialPreset = CURRENT_DEFAULT_PRESET }: Readonly<{ children: React.ReactNode; initialMode?: ThemePreference; initialPreset?: DesignPresetName }>) {
  const colorScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialMode);
  const [preset, setPresetState] = useState<DesignPresetName>(initialPreset);

  useEffect(() => { setPreference(initialMode); }, [initialMode]);
  useEffect(() => { setPresetState(initialPreset); }, [initialPreset]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(DESIGN_PRESET_STORAGE_KEY),
      AsyncStorage.getItem(DESIGN_PRESET_SCHEMA_KEY),
    ]).then(([storedPreset, storedSchema]) => {
      if (!active) return;
      if (storedSchema !== DESIGN_PRESET_SCHEMA_VERSION) {
        setPresetState(CURRENT_DEFAULT_PRESET);
        void Promise.all([
          AsyncStorage.setItem(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET),
          AsyncStorage.setItem(DESIGN_PRESET_SCHEMA_KEY, DESIGN_PRESET_SCHEMA_VERSION),
        ]).catch(() => undefined);
        return;
      }
      if (isDesignPresetName(storedPreset)) setPresetState(storedPreset);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const setPreset = useCallback((next: DesignPresetName): void => {
    setPresetState(next);
    void Promise.all([
      AsyncStorage.setItem(DESIGN_PRESET_STORAGE_KEY, next),
      AsyncStorage.setItem(DESIGN_PRESET_SCHEMA_KEY, DESIGN_PRESET_SCHEMA_VERSION),
    ]).catch(() => undefined);
  }, []);

  const mode: ThemeMode = preference === "system" ? (colorScheme === "light" ? "light" : "dark") : preference;
  const theme = useMemo(() => createTheme(mode, preset), [mode, preset]);
  const value = useMemo(() => Object.freeze({ mode, preference, preset, theme, setMode: setPreference, setPreset }), [mode, preference, preset, theme, setPreset]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
