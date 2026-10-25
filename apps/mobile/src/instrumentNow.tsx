import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useWindowDimensions } from "react-native";
import { InstrumentHero, Reveal, useReducedMotion } from "./instrumentKit";
import { DotNumeral, GrainCard } from "./auraKit";
import { fitPitch } from "./dotMatrix";
import { splitHeroLines } from "./learningScreenModel";
import { DecisionField } from "./decisionField";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";
import { auraPalette, readableFont } from "./designSystem";

interface Props {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string | null;
  readonly dim: boolean;
  readonly decisionCount: number | null;
  /** Today's PAPER order count; each rise throws sparks off the core. */
  readonly orderCount: number | null;
  readonly stats: readonly { readonly label: string; readonly value: string; readonly tone: CalmTone }[];
}

/** "지금" instrument view for every state without the risk gate: hero line, the decision core, the decision odometer, ledger. Presentation only. */
export function InstrumentNow({ tone, headline, sub, dim, decisionCount, orderCount, stats }: Props) {
  const reduced = useReducedMotion();
  const live = !dim && decisionCount != null;
  return <View style={dim ? styles.dim : undefined} testID="now-hero">
    <InstrumentHero index="01 / 지금" lines={splitHeroLines(headline).map((text) => ({ text, color: calmToneColor(tone) }))} label={headline} />
    {sub ? <Reveal index={1} reducedMotion={reduced}><Text style={[instrumentSub, styles.sub]}>{sub}</Text></Reveal> : null}
    <DecisionField decisionCount={decisionCount} orderCount={orderCount} live={live} reducedMotion={reduced} />
    <Reveal index={2} reducedMotion={reduced}>
      <AuraCount label="판단 · 오늘" value={decisionCount == null ? "—" : Math.round(decisionCount).toLocaleString("en-US")} tone="NORMAL" hero live={live} />
    </Reveal>
    <View style={styles.pair}>
      {stats.filter((s) => s.label !== "판단").map((s, i) => <Reveal key={s.label} index={3 + i} reducedMotion={reduced} style={styles.pairCell}>
        <AuraCount label={s.label} value={s.value} tone={s.tone} />
      </Reveal>)}
    </View>
  </View>;
}

/** One count as an aura card: a chip label and the number in dot-matrix (plain text when the server has not sent it). The first card is the highlighted green one. */
function AuraCount({ label, value, tone, hero = false, live = false }: { readonly label: string; readonly value: string; readonly tone: CalmTone; readonly hero?: boolean; readonly live?: boolean }) {
  const { width } = useWindowDimensions();
  const inner = Math.max(120, (hero ? width - 32 : (width - 32 - 12) / 2) - 36);
  const pitch = fitPitch(value, inner, hero ? 9 : 6);
  const color = tone === "ORDER" ? auraPalette.neon : auraPalette.text;
  return <GrainCard tone={hero ? "GREEN" : "DARK"} style={hero ? styles.heroCard : styles.countCard} accessibilityLabel={`${label} ${value}`}>
    <View style={styles.chip}><Text style={styles.chipText}>{live ? `${label} · LIVE` : label}</Text></View>
    <DotNumeral text={value} pitch={pitch} color={color} glow={hero} accessibilityLabel={`${label} ${value}`} />
  </GrainCard>;
}

/** Account value as an aura card: the amount in dot-matrix and the change since the start in text. Presentation only. */
export function InstrumentEquity({ value, caption, tone, dim }: { readonly value: string; readonly caption: string | null; readonly tone: CalmTone; readonly dim: boolean }) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const digits = value.startsWith("\u20A9") ? value.slice(1) : value;
  const inner = Math.max(120, width - 32 - 36 - 24);
  const pitch = fitPitch(digits, inner, 6);
  // The dim sits on an outer View: Reveal animates opacity itself and would override it.
  return <View style={dim ? styles.dim : undefined}>
    <Reveal index={6} reducedMotion={reduced}>
      <GrainCard tone="DARK" style={styles.equityCard} accessibilityLabel={`평가금액 모의투자 ${value}${caption ? `. ${caption}` : ""}`}>
        <View style={styles.chip}><Text style={styles.chipText}>평가금액 · 모의투자</Text></View>
        <View style={styles.equityRow}>
          {value === digits ? null : <Text style={styles.won}>{"\u20A9"}</Text>}
          <DotNumeral text={digits} pitch={pitch} color={auraPalette.text} accessibilityLabel={value} />
        </View>
        {caption ? <Text style={[styles.equityCaption, { color: calmToneColor(tone) }]}>{caption}</Text> : null}
      </GrainCard>
    </Reveal>
  </View>;
}

const instrumentSub = { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21 } as const;

const styles = StyleSheet.create({
  dim: { opacity: 0.55 },
  sub: { paddingHorizontal: 20, marginTop: 10 },
  heroCard: { marginHorizontal: 16, marginTop: 14, gap: 14, padding: 18 },
  pair: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginTop: 12 },
  pairCell: { flex: 1 },
  countCard: { gap: 12, padding: 18 },
  equityCard: { marginHorizontal: 16, marginTop: 12, gap: 12, padding: 18 },
  equityRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  won: { color: auraPalette.muted, fontSize: readableFont(18), fontWeight: "500", paddingBottom: 2 },
  equityCaption: { fontSize: readableFont(12), lineHeight: 18 },
  chip: { alignSelf: "flex-start", backgroundColor: auraPalette.scrim, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  chipText: { color: auraPalette.text, fontSize: readableFont(12), fontWeight: "600" },
});
