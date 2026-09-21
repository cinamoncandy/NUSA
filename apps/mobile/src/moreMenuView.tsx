import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { masterReferenceColors, wealthProductColors } from "./designSystem";

const CANVAS = masterReferenceColors.canvas;
const ACCENT_SOFT = masterReferenceColors.accentSoft;
const TEXT = wealthProductColors.c06;
const MUTED = wealthProductColors.c04;
const BORDER = wealthProductColors.c03;
const PANEL = wealthProductColors.c02;

/** Destinations the concept board's More screen leads to, beyond the five primary tabs. */
export type MoreDestination = "PAPER" | "PERFORMANCE" | "HISTORY" | "NOTIFICATIONS" | "SETTINGS";

interface MoreMenuViewProps {
  readonly onSelect: (destination: MoreDestination) => void;
  readonly buildLabel: string;
}

const ITEMS: ReadonlyArray<Readonly<{ key: MoreDestination; title: string; detail: string }>> = [
  { key: "PAPER", title: "PAPER 리포트", detail: "검증된 PAPER 상태와 학습 근거" },
  { key: "PERFORMANCE", title: "성과", detail: "PAPER 자산 · 손익 · 배분" },
  { key: "HISTORY", title: "주문 이력", detail: "기록된 PAPER 주문" },
  { key: "NOTIFICATIONS", title: "알림", detail: "런타임 알림 상태" },
  { key: "SETTINGS", title: "설정", detail: "연결 · 기기 · 환경설정" },
];

/**
 * The concept board's More screen: an identity card, a list of deeper destinations, and an explicit
 * authority footer. The footer wording is the board's own — PAPER ONLY / AI ZERO AUTHORITY /
 * REAL DATA ONLY — and it is a safety declaration, so it renders as visible text rather than as a
 * marker some test can satisfy without anyone being able to read it.
 */
export function MoreMenuView({ onSelect, buildLabel }: MoreMenuViewProps) {
  return <ScrollView style={{ backgroundColor: CANVAS }} contentContainerStyle={styles.content} testID="more-screen">
    <Text style={styles.title}>More</Text>

    <View style={styles.identity} testID="more-identity">
      <View style={styles.identityLead}>
        <Text style={styles.identityName}>NUSA</Text>
        <Text style={styles.identityKicker}>Intelligence OS</Text>
        <Text style={styles.identityTag}>Markets. Signals. Evidence.</Text>
      </View>
      <View style={styles.modeChip}><Text style={styles.modeChipText}>PAPER MODE</Text></View>
    </View>

    <View style={styles.list} testID="more-destinations">
      {ITEMS.map((item, index) => <Pressable
        key={item.key}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={item.detail}
        onPress={() => onSelect(item.key)}
        style={({ pressed }) => [styles.item, index === ITEMS.length - 1 ? styles.itemLast : null, { opacity: pressed ? 0.7 : 1 }]}
        testID={`more-${item.key.toLowerCase()}`}
      >
        <View style={styles.itemLead}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemDetail} numberOfLines={1}>{item.detail}</Text>
        </View>
        <Text style={styles.itemChevron}>›</Text>
      </Pressable>)}
    </View>

    <View style={styles.authority} testID="more-authority">
      <Text style={styles.authorityLine}>PAPER ONLY</Text>
      <Text style={styles.authorityLine}>AI ZERO AUTHORITY</Text>
      <Text style={styles.authorityLine}>REAL DATA ONLY</Text>
    </View>

    <Text style={styles.build} testID="more-build-source">빌드 {buildLabel}</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120, gap: 16 },
  title: { color: TEXT, fontSize: 30, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  identity: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16 },
  identityLead: { flex: 1, minWidth: 180 },
  identityName: { color: TEXT, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: 1.5 },
  identityKicker: { color: MUTED, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  identityTag: { color: MUTED, fontSize: 10, lineHeight: 15, marginTop: 2 },
  modeChip: { flexShrink: 0, minHeight: 26, borderWidth: 1, borderColor: ACCENT_SOFT, borderRadius: 999, paddingHorizontal: 10, justifyContent: "center" },
  modeChipText: { color: ACCENT_SOFT, fontSize: 9, fontWeight: "900", letterSpacing: 0.7, paddingRight: 1 },
  list: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, overflow: "hidden" },
  item: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  itemLast: { borderBottomWidth: 0 },
  itemLead: { flex: 1, minWidth: 0 },
  itemTitle: { color: TEXT, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  itemDetail: { color: MUTED, fontSize: 11, lineHeight: 16 },
  itemChevron: { color: MUTED, fontSize: 20, fontWeight: "300" },
  authority: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 16, gap: 4, alignItems: "center" },
  authorityLine: { color: MUTED, fontSize: 10, lineHeight: 16, fontWeight: "800", letterSpacing: 1.6 },
  build: { color: MUTED, fontSize: 10, textAlign: "center", fontVariant: ["tabular-nums"] },
});
