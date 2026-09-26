import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MoreDestination } from "./navigationContract";
import { ScreenFrame } from "./screenFrame";
import { useTheme } from "./ThemeProvider";
import { visualSystem } from "./visualSystem";

const LABELS: Readonly<Record<MoreDestination, string>> = Object.freeze({
  Strategies: "Strategies",
  Portfolio: "Portfolio",
  Risk: "Risk",
  Performance: "Performance",
  PaperEvidence: "PAPER Evidence",
  OrderHistory: "Order History",
  SystemStatus: "System Status",
  Notifications: "Notifications",
  Settings: "Settings",
  Help: "Help / About",
});

const GROUPS: ReadonlyArray<Readonly<{ title: string; detail: string; items: readonly MoreDestination[] }>> = Object.freeze([
  Object.freeze({ title: "INTELLIGENCE", detail: "전략 · 성과 · 근거", items: Object.freeze(["Strategies", "Performance", "PaperEvidence"] as const) }),
  Object.freeze({ title: "CAPITAL", detail: "자본 · 위험 · 기록", items: Object.freeze(["Portfolio", "Risk", "OrderHistory"] as const) }),
  Object.freeze({ title: "SYSTEM", detail: "상태 · 알림 · 설정", items: Object.freeze(["SystemStatus", "Notifications", "Settings", "Help"] as const) }),
]);

export function MoreMenuView({ onOpen }: Readonly<{ onOpen: (destination: MoreDestination) => void }>) {
  const { theme } = useTheme();
  const ui = visualSystem(theme);
  return <ScreenFrame testID="more-view">
    <View style={styles.lead}>
      <Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>NUSA INDEX</Text>
      <Text style={[styles.title, { color: ui.color.text }]}>MORE</Text>
      <Text style={[styles.detail, { color: ui.color.textMuted }]}>운용 지능을 더 깊게 탐색합니다.</Text>
    </View>

    <View style={[styles.architectureField, { borderColor: ui.color.border }]}>
      <View style={[styles.architecturePlaneA, { backgroundColor: theme.colors.aiSignalStart }]} />
      <View style={[styles.architecturePlaneB, { backgroundColor: theme.colors.aiSignalMid }]} />
      <View style={[styles.architectureLine, { backgroundColor: theme.colors.aiSignalEnd }]} />
      <Text style={[styles.architectureCaption, { color: ui.color.textMuted }]}>INTELLIGENCE → CAPITAL → SYSTEM</Text>
    </View>

    {GROUPS.map((group) => <View key={group.title} style={[styles.group, { borderTopColor: ui.color.border }]}>
      <View style={styles.groupLead}>
        <Text style={[styles.groupTitle, { color: ui.color.text }]}>{group.title}</Text>
        <Text style={[styles.groupDetail, { color: ui.color.textMuted }]}>{group.detail}</Text>
      </View>
      <View style={styles.groupItems}>
        {group.items.map((destination, index) => <Pressable
          accessibilityRole="button"
          key={destination}
          onPress={() => onOpen(destination)}
          style={({ pressed }) => [styles.item, {
            borderTopColor: index === 0 ? "transparent" : ui.color.border,
            opacity: pressed ? 0.62 : 1,
          }]}
          testID={`more-${destination}`}
        >
          <Text style={[styles.itemIndex, { color: theme.colors.aiSignalMid }]}>{String(index + 1).padStart(2, "0")}</Text>
          <Text style={[styles.itemLabel, { color: ui.color.text }]}>{LABELS[destination]}</Text>
          <Text style={[styles.itemArrow, { color: ui.color.textMuted }]}>↗</Text>
        </Pressable>)}
      </View>
    </View>)}

    <Text style={[styles.safety, { color: ui.color.textMuted }]}>PAPER_ONLY · LIVE AUTHORITY NONE · AI ZERO AUTHORITY</Text>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  lead: { paddingTop: 8, paddingBottom: 6, gap: 4 },
  kicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.5 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: 1.2 },
  detail: { fontSize: 12, lineHeight: 18 },
  architectureField: { height: 124, overflow: "hidden", position: "relative", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  architecturePlaneA: { position: "absolute", width: "86%", height: 30, left: "-14%", top: 30, borderRadius: 20, opacity: 0.18, transform: [{ rotate: "-6deg" }] },
  architecturePlaneB: { position: "absolute", width: "82%", height: 18, right: "-18%", top: 61, borderRadius: 14, opacity: 0.22, transform: [{ rotate: "4deg" }] },
  architectureLine: { position: "absolute", left: "12%", right: "8%", top: 67, height: 1.5, opacity: 0.72, transform: [{ rotate: "-2deg" }] },
  architectureCaption: { position: "absolute", left: 0, bottom: 10, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.05 },
  group: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 12 },
  groupLead: { gap: 3 },
  groupTitle: { fontSize: 21, lineHeight: 26, fontWeight: "800", letterSpacing: 0.2 },
  groupDetail: { fontSize: 10, lineHeight: 15 },
  groupItems: { paddingLeft: 18 },
  item: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  itemIndex: { width: 24, fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.8 },
  itemLabel: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  itemArrow: { fontSize: 16, lineHeight: 20 },
  safety: { paddingTop: 4, fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 0.75 },
});
