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

/**
 * The tile form of a short group of rows (UI v7, the same tile as 기록): label on top, the value large in its tone, the hint below.
 * Two columns; an odd last tile takes the full width. Display only: it shows exactly the rows it is given.
 */
export function CalmTiles({ rows, testID }: Readonly<{ rows: readonly { label: string; hint?: string; value: string; tone?: CalmTone }[]; testID?: string }>) {
  return <View style={styles.tiles} testID={testID}>
    {rows.map((row, i) => <View key={`${i}-${row.label}`} style={[styles.tileCell, rows.length % 2 === 1 && i === rows.length - 1 && styles.tileFull]}>
      <View style={styles.tile} accessible accessibilityLabel={`${row.label}. ${row.value}.${row.hint ? ` ${row.hint}` : ""}`}>
        <Text style={styles.tileLabel}>{row.label}</Text>
        <Text style={[styles.tileValue, fieldFonts.monoMedium, { color: calmToneColor(row.tone ?? "NORMAL") }]}>{row.value}</Text>
        {row.hint ? <Text style={styles.tileHint}>{row.hint}</Text> : null}
      </View>
    </View>)}
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
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  // The equal-width rule sits on the cell (a plain View), the same way as the 기록 tiles.
  tileCell: { width: "48%", flexGrow: 1 },
  tileFull: { width: "100%" },
  tile: { minHeight: 96, padding: 14, gap: 4, justifyContent: "space-between", borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line, borderRadius: 16 },
  tileLabel: { color: calmColors.muted, fontSize: readableFont(12) },
  tileValue: { fontSize: readableFont(20), lineHeight: 28 },
  tileHint: { color: calmColors.muted, fontSize: readableFont(12), lineHeight: 17 },
  title: { color: calmColors.text, fontSize: 30, lineHeight: 38, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
});
