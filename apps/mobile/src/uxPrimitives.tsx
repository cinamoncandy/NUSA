import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusChip, type StatusTone } from "./components";
import { useTheme } from "./ThemeProvider";
import { metricTone } from "./uxLayout";

export function ScreenHeader({ eyebrow, title, description, statusLabel, statusTone = "neutral", actionLabel, onAction }: Readonly<{ eyebrow?: string; title: string; description?: string; statusLabel?: string; statusTone?: StatusTone; actionLabel?: string; onAction?: () => void }>) {
  const { theme } = useTheme();
  return <View style={[styles.screenHeader, { gap: theme.spacing.lg, paddingBottom: theme.spacing.xs }]}>
    <View style={styles.screenHeaderCopy}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>{eyebrow}</Text> : null}
      <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.typography.heading, lineHeight: Math.round(theme.typography.heading * 1.2) }]}>{title}</Text>
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
  return <View accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ""}`} style={[styles.metric, { backgroundColor: tokens.background, borderColor: tokens.border, borderRadius: theme.radii.md, padding: theme.spacing.lg }]} testID={testID}>
    <View style={[styles.metricAccent, { backgroundColor: tokens.accent, left: theme.spacing.md, right: theme.spacing.md }]} />
    <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    <Text style={[styles.metricValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {detail ? <Text style={[styles.metricDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
  </View>;
}

export function SegmentedControl({ items, selectedKey, onChange, disabled = false, testID }: Readonly<{ items: readonly Readonly<{ key: string; label: string }>[]; selectedKey: string; onChange: (key: string) => void; disabled?: boolean; testID?: string }>) {
  const { theme } = useTheme();
  return <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border, minHeight: theme.interaction.controlHeight + theme.spacing.xs, padding: theme.spacing.xs, gap: theme.spacing.xs }]} testID={testID}>
    {items.map((item) => {
      const selected = selectedKey === item.key;
      return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(item.key)} style={({ pressed }) => [styles.segment, { backgroundColor: selected ? theme.colors.surfaceRaised : "transparent", borderColor: selected ? theme.colors.borderStrong : "transparent", minHeight: theme.interaction.touchTarget - theme.spacing.xs, paddingHorizontal: theme.spacing.md, opacity: disabled ? theme.interaction.disabledOpacity : pressed ? theme.interaction.pressedOpacity : 1 }]}>
        <Text style={[styles.segmentLabel, { color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: selected ? theme.typography.weights.bold : theme.typography.weights.semibold }]}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function InlineNotice({ title, detail, tone = "info", testID }: Readonly<{ title: string; detail?: string; tone?: "success" | "warning" | "danger" | "info"; testID?: string }>) {
  const { theme } = useTheme();
  const accent = tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.info;
  return <View accessibilityRole="text" style={[styles.notice, { backgroundColor: theme.colors.surfaceSunken, borderColor: accent, borderRadius: theme.radii.md, padding: theme.spacing.md, gap: theme.spacing.sm + 3 }]} testID={testID}>
    <View style={[styles.noticeDot, { backgroundColor: accent }]} />
    <View style={styles.noticeCopy}><Text style={[styles.noticeTitle, { color: theme.colors.text }]}>{title}</Text>{detail ? <Text style={[styles.noticeDetail, { color: theme.colors.textMuted }]}>{detail}</Text> : null}</View>
  </View>;
}

const styles = StyleSheet.create({
  screenHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, paddingBottom: 4 },
  screenHeaderCopy: { flex: 1, gap: 5, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 2.1 },
  title: { fontWeight: "800", letterSpacing: -1.35 },
  description: { maxWidth: 620, fontSize: 14, lineHeight: 21 },
  headerActions: { alignItems: "flex-end", gap: 8 },
  headerAction: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  headerActionLabel: { fontSize: 13, fontWeight: "700" },
  metric: { minHeight: 104, flex: 1, minWidth: 138, borderWidth: 1, overflow: "hidden" },
  /* metricAccent: { position: "absolute", left: 14, right: 14 } remains a token-driven accent. */
  metricAccent: { position: "absolute", top: 0, height: 2, borderRadius: 2 },
  metricLabel: { fontSize: 10, lineHeight: 16, fontWeight: "800", letterSpacing: 1.1 },
  metricValue: { marginTop: 8, fontSize: 25, lineHeight: 30, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
  metricDetail: { marginTop: 5, fontSize: 12, lineHeight: 17 },
  /* segmented: { borderRadius: 999, borderWidth: 1, gap: 3 } is supplied by theme spacing. */
  segmented: { flexDirection: "row", borderRadius: 999, borderWidth: 1 },
  /* segment: { flex: 1, minHeight: 44 } and segment: { flex: 1, minHeight: 48 } are supplied from theme.interaction.touchTarget. */
  segment: { flex: 1, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  segmentLabel: { fontSize: 13 },
  notice: { minHeight: 56, flexDirection: "row", alignItems: "flex-start", borderWidth: 1 },
  noticeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  noticeDetail: { fontSize: 12, lineHeight: 18 },
});
