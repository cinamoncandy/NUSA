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
  field: Object.freeze({
    screen: Object.freeze({ horizontalPadding: 20, topPadding: 12, sectionGap: 16, bottomPadding: 28, maxWidth: 780 }),
    dashboard: Object.freeze({ gap: 16, tabletGap: 22, secondaryPaddingLeft: 18 }),
    hero: Object.freeze({ minHeight: 228, horizontalPadding: 16, topPadding: 16, bottomPadding: 0, radius: 6, borderWidth: 0, balanceSize: 40, balanceLineHeight: 46, balanceLetterSpacing: -1.2, tabletBalanceSize: 50, tabletBalanceLineHeight: 56 }),
    type: Object.freeze({ kicker: 9, sectionTitle: 18, sectionTitleLineHeight: 22, body: 12, bodyLineHeight: 18, meta: 11, thesis: 18, thesisLineHeight: 26, value: 18, valueLineHeight: 24 }),
    density: Object.freeze({ contentGap: 14, metricGap: 6, sectionGap: 12, compactPadding: 2, railHeight: 2 }),
  }),
});

export function getHomeVisualProfile(preset: DesignPresetName): HomeVisualProfile {
  return profiles[preset];
}
