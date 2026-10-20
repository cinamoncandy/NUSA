import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { InstrumentHero, Odometer, Reveal, SectionLabel, useReducedMotion } from "./instrumentKit";
import { DecisionTerrain } from "./decisionTerrain";
import type { DecisionTerrainModel } from "./decisionTerrainModel";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

interface Props {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string | null;
  readonly dim: boolean;
  readonly decisionCount: number | null;
  readonly terrain: DecisionTerrainModel;
  readonly stats: readonly { readonly label: string; readonly value: string; readonly tone: CalmTone }[];
}

/** "지금" instrument view for every state without the risk gate: hero line, the decision terrain, the decision odometer, ledger. Presentation only. */
export function InstrumentNow({ tone, headline, sub, dim, decisionCount, terrain, stats }: Props) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const live = !dim && decisionCount != null;
  return <View style={dim ? styles.dim : undefined} testID="now-hero">
    <InstrumentHero index="01 / 지금" lines={[{ text: headline, color: calmToneColor(tone) }]} />
    {sub ? <Reveal index={1} reducedMotion={reduced}><Text style={[instrumentSub, styles.sub]}>{sub}</Text></Reveal> : null}
    <View style={styles.panelWrap} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width) - 40)}>
      {width > 0 ? <DecisionTerrain model={terrain} tone={live ? "live" : "idle"} decisionCount={live ? decisionCount : null} width={width} reducedMotion={reduced} /> : null}
    </View>
    <Reveal index={2} reducedMotion={reduced} style={styles.countWrap}>
      <SectionLabel left="판단 · 오늘" right={live ? "LIVE" : "—"} />
      {decisionCount == null ? <Text style={[fieldFonts.mono, styles.empty]}>—</Text> : <Odometer value={decisionCount} size={44} reducedMotion={reduced} />}
    </Reveal>
    <View style={styles.ledger}>
      {stats.map((s, i) => <Reveal key={s.label} index={3 + i} reducedMotion={reduced} style={styles.row}>
        <Text style={[fieldFonts.mono, styles.rowLabel]}>{s.label}</Text>
        <Text style={[fieldFonts.mono, styles.rowValue, { color: calmToneColor(s.tone) }]}>{s.value}</Text>
      </Reveal>)}
    </View>
  </View>;
}

const instrumentSub = { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21 } as const;

const styles = StyleSheet.create({
  dim: { opacity: 0.55 },
  sub: { paddingHorizontal: 20, marginTop: 10 },
  panelWrap: { paddingHorizontal: 20, marginTop: 18 },
  countWrap: { paddingHorizontal: 20, marginTop: 14 },
  empty: { color: calmColors.muted, fontSize: 44 },
  ledger: { paddingHorizontal: 20, marginTop: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  rowLabel: { color: calmColors.muted, fontSize: readableFont(12), letterSpacing: 1 },
  rowValue: { fontSize: readableFont(14) },
});
