import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MORE_DESTINATIONS, type MoreDestination } from "./navigationContract";
import { fieldPalette } from "./designSystem";

/** Field-style index: numbered rows on thin lines, no cards. */
const LABELS: Readonly<Record<MoreDestination, { readonly title: string; readonly hint: string }>> = Object.freeze({
  Strategies: { title: "전략", hint: "Strategies" },
  Portfolio: { title: "포트폴리오", hint: "Portfolio" },
  Risk: { title: "위험", hint: "Risk" },
  Performance: { title: "성과", hint: "Performance" },
  PaperEvidence: { title: "PAPER 증거", hint: "PAPER Evidence" },
  OrderHistory: { title: "주문 이력", hint: "Order History" },
  SystemStatus: { title: "시스템 상태", hint: "System Status" },
  Notifications: { title: "알림", hint: "Notifications" },
  Settings: { title: "설정", hint: "Settings" },
  Help: { title: "도움말", hint: "Help" },
});

export function MoreMenuView({ onOpen }: Readonly<{ onOpen: (destination: MoreDestination) => void }>) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="more-view">
    <Text style={styles.eyebrow}>MORE</Text>
    <Text style={styles.title}>도구와 기록</Text>
    <View style={styles.list}>
      {MORE_DESTINATIONS.map((destination, index) => <Pressable
        accessibilityRole="button"
        accessibilityLabel={LABELS[destination].title}
        key={destination}
        onPress={() => onOpen(destination)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
        testID={`more-${destination}`}
      >
        <Text style={styles.index}>{String(index + 1).padStart(2, "0")}</Text>
        <Text style={styles.rowTitle}>{LABELS[destination].title}</Text>
        <Text style={styles.hint}>{LABELS[destination].hint}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.footer}>PAPER_ONLY · LIVE AUTHORITY NONE · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fieldPalette.void },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 120 },
  eyebrow: { color: fieldPalette.muted, fontSize: 11, letterSpacing: 2.4, fontWeight: "600" },
  title: { color: fieldPalette.text, fontSize: 28, lineHeight: 36, fontWeight: "300", marginTop: 6, marginBottom: 18 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim },
  index: { color: fieldPalette.dim, fontSize: 12, width: 24, fontVariant: ["tabular-nums"] },
  rowTitle: { color: fieldPalette.text, fontSize: 17, fontWeight: "400", flexGrow: 1 },
  hint: { color: fieldPalette.muted, fontSize: 11, letterSpacing: 0.6 },
  footer: { color: fieldPalette.dim, fontSize: 10, letterSpacing: 1, marginTop: 22 },
});
