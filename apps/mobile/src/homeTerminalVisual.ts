import type { Theme } from "./designSystem";

export interface HomeTerminalVisualProfile {
  readonly canvas: string;
  readonly surface: string;
  readonly sunken: string;
  readonly border: string;
  readonly signal: string;
}

export function createHomeTerminalVisualProfile(theme: Theme): HomeTerminalVisualProfile {
  if (theme.mode !== "dark") {
    return Object.freeze({
      canvas: theme.colors.background,
      surface: theme.colors.surface,
      sunken: theme.colors.surfaceSunken,
      border: theme.colors.border,
      signal: theme.colors.success,
    });
  }

  return Object.freeze({
    canvas: "#030503",
    surface: "#080D08",
    sunken: "#050805",
    border: "#263226",
    signal: "#C8FF46",
  });
}
