import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "./ThemeProvider";

export type IntelligenceTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

function toneColor(theme: ReturnType<typeof useTheme>["theme"], tone: IntelligenceTone): string {
  if (tone === "primary") return theme.colors.primary;
  if (tone === "success") return theme.colors.success;
  if (tone === "warning") return theme.colors.warning;
  if (tone === "danger") return theme.colors.danger;
  if (tone === "info") return theme.colors.info;
  return theme.colors.textMuted;
}

export function AuthorityRail({ detail, status, tone = "success", testID }: Readonly<{ detail: string; status: string; tone?: IntelligenceTone; testID?: string }>) {
  const { theme } = useTheme();
  const color = toneColor(theme, tone);
  return <View style={[styles.authorityRail, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} testID={testID}>
    <View style={styles.authorityBrandRow}>
      <View style={[styles.authorityDot, { borderColor: color }]} />
      <Text style={[styles.authorityBrand, { color: theme.colors.text }]}>NUSA</Text>
      <Text style={[styles.authorityMode, { color }]}>PAPER ONLY</Text>
    </View>
    <Text style={[styles.authorityDetail, { color: theme.colors.textMuted }]}>{detail}</Text>
    <View style={[styles.authorityStatus, { borderColor: color }]}><Text style={[styles.authorityStatusText, { color }]}>{status}</Text></View>
  </View>;
}

export function ScreenLead({ eyebrow, title, detail, badge, badgeTone = "neutral", testID }: Readonly<{ eyebrow: string; title: string; detail: string; badge?: string; badgeTone?: IntelligenceTone; testID?: string }>) {
  const { theme } = useTheme();
  const badgeColor = toneColor(theme, badgeTone);
  return <View style={styles.lead} testID={testID}>
    <View style={styles.leadTopRow}>
      <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>{eyebrow}</Text>
      {badge ? <View style={[styles.badge, { borderColor: badgeColor }]}><Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text></View> : null}
    </View>
    <Text style={[styles.leadTitle, { color: theme.colors.text }]}>{title}</Text>
    <Text style={[styles.leadDetail, { color: theme.colors.textMuted }]}>{detail}</Text>
  </View>;
}

export function MetricStrip({ items, testID }: Readonly<{ items: readonly { label: string; value: string; tone?: IntelligenceTone }[]; testID?: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.metricStrip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID={testID}>
    {items.map((item, index) => <View key={`${item.label}-${index}`} style={[styles.metricCell, index > 0 ? { borderLeftColor: theme.colors.border, borderLeftWidth: StyleSheet.hairlineWidth } : null]}>
      <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{item.label}</Text>
      <Text style={[styles.metricValue, { color: toneColor(theme, item.tone ?? "neutral") === theme.colors.textMuted ? theme.colors.text : toneColor(theme, item.tone ?? "neutral") }]} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
    </View>)}
  </View>;
}

export function IntelligenceSection({ title, kicker, actionLabel, onAction, children, tone = "neutral", testID, style }: Readonly<{ title: string; kicker?: string; actionLabel?: string; onAction?: () => void; children: React.ReactNode; tone?: IntelligenceTone; testID?: string; style?: ViewStyle }>) {
  const { theme } = useTheme();
  const accent = toneColor(theme, tone);
  return <View style={[styles.section, { borderColor: theme.colors.border }, style]} testID={testID}>
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleWrap}>
        {kicker ? <Text style={[styles.sectionKicker, { color: accent }]}>{kicker}</Text> : null}
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
      </View>
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.sectionAction, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceSunken, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.sectionActionText, { color: theme.colors.textMuted }]}>{actionLabel}</Text></Pressable> : null}
    </View>
    {children}
  </View>;
}

export function FactRow({ label, value, note, tone = "neutral", testID }: Readonly<{ label: string; value: string; note?: string; tone?: IntelligenceTone; testID?: string }>) {
  const { theme } = useTheme();
  const color = toneColor(theme, tone);
  return <View style={[styles.factRow, { borderTopColor: theme.colors.border }]} testID={testID}>
    <View style={styles.factCopy}>
      <Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      {note ? <Text style={[styles.factNote, { color: theme.colors.textMuted }]}>{note}</Text> : null}
    </View>
    <Text style={[styles.factValue, { color: tone === "neutral" ? theme.colors.text : color }]}>{value}</Text>
  </View>;
}

export function StateNotice({ title, detail, tone = "warning", testID }: Readonly<{ title: string; detail: string; tone?: IntelligenceTone; testID?: string }>) {
  const { theme } = useTheme();
  const color = toneColor(theme, tone);
  return <View style={[styles.notice, { borderColor: color, backgroundColor: theme.colors.surfaceSunken }]} testID={testID}>
    <Text style={[styles.noticeTitle, { color }]}>{title}</Text>
    <Text style={[styles.noticeDetail, { color: theme.colors.textMuted }]}>{detail}</Text>
  </View>;
}

const styles = StyleSheet.create({
  authorityRail: { minHeight: 60, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, gap: 5 },
  authorityBrandRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  authorityDot: { width: 13, height: 13, borderWidth: 2, borderRadius: 999 },
  authorityBrand: { fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: 1.8 },
  authorityMode: { fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.25 },
  authorityDetail: { fontSize: 11, lineHeight: 16, paddingRight: 98 },
  authorityStatus: { position: "absolute", right: 12, top: 12, minHeight: 32, borderWidth: 1, borderRadius: 999, justifyContent: "center", paddingHorizontal: 11 },
  authorityStatusText: { fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 0.75 },
  lead: { gap: 7 },
  leadTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.4 },
  leadTitle: { fontSize: 30, lineHeight: 36, fontWeight: "900", letterSpacing: -0.85 },
  leadDetail: { maxWidth: 720, fontSize: 13, lineHeight: 20 },
  badge: { minHeight: 28, borderRadius: 999, borderWidth: 1, justifyContent: "center", paddingHorizontal: 10 },
  badgeText: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7 },
  metricStrip: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  metricCell: { flex: 1, minWidth: 0, paddingHorizontal: 11, paddingVertical: 15, gap: 4 },
  metricLabel: { fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.55 },
  metricValue: { fontSize: 18, lineHeight: 23, fontWeight: "900", fontVariant: ["tabular-nums"] },
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, paddingHorizontal: 2, paddingTop: 18, paddingBottom: 6, gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  sectionTitleWrap: { flex: 1, gap: 3 },
  sectionKicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "800" },
  sectionAction: { minHeight: 48, minWidth: 84, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  sectionActionText: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
  factRow: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14 },
  factCopy: { flex: 1, minWidth: 0, gap: 2 },
  factLabel: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  factNote: { fontSize: 10, lineHeight: 14 },
  factValue: { maxWidth: "52%", textAlign: "right", fontSize: 13, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  notice: { borderWidth: 1, borderRadius: 12, padding: 13, gap: 4 },
  noticeTitle: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
  noticeDetail: { fontSize: 11, lineHeight: 17 },
});
