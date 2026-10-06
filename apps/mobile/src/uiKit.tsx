import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fieldFonts } from "./fieldFonts";
import { labelFont, readableFont } from "./designSystem";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";

/** One status sentence with a single dot. Replaces banners, chips and status cards. */
export function CalmHeadline({ tone, text, sub }: Readonly<{ tone: CalmTone; text: string; sub?: string }>) {
  return <View style={styles.headline}>
    <View style={styles.headRow}>
      <View style={[styles.dot, { backgroundColor: calmToneColor(tone) }]} />
      <Text accessibilityRole="header" style={[styles.headText, fieldFonts.display]}>{text}</Text>
    </View>
    {sub ? <Text style={styles.sub}>{sub}</Text> : null}
  </View>;
}

export function CalmBigNumber({ value, caption, captionTone = "MUTED", dim = false }: Readonly<{ value: string; caption?: string; captionTone?: CalmTone; dim?: boolean }>) {
  return <View style={dim ? styles.dim : undefined}>
    <Text style={[styles.big, fieldFonts.monoMedium]}>{value}</Text>
    {caption ? <Text style={[styles.caption, { color: calmToneColor(captionTone) }]}>{caption}</Text> : null}
  </View>;
}

/** Hairline-separated stats; no boxes. */
export function CalmStats({ items }: Readonly<{ items: readonly { label: string; value: string; tone?: CalmTone }[] }>) {
  return <View style={styles.stats}>
    {items.map((item, index) => <View key={item.label} style={[styles.stat, index > 0 && styles.statDivider]}>
      <Text style={[styles.statValue, fieldFonts.monoMedium, { color: calmToneColor(item.tone ?? "NORMAL") }]}>{item.value}</Text>
      <Text style={styles.statLabel}>{item.label}</Text>
    </View>)}
  </View>;
}

/** Label on the left, value on the right, a hairline above. */
export function CalmRow({ label, hint, value, tone = "NORMAL" }: Readonly<{ label: string; hint?: string; value: string; tone?: CalmTone }>) {
  return <View style={styles.row}>
    <View style={styles.rowLeft}>
      <Text style={styles.rowLabel}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
    </View>
    <Text style={[styles.rowValue, { color: calmToneColor(tone) }]}>{value}</Text>
  </View>;
}

export function CalmTitle({ text }: Readonly<{ text: string }>) {
  return <Text accessibilityRole="header" style={[styles.title, fieldFonts.display]}>{text}</Text>;
}

const styles = StyleSheet.create({
  headline: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headText: { color: calmColors.text, fontSize: 24, lineHeight: 32 },
  sub: { color: calmColors.muted, fontSize: readableFont(13), lineHeight: 19 },
  big: { color: calmColors.text, fontSize: 40, lineHeight: 46 },
  caption: { fontSize: readableFont(14), marginTop: 2 },
  dim: { opacity: 0.55 },
  stats: { flexDirection: "row", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  stat: { flex: 1, paddingHorizontal: 12, gap: 2 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: calmColors.line },
  statValue: { fontSize: 24, lineHeight: 30 },
  statLabel: { color: calmColors.muted, fontSize: labelFont(12) },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line, minHeight: 56 },
  rowLeft: { flex: 1, gap: 2 },
  rowLabel: { color: calmColors.text, fontSize: readableFont(15) },
  rowHint: { color: calmColors.muted, fontSize: readableFont(12), lineHeight: 17 },
  rowValue: { fontSize: readableFont(14), fontWeight: "600", textAlign: "right", flexShrink: 1 },
  title: { color: calmColors.text, fontSize: 30, lineHeight: 38, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
});
