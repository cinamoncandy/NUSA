import type { DesignPresetName } from "./designSystem";

export interface HomeVisualProfile {
  readonly screen: Readonly<{
    horizontalPadding: number;
    topPadding: number;
    sectionGap: number;
    bottomPadding: number;
    maxWidth: number;
  }>;
  readonly dashboard: Readonly<{
    gap: number;
    tabletGap: number;
    secondaryPaddingLeft: number;
  }>;
  readonly hero: Readonly<{
    minHeight: number;
    horizontalPadding: number;
    topPadding: number;
    bottomPadding: number;
    radius: number;
    borderWidth: number;
    balanceSize: number;
    balanceLineHeight: number;
    balanceLetterSpacing: number;
    tabletBalanceSize: number;
    tabletBalanceLineHeight: number;
  }>;
  readonly type: Readonly<{
    kicker: number;
    sectionTitle: number;
    sectionTitleLineHeight: number;
    body: number;
    bodyLineHeight: number;
    meta: number;
    thesis: number;
    thesisLineHeight: number;
    value: number;
    valueLineHeight: number;
  }>;
  readonly density: Readonly<{
    contentGap: number;
    metricGap: number;
    sectionGap: number;
    compactPadding: number;
    railHeight: number;
  }>;
}

const profiles: Readonly<Record<DesignPresetName, HomeVisualProfile>> = Object.freeze({
  classic: Object.freeze({
    screen: Object.freeze({ horizontalPadding: 20, topPadding: 18, sectionGap: 22, bottomPadding: 44, maxWidth: 920 }),
    dashboard: Object.freeze({ gap: 22, tabletGap: 32, secondaryPaddingLeft: 28 }),
    hero: Object.freeze({ minHeight: 300, horizontalPadding: 20, topPadding: 20, bottomPadding: 6, radius: 22, borderWidth: 1, balanceSize: 52, balanceLineHeight: 59, balanceLetterSpacing: -2.5, tabletBalanceSize: 62, tabletBalanceLineHeight: 69 }),
    type: Object.freeze({ kicker: 10, sectionTitle: 20, sectionTitleLineHeight: 26, body: 13, bodyLineHeight: 20, meta: 12, thesis: 21, thesisLineHeight: 31, value: 20, valueLineHeight: 27 }),
    density: Object.freeze({ contentGap: 22, metricGap: 10, sectionGap: 14, compactPadding: 4, railHeight: 6 }),
  }),
  master: Object.freeze({
    screen: Object.freeze({ horizontalPadding: 14, topPadding: 12, sectionGap: 12, bottomPadding: 28, maxWidth: 780 }),
    dashboard: Object.freeze({ gap: 12, tabletGap: 18, secondaryPaddingLeft: 18 }),
    hero: Object.freeze({ minHeight: 228, horizontalPadding: 16, topPadding: 16, bottomPadding: 0, radius: 6, borderWidth: 0, balanceSize: 44, balanceLineHeight: 48, balanceLetterSpacing: -2.1, tabletBalanceSize: 54, tabletBalanceLineHeight: 58 }),
    type: Object.freeze({ kicker: 9, sectionTitle: 18, sectionTitleLineHeight: 22, body: 12, bodyLineHeight: 18, meta: 11, thesis: 18, thesisLineHeight: 26, value: 18, valueLineHeight: 24 }),
    density: Object.freeze({ contentGap: 12, metricGap: 6, sectionGap: 10, compactPadding: 2, railHeight: 4 }),
  }),
});

export function getHomeVisualProfile(preset: DesignPresetName): HomeVisualProfile {
  return profiles[preset];
}

/** Canonical HOME content spacing derived from the profile instead of hardcoded values. */
export function homeContentStyle(profile: HomeVisualProfile): Readonly<{
  paddingHorizontal: number;
  paddingTop: number;
  paddingBottom: number;
  gap: number;
  maxWidth: number;
}> {
  return Object.freeze({
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    paddingBottom: profile.screen.bottomPadding,
    gap: profile.screen.sectionGap,
    maxWidth: profile.screen.maxWidth,
  });
}
