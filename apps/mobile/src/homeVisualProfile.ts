import type { DesignPresetName } from "./designSystem";

export interface HomeVisualProfile {
  readonly screen: Readonly<{ horizontalPadding:number; topPadding:number; sectionGap:number; bottomPadding:number; maxWidth:number }>;
  readonly dashboard: Readonly<{ gap:number; tabletGap:number; secondaryPaddingLeft:number }>;
  readonly hero: Readonly<{ minHeight:number; horizontalPadding:number; topPadding:number; bottomPadding:number; radius:number; borderWidth:number; balanceSize:number; balanceLineHeight:number; balanceLetterSpacing:number; tabletBalanceSize:number; tabletBalanceLineHeight:number }>;
  readonly type: Readonly<{ kicker:number; sectionTitle:number; sectionTitleLineHeight:number; body:number; bodyLineHeight:number; meta:number; thesis:number; thesisLineHeight:number; value:number; valueLineHeight:number }>;
  readonly density: Readonly<{ contentGap:number; metricGap:number; sectionGap:number; compactPadding:number; railHeight:number }>;
}

const profiles: Readonly<Record<DesignPresetName, HomeVisualProfile>> = Object.freeze({
  classic: Object.freeze({
    screen: Object.freeze({ horizontalPadding:20, topPadding:18, sectionGap:22, bottomPadding:44, maxWidth:920 }),
    dashboard: Object.freeze({ gap:22, tabletGap:32, secondaryPaddingLeft:28 }),
    hero: Object.freeze({ minHeight:300, horizontalPadding:20, topPadding:20, bottomPadding:6, radius:22, borderWidth:1, balanceSize:52, balanceLineHeight:59, balanceLetterSpacing:-2.5, tabletBalanceSize:62, tabletBalanceLineHeight:69 }),
    type: Object.freeze({ kicker:10, sectionTitle:20, sectionTitleLineHeight:26, body:13, bodyLineHeight:20, meta:12, thesis:21, thesisLineHeight:31, value:20, valueLineHeight:27 }),
    density: Object.freeze({ contentGap:22, metricGap:10, sectionGap:14, compactPadding:4, railHeight:6 }),
  }),
  master: Object.freeze({
    screen: Object.freeze({ horizontalPadding:18, topPadding:16, sectionGap:18, bottomPadding:40, maxWidth:820 }),
    dashboard: Object.freeze({ gap:18, tabletGap:24, secondaryPaddingLeft:20 }),
    hero: Object.freeze({ minHeight:250, horizontalPadding:20, topPadding:20, bottomPadding:16, radius:20, borderWidth:1, balanceSize:46, balanceLineHeight:50, balanceLetterSpacing:-2.2, tabletBalanceSize:58, tabletBalanceLineHeight:62 }),
    type: Object.freeze({ kicker:10, sectionTitle:20, sectionTitleLineHeight:26, body:13, bodyLineHeight:20, meta:11, thesis:20, thesisLineHeight:28, value:19, valueLineHeight:25 }),
    density: Object.freeze({ contentGap:18, metricGap:8, sectionGap:14, compactPadding:4, railHeight:5 }),
  }),
});

export function getHomeVisualProfile(preset: DesignPresetName): HomeVisualProfile { return profiles[preset]; }
