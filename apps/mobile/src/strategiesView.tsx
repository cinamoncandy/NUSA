import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { masterReferenceColors, wealthProductColors } from "./designSystem";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";

const CANVAS = masterReferenceColors.canvas;
const ACCENT = masterReferenceColors.accent;
const ACCENT_SOFT = masterReferenceColors.accentSoft;
const TEXT = wealthProductColors.c06;
const MUTED = wealthProductColors.c04;
const BORDER = wealthProductColors.c03;
const PANEL = wealthProductColors.c02;

interface StrategiesViewProps {
  readonly research: ResearchStatusProjection | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function Row({ label, value, tone }: Readonly<{ label: string; value: string; tone?: "accent" }>) {
  return <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, tone === "accent" ? { color: ACCENT_SOFT } : null]} numberOfLines={1}>{value}</Text>
  </View>;
}

/**
 * The concept board's Strategies screen lists strategy families with returns. The runtime carries
 * no per-strategy return: ResearchStatusProjection names a champion and a challenger with their
 * versions and authority, and counts candidates and experiments. So the composition follows the
 * board and the content stops where the evidence stops — an absent return is stated, never filled.
 */
export function StrategiesView({ research, refreshing, onRefresh }: StrategiesViewProps) {
  const entries = research === null ? [] : [
    { key: "champion", role: "CHAMPION", id: research.champion.strategyId, version: research.champion.strategyVersion, authority: research.champion.authority },
    { key: "challenger", role: "CHALLENGER", id: research.challenger.strategyId, version: research.challenger.strategyVersion, authority: research.challenger.authority },
  ];

  return <ScrollView
    style={{ backgroundColor: CANVAS }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={ACCENT} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="strategies-screen"
  >
    <Text style={styles.title}>Strategies</Text>
    <Text style={styles.subtitle}>검증된 연구 세션의 전략만 표시합니다. 주문 권한은 없습니다.</Text>

    {research === null
      ? <View style={styles.empty} testID="strategies-unavailable">
          <Text style={styles.emptyTitle}>NO VERIFIED STRATEGY DATA</Text>
          <Text style={styles.emptyBody}>연구 세션 근거가 없어 전략을 표시하지 않습니다. 추정치를 대신 보여주지 않습니다.</Text>
        </View>
      : <>
        {entries.map((entry) => <View key={entry.key} style={styles.card} testID={`strategy-${entry.key}`}>
          <View style={styles.cardHead}>
            <Text style={styles.cardRole}>{entry.role}</Text>
            <View style={styles.authorityChip}><Text style={styles.authorityChipText}>{entry.authority}</Text></View>
          </View>
          <Text style={styles.cardId} numberOfLines={1}>{entry.id}</Text>
          <Text style={styles.cardVersion}>v{entry.version}</Text>
          <Text style={styles.cardReturn} testID={`strategy-${entry.key}-return`}>수익률 —</Text>
          <Text style={styles.cardReturnNote}>런타임이 전략별 수익률을 제공하지 않습니다.</Text>
        </View>)}

        <View style={styles.sessionCard} testID="strategies-session">
          <Text style={styles.sessionTitle}>RESEARCH SESSION</Text>
          <Row label="상태" value={research.state} />
          <Row label="건전성" value={research.health} tone="accent" />
          <Row label="후보" value={String(research.candidateCount)} />
          <Row label="실험" value={String(research.experimentCount)} />
          <Row label="복구" value={research.recoveryStatus} />
        </View>
      </>}

    <Text style={styles.authority} testID="strategies-authority">PAPER ONLY · LIVE {research?.liveAuthority ?? "NONE"} · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120, gap: 14 },
  title: { color: TEXT, fontSize: 30, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  subtitle: { color: MUTED, fontSize: 12, lineHeight: 18 },
  empty: { minHeight: 120, borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 18, gap: 8, justifyContent: "center" },
  emptyTitle: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  emptyBody: { color: MUTED, fontSize: 11, lineHeight: 17 },
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cardRole: { color: ACCENT_SOFT, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  authorityChip: { flexShrink: 0, minHeight: 22, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 9, justifyContent: "center" },
  authorityChipText: { color: MUTED, fontSize: 8, fontWeight: "900", letterSpacing: 0.5, paddingRight: 1 },
  cardId: { color: TEXT, fontSize: 17, lineHeight: 24, fontWeight: "700", marginTop: 4 },
  cardVersion: { color: MUTED, fontSize: 11, fontVariant: ["tabular-nums"] },
  cardReturn: { color: MUTED, fontSize: 20, lineHeight: 26, fontWeight: "800", marginTop: 8, fontVariant: ["tabular-nums"] },
  cardReturnNote: { color: MUTED, fontSize: 10, lineHeight: 15 },
  sessionCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16, gap: 2 },
  sessionTitle: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 8 },
  row: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { color: MUTED, fontSize: 12 },
  rowValue: { color: TEXT, fontSize: 12, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] },
  authority: { color: MUTED, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "center", marginTop: 6 },
});
