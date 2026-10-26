import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { splitHeroLines } from "./learningScreenModel";
import { InstrumentHero, Odometer, Reveal, SectionLabel, useReducedMotion } from "./instrumentKit";
import { AuroraCore } from "./auroraCore";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";
import { fieldFonts } from "./fieldFonts";
import { readableFont } from "./designSystem";

interface Props {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string | null;
  readonly dim: boolean;
  readonly decisionCount: number | null;
  /** Today's PAPER order count; each rise throws sparks off the core. */
  readonly orderCount: number | null;
  readonly stats: readonly { readonly label: string; readonly value: string; readonly tone: CalmTone }[];
  /** Server-reported time of its last heartbeat (ms). The scan line sweeps when this advances. */
  readonly lastHeartbeatAt?: number | null;
}

/** "지금" instrument view for every state without the risk gate: hero line, the decision core, the decision odometer, ledger. Presentation only. */
export function InstrumentNow({ tone, headline, sub, dim, decisionCount, orderCount, stats, lastHeartbeatAt = null }: Props) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const live = !dim && decisionCount != null;
  return <View style={dim ? styles.dim : undefined} testID="now-hero">
    <InstrumentHero index="01 / 지금" lines={splitHeroLines(headline).map((text) => ({ text, color: calmToneColor(tone) }))} label={headline} />
    {sub ? <Reveal index={1} reducedMotion={reduced}><Text style={[instrumentSub, styles.sub]}>{sub}</Text></Reveal> : null}
    <View style={styles.panelWrap} onLayout={(e) => setWidth(Math.max(0, Math.round(e.nativeEvent.layout.width) - 40))}>
      {width > 0 ? <AuroraCore tone={live ? "live" : "idle"} decisionCount={live ? decisionCount : null} orderCount={live ? orderCount : null} lastHeartbeatAt={live ? lastHeartbeatAt : null} width={width} reducedMotion={reduced} /> : null}
    </View>
    <Reveal index={2} reducedMotion={reduced} style={styles.countWrap}>
      <SectionLabel left="판단 · 오늘" right={live ? "LIVE" : "—"} live={live} />
      {decisionCount == null ? <Text style={[fieldFonts.mono, styles.empty]}>—</Text> : <Odometer value={decisionCount} size={44} reducedMotion={reduced} />}
    </Reveal>
    <View style={styles.ledger}>
      {stats.filter((s) => s.label !== "판단").map((s, i) => <Reveal key={s.label} index={3 + i} reducedMotion={reduced} style={styles.row}>
        <Text style={styles.rowLabel}>{s.label}</Text>
        <Text style={[fieldFonts.mono, styles.rowValue, { color: calmToneColor(s.tone) }]}>{s.value}</Text>
      </Reveal>)}
    </View>
  </View>;
}

/** Account value in the instrument language: a section label, the amount in the mono display face, and the change since the start. */
export function InstrumentEquity({ value, caption, tone, dim }: { readonly value: string; readonly caption: string | null; readonly tone: CalmTone; readonly dim: boolean }) {
  const reduced = useReducedMotion();
  // The dim sits on an outer View: Reveal animates opacity itself and would override it.
  return <View style={dim ? styles.dim : undefined}>
    <Reveal index={6} reducedMotion={reduced} style={styles.equity}>
      <SectionLabel left="평가금액" right="모의투자" />
      <Text style={[fieldFonts.displayStrong, styles.equityValue]} accessibilityRole="header">{value}</Text>
      {caption ? <Text style={[styles.equityCaption, { color: calmToneColor(tone) }]}>{caption}</Text> : null}
    </Reveal>
  </View>;
}

const instrumentSub = { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21 } as const;

const styles = StyleSheet.create({
  dim: { opacity: 0.55 },
  sub: { paddingHorizontal: 20, marginTop: 10 },
  panelWrap: { paddingHorizontal: 20, marginTop: 18 },
  equity: { paddingHorizontal: 20, marginTop: 22 },
  equityValue: { color: calmColors.text, fontSize: 34, lineHeight: 40, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  equityCaption: { fontSize: readableFont(12), marginTop: 4, letterSpacing: 0.4 },
  countWrap: { paddingHorizontal: 20, marginTop: 14 },
  empty: { color: calmColors.muted, fontSize: 44 },
  ledger: { paddingHorizontal: 20, marginTop: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  rowLabel: { color: calmColors.muted, fontSize: readableFont(13), fontWeight: "500" },
  rowValue: { fontSize: readableFont(14) },
});
