import type { DesignPresetName } from "./designSystem";

export type HomePrimarySection = "hero" | "nextAction" | "metrics" | "allocation";
export type HomeSecondarySection = "aiInsight" | "safety";
export type HomeDesktopLayout = "stacked" | "split";

export interface HomeScreenComposition {
  readonly primary: readonly HomePrimarySection[];
  readonly secondary: readonly HomeSecondarySection[];
  readonly desktopLayout: HomeDesktopLayout;
  readonly heroEmphasis: "balanced" | "dominant";
}

export interface ScreenCompositionManifest {
  readonly home: HomeScreenComposition;
}

const freezeHome = (home: HomeScreenComposition): HomeScreenComposition => Object.freeze({
  ...home,
  primary: Object.freeze([...home.primary]),
  secondary: Object.freeze([...home.secondary]),
});

export const screenCompositionPresets: Readonly<Record<DesignPresetName, ScreenCompositionManifest>> = Object.freeze({
  classic: Object.freeze({
    home: freezeHome({
      primary: ["hero", "nextAction", "metrics", "allocation"],
      secondary: ["aiInsight", "safety"],
      desktopLayout: "split",
      heroEmphasis: "balanced",
    }),
  }),
  master: Object.freeze({
    home: freezeHome({
      primary: ["hero", "allocation", "metrics", "nextAction"],
      secondary: ["safety", "aiInsight"],
      desktopLayout: "stacked",
      heroEmphasis: "dominant",
    }),
  }),
});

export function getScreenComposition(preset: DesignPresetName): ScreenCompositionManifest {
  return screenCompositionPresets[preset];
}
