import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusChip, type StatusTone } from "./components";
import { useTheme } from "./ThemeProvider";
import { metricTone } from "./uxLayout";

export function ScreenHeader({ eyebrow, title, description, statusLabel, statusTone = "neutral", actionLabel, onAction }: Readonly<{ eyebrow?: string; title: string; description?: string; statusLabel?: string; statusTone?: StatusTone; actionLabel?: string; onAction?: () => void }>) {
  const { theme } = useTheme();
  return <View style={styles.screenHeader}>
    <View style={styles.screenHeaderCopy}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>{eyebrow}</Text> : null}
      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      {description ? <Text style={[styles.description, { color: theme.colors.textMuted }]}>{description}</Text> : null}
    </View>
    {statusLabel || (actionLabel && onAction) ? <View style={styles.headerActions}>
      {statusLabel ? <StatusChip label={statusLabel} tone={statusTone} /> : null}
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.headerAction, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceSunken, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.headerActionLabel, { color: theme.colors.text }]}>{actionLabel}</Text></Pressable> : null}
    </View> : null}
  </View>;
}

export function MetricTile({ label, value, detail, tone = "default", testID }: Readonly<{ label: string; value: string; detail?: string; tone?: "default" | "primary" | "success" | "warning" | "danger" | "info"; testID?: string }>) {
  const { theme } = useTheme();
  const tokens = metricTone(theme, tone);
  return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ""}`} style={[styles.metric, { backgroundColor: tokens.background, borderColor: tokens.border }]} testID={testID}>
    <View style={[styles.metricAccent, { backgroundColor: tokens.accent }]} />
    <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    <Text style={[styles.metricValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {detail ? <Text style={[styles.metricDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
  </View>;
}

export function CompactMetric({ label, value, detail, tone = "default", testID }: Readonly<{ label: string; value: string; detail?: string; tone?: "default" | "success" | "warning" | "danger" | "info"; testID?: string }>) {
  const { theme } = useTheme();
  const valueColor = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "info" ? theme.colors.aiSignalEnd : theme.colors.text;
  return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ""}`} style={[styles.compactMetric, { borderBottomColor: theme.colors.border }]} testID={testID}>
    <View style={styles.compactMetricCopy}>
      <Text style={[styles.compactMetricLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      {detail ? <Text style={[styles.compactMetricDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
    </View>
    <Text style={[styles.compactMetricValue, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
  </View>;
}

export function QuietStatus({ label, tone = "neutral", testID }: Readonly<{ label: string; tone?: StatusTone; testID?: string }>) {
  const { theme } = useTheme();
  const accent = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "info" ? theme.colors.aiSignalEnd : theme.colors.textMuted;
  return <View accessible accessibilityLabel={label} style={styles.quietStatus} testID={testID}>
    <View style={[styles.quietStatusDot, { backgroundColor: accent }]} />
    <Text style={[styles.quietStatusLabel, { color: theme.colors.textMuted }]}>{label}</Text>
  </View>;
}

export function InsightPanel({ title, thesis, meta, confidenceLabel, actionLabel, onAction, testID }: Readonly<{ title: string; thesis: string; meta: string; confidenceLabel?: string; actionLabel?: string; onAction?: () => void; testID?: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.insightPanel, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID={testID}>
    <View style={styles.insightTopline}>
      <View style={styles.insightTitleGroup}>
        <Text style={[styles.insightEyebrow, { color: theme.colors.aiSignalMid }]}>AI JUDGEMENT</Text>
        <Text style={[styles.insightTitle, { color: theme.colors.text }]}>{title}</Text>
      </View>
      {confidenceLabel ? <Text style={[styles.insightConfidence, { color: theme.colors.aiSignalEnd }]}>{confidenceLabel}</Text> : null}
    </View>
    <Text style={[styles.insightThesis, { color: theme.colors.textMuted }]}>{thesis}</Text>
    <View style={styles.insightFooter}>
      <Text style={[styles.insightMeta, { color: theme.colors.textMuted }]}>{meta}</Text>
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.insightAction, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}><Text style={[styles.insightActionLabel, { color: theme.colors.text }]}>{actionLabel}</Text></Pressable> : null}
    </View>
  </View>;
}

export function SegmentedControl({ items, selectedKey, onChange, disabled = false, testID }: Readonly<{ items: readonly Readonly<{ key: string; label: string }>[]; selectedKey: string; onChange: (key: string) => void; disabled?: boolean; testID?: string }>) {
  const { theme } = useTheme();
  return <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID={testID}>
    {items.map((item) => {
      const selected = selectedKey === item.key;
      return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(item.key)} style={({ pressed }) => [styles.segment, { backgroundColor: selected ? theme.colors.surfaceRaised : "transparent", borderColor: selected ? theme.colors.borderStrong : "transparent", opacity: disabled ? theme.interaction.disabledOpacity : pressed ? theme.interaction.pressedOpacity : 1 }]}>
        <Text style={[styles.segmentLabel, { color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: selected ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function InlineNotice({ title, detail, tone = "info", testID }: Readonly<{ title: string; detail?: string; tone?: StatusTone; testID?: string }>) {
  const { theme } = useTheme();
  const accent = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : tone === "neutral" ? theme.colors.textMuted : theme.colors.info;
  return <View accessibilityRole="text" style={[styles.notice, { backgroundColor: theme.colors.surfaceSunken, borderColor: accent }]} testID={testID}>
    <View style={[styles.noticeDot, { backgroundColor: accent }]} />
    <View style={styles.noticeCopy}><Text style={[styles.noticeTitle, { color: theme.colors.text }]}>{title}</Text>{detail ? <Text style={[styles.noticeDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}</View>
  </View>;
}

export function OperationalNotice({ title, detail, tone = "info", actionLabel, onAction, testID, actionTestID }: Readonly<{ title: string; detail?: string; tone?: "success" | "warning" | "danger" | "info"; actionLabel?: string; onAction?: () => void; testID?: string; actionTestID?: string }>) {
  const { theme } = useTheme();
  const accent = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.info;
  return <View accessibilityRole="text" style={[styles.operationalNotice, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID={testID}>
    <View style={[styles.operationalNoticeDot, { backgroundColor: accent }]} />
    <View style={styles.operationalNoticeCopy}>
      <Text style={[styles.operationalNoticeTitle, { color: theme.colors.text }]}>{title}</Text>
      {detail ? <Text style={[styles.operationalNoticeDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
    </View>
    {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.operationalNoticeAction, { borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID={actionTestID}><Text style={[styles.operationalNoticeActionLabel, { color: theme.colors.text }]}>{actionLabel}</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  screenHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, paddingBottom: 4 },
  screenHeaderCopy: { flex: 1, gap: 5, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 2.1 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -1.35 },
  description: { maxWidth: 620, fontSize: 14, lineHeight: 21 },
  headerActions: { alignItems: "flex-end", gap: 8 },
  headerAction: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  headerActionLabel: { fontSize: 13, fontWeight: "700" },
  metric: { minHeight: 104, flex: 1, minWidth: 138, borderWidth: 1, borderRadius: 12, padding: 15, overflow: "hidden" },
  metricAccent: { position: "absolute", left: 14, right: 14, top: 0, height: 2, borderRadius: 2 },
  metricLabel: { fontSize: 10, lineHeight: 16, fontWeight: "800", letterSpacing: 1.1 },
  metricValue: { marginTop: 8, fontSize: 25, lineHeight: 30, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
  metricDetail: { marginTop: 5, fontSize: 12, lineHeight: 17 },
  compactMetric: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  compactMetricCopy: { flex: 1, minWidth: 0, gap: 2 },
  compactMetricLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700", letterSpacing: 0.1 },
  compactMetricDetail: { fontSize: 10, lineHeight: 15 },
  compactMetricValue: { minWidth: 0, maxWidth: "48%", flexShrink: 1, textAlign: "right", fontSize: 13, lineHeight: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  quietStatus: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 7 },
  quietStatusDot: { width: 6, height: 6, borderRadius: 3 },
  quietStatusLabel: { fontSize: 10, lineHeight: 15, fontWeight: "700", letterSpacing: 1.05 },
  insightPanel: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
  insightTopline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  insightTitleGroup: { flex: 1, minWidth: 0, gap: 5 },
  insightEyebrow: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.7 },
  insightTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700", letterSpacing: -0.35 },
  insightConfidence: { fontSize: 12, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  insightThesis: { fontSize: 14, lineHeight: 22 },
  insightFooter: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  insightMeta: { flex: 1, fontSize: 11, lineHeight: 16 },
  insightAction: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  insightActionLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  segmented: { flexDirection: "row", minHeight: 50, padding: 3, borderRadius: 999, borderWidth: 1, gap: 3 },
  segment: { flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  segmentLabel: { fontSize: 13 },
  notice: { minHeight: 56, flexDirection: "row", gap: 11, alignItems: "flex-start", borderWidth: 1, borderRadius: 12, padding: 13 },
  noticeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  noticeDetail: { fontSize: 12, lineHeight: 18 },
  operationalNotice: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  operationalNoticeDot: { width: 7, height: 7, borderRadius: 4 },
  operationalNoticeCopy: { flex: 1, minWidth: 0, gap: 2 },
  operationalNoticeTitle: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  operationalNoticeDetail: { fontSize: 11, lineHeight: 16 },
  operationalNoticeAction: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  operationalNoticeActionLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
