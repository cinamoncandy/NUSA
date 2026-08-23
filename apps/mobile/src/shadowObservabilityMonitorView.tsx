import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import type { ShadowObservabilitySnapshot } from "../../../packages/contracts/src/shadowObservabilityReadOnly";

export interface ShadowObservabilityMonitorViewProps {
  readonly snapshot: ShadowObservabilitySnapshot | null;
  readonly unavailableReason?: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void | Promise<void>;
  readonly onClose?: () => void;
}

const time = (value: number | null | undefined): string => value == null ? "-" : new Date(value).toLocaleString("ko-KR");

export function ShadowObservabilityMonitorView({ snapshot, unavailableReason, refreshing, onRefresh, onClose }: ShadowObservabilityMonitorViewProps) {
  const { theme } = useTheme();
  const status = snapshot?.runtimeStatus ?? "UNAVAILABLE";
  const tone = status === "RUNNING" || status === "READY" ? "primary" : status === "HALTED" || status === "FAILED" ? "danger" : "warning";
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />} style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="shadow-observability-monitor">
    <View style={styles.titleRow}><View><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>SHADOW · READ ONLY</Text><Text style={[styles.title, { color: theme.colors.text }]}>Shadow 관측</Text><Text style={[styles.description, { color: theme.colors.textMuted }]}>실행 권한 없이 Shadow evidence와 재생 가능한 관측 기록만 표시합니다.</Text></View><StatusChip label={status} tone={tone} /></View>
    {snapshot == null ? <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>SHADOW 데이터 없음</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{unavailableReason ?? "현재 Cloud Shadow 관측 transport가 준비되지 않았습니다."}</Text></NusaCard> : <>
      <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현재 상태</Text><View style={styles.grid}><Metric label="MODE" value="SHADOW" /><Metric label="SYMBOL" value={snapshot.symbol} /><Metric label="STRATEGY" value={snapshot.strategyId} /><Metric label="MARKET" value={snapshot.marketFreshness} /><Metric label="GENERATED" value={time(snapshot.generatedAt)} /><Metric label="SESSION" value={snapshot.sessionId ?? "-"} /></View><Text style={[styles.reason, { color: theme.colors.textMuted }]}>LIVE NONE · PRODUCTION MUTATION OFF · AI ZERO_AUTHORITY</Text></NusaCard>
      <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Admission / Connection</Text><View style={styles.grid}><Metric label="CLOSED" value={String(snapshot.admission.closedCandleCount)} /><Metric label="DUPLICATE" value={String(snapshot.admission.duplicateCandleCount)} /><Metric label="STALE" value={String(snapshot.admission.staleCandleCount)} /><Metric label="OUT OF ORDER" value={String(snapshot.admission.outOfOrderCandleCount)} /><Metric label="CONNECTION" value={snapshot.marketConnection?.state ?? "-"} /><Metric label="LAST MARKET" value={time(snapshot.marketConnection?.lastMarketMessageAt)} /></View></NusaCard>
      <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>관측 Timeline</Text>{snapshot.events.length === 0 ? <Text style={[styles.body, { color: theme.colors.textMuted }]}>관측 이벤트 없음</Text> : snapshot.events.slice().reverse().map((event) => <View key={event.id} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: theme.colors.text }]}>{event.eventType} · {event.stage ?? "-"}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{time(event.occurredAt)} · {event.status}</Text></View><Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{event.reasonCodes.join(", ") || "-"}</Text></View>)}</NusaCard>
      <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Counters</Text><View style={styles.grid}><Metric label="SIGNALS" value={String(snapshot.counters.signalCount)} /><Metric label="HYPOTHETICAL ORDERS" value={String(snapshot.counters.hypotheticalOrderCount)} /><Metric label="HYPOTHETICAL FILLS" value={String(snapshot.counters.hypotheticalFillCount)} /><Metric label="BROKER CALLS" value={String(snapshot.counters.actualBrokerCallCount)} /></View></NusaCard>
    </>}
    {onClose ? <NusaButton label="닫기" onPress={onClose} /> : null}
  </ScrollView>;
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { const { theme } = useTheme(); return <View style={styles.metric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: theme.colors.text }]}>{value}</Text></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 20, gap: 14, paddingBottom: 36 }, titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }, eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }, title: { fontSize: 26, fontWeight: "800", marginTop: 4 }, description: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 620 }, sectionTitle: { fontSize: 16, fontWeight: "800", marginBottom: 10 }, body: { fontSize: 13, lineHeight: 20 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, metric: { minWidth: "30%", flexGrow: 1 }, metricLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1 }, metricValue: { fontSize: 14, fontWeight: "700", marginTop: 4 }, reason: { fontSize: 12, lineHeight: 18, marginTop: 12 }, row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 }, rowMain: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, rowLabel: { fontSize: 12, fontWeight: "700", flexShrink: 1 }, rowMeta: { fontSize: 11 }, rowValue: { fontSize: 11 },
});

