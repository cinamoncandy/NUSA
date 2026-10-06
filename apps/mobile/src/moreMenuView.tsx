import React from "react";
import { fieldFonts } from "./fieldFonts";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MORE_DESTINATIONS, type MoreDestination } from "./navigationContract";
import { fieldPalette, readableFont } from "./designSystem";
import { HoloSphere } from "./holoSphere";

/** Field-style index grouped by what the owner is trying to do; thin rows, no cards. */
const LABELS: Readonly<Record<MoreDestination, { readonly title: string; readonly hint: string }>> = Object.freeze({
  Strategies: { title: "전략", hint: "어떤 전략이 판단하는지" },
  Portfolio: { title: "포트폴리오", hint: "PAPER 보유 자산" },
  Risk: { title: "위험", hint: "한도와 정지 조건" },
  Performance: { title: "성과", hint: "PAPER 수익과 손실" },
  PaperEvidence: { title: "PAPER 증거", hint: "판단과 체결 기록" },
  OrderHistory: { title: "주문 이력", hint: "PAPER 주문 목록" },
  SystemStatus: { title: "시스템 상태", hint: "서버와 연결 상태" },
  Notifications: { title: "알림", hint: "받은 알림" },
  Settings: { title: "설정", hint: "연결과 앱 설정" },
  Help: { title: "도움말", hint: "용어와 사용법" },
});

const GROUPS: readonly { readonly title: string; readonly items: readonly MoreDestination[] }[] = Object.freeze([
  { title: "자산과 기록", items: ["Portfolio", "Performance", "OrderHistory", "PaperEvidence"] },
  { title: "판단과 안전", items: ["Strategies", "Risk"] },
  { title: "앱", items: ["SystemStatus", "Notifications", "Settings", "Help"] },
]);

// Every destination must appear exactly once across the groups.
const grouped = GROUPS.flatMap((group) => group.items);
if (grouped.length !== MORE_DESTINATIONS.length || MORE_DESTINATIONS.some((destination) => !grouped.includes(destination))) {
  throw new Error("More menu groups must cover every destination exactly once");
}

export function MoreMenuView({ onOpen }: Readonly<{ onOpen: (destination: MoreDestination) => void }>) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="more-view">
    <View style={styles.titleRow}>
      <HoloSphere decisionCount={null} fillCount={null} tone="normal" reducedMotion size={34} points={300} testID="more-holo" />
      <Text style={styles.title}>더보기</Text>
    </View>
    {GROUPS.map((group) => <View key={group.title} style={styles.group}>
      <Text style={styles.groupTitle}>{group.title}</Text>
      <View style={styles.list}>
        {group.items.map((destination) => <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${LABELS[destination].title}, ${LABELS[destination].hint}`}
          key={destination}
          onPress={() => onOpen(destination)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          testID={`more-${destination}`}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>{LABELS[destination].title}</Text>
            <Text style={styles.hint} numberOfLines={1}>{LABELS[destination].hint}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>)}
      </View>
    </View>)}
    <Text style={styles.footer}>PAPER 전용 · LIVE 권한 없음 · AI 권한 없음</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fieldPalette.void },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 120, gap: 22 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: fieldPalette.text, fontSize: 28, lineHeight: 36, ...fieldFonts.displayLight },
  group: { gap: 8 },
  groupTitle: { color: fieldPalette.muted, fontSize: 12, letterSpacing: 0.6, ...fieldFonts.monoMedium },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fieldPalette.dim },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fieldPalette.dim },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: fieldPalette.text, fontSize: 16, fontWeight: "500" },
  hint: { color: fieldPalette.muted, fontSize: 12 },
  chevron: { color: fieldPalette.muted, fontSize: 22, lineHeight: 24 },
  footer: { color: fieldPalette.dim, fontSize: readableFont(11), ...fieldFonts.mono },
});
