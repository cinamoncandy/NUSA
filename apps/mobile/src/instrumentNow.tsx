import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Heartbeat, InstrumentHero, Odometer, Panel, SectionLabel, useReducedMotion } from "./instrumentKit";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

interface Props {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string | null;
  readonly dim: boolean;
  readonly decisionCount: number | null;
  readonly stats: readonly { readonly label: string; readonly value: string; readonly tone: CalmTone }[];
}

/** "지금" instrument view for every state without the risk gate: hero line, decision odometer + heartbeat, ledger. Presentation only. */
export function InstrumentNow({ tone, headline, sub, dim, decisionCount, stats }: Props) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const live = !dim && decisionCount != null;
  return <View style={dim ? styles.dim : undefined} testID="now-hero">
    <InstrumentHero index="01 / 지금" lines={[{ text: headline, color: calmToneColor(tone) }]} />
    {sub ? <Text style={[instrumentSub, styles.sub]}>{sub}</Text> : null}
    <View style={styles.panelWrap}>
      <Panel>
        <SectionLabel left="판단" right={live ? "LIVE" : "—"} />
        {decisionCount == null ? <Text style={[fieldFonts.mono, styles.empty]}>—</Text> : <Odometer value={decisionCount} size={44} reducedMotion={reduced} />}
        <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {live ? <Heartbeat width={width} reducedMotion={reduced} /> : <View style={styles.flat} />}
        </View>
      </Panel>
    </View>
    <View style={styles.ledger}>
      {stats.map((s) => <View key={s.label} style={styles.row}>
        <Text style={[fieldFonts.mono, styles.rowLabel]}>{s.label}</Text>
        <Text style={[fieldFonts.mono, styles.rowValue, { color: calmToneColor(s.tone) }]}>{s.value}</Text>
      </View>)}
    </View>
  </View>;
}

const instrumentSub = { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21 } as const;

const styles = StyleSheet.create({
  dim: { opacity: 0.55 },
  sub: { paddingHorizontal: 20, marginTop: 10 },
  panelWrap: { paddingHorizontal: 20, marginTop: 22 },
  empty: { color: calmColors.muted, fontSize: 44 },
  flat: { height: 44, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line },
  ledger: { paddingHorizontal: 20, marginTop: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  rowLabel: { color: calmColors.muted, fontSize: readableFont(12), letterSpacing: 1 },
  rowValue: { fontSize: readableFont(14) },
});
