import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import type { RealReadOnlyObservabilitySnapshot } from "../../../packages/contracts/src/realReadOnlyObservability";

export interface RealReadOnlyMonitorViewProps {
  readonly snapshot: RealReadOnlyObservabilitySnapshot | null;
  readonly unavailableReason?: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void | Promise<void>;
  readonly onClose?: () => void;
}

const time = (value: number | null | undefined): string => value == null ? "UNKNOWN" : new Date(value).toLocaleString("ko-KR");

/**
 * A value that was never observed renders as UNKNOWN, never as 0. The contract carries `null` for
 * exactly this reason: a fabricated zero balance is indistinguishable from a genuinely empty
 * account, and an operator cannot tell "we did not read this" from "this is really zero".
 */
const amount = (value: number | null | undefined): string => value == null ? "UNKNOWN" : value.toLocaleString("ko-KR");

export function RealReadOnlyMonitorView({ snapshot, unavailableReason, refreshing, onRefresh, onClose }: RealReadOnlyMonitorViewProps) {
  const { theme } = useTheme();
  const status = snapshot?.runtimeStatus ?? "UNAVAILABLE";
  const tone = status === "HEALTHY" ? "primary" : status === "ERROR" ? "danger" : "warning";
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />} style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="real-readonly-monitor">
    <View style={styles.titleRow}><View><Text style={[styles.eyebrow, { color: theme.colors.warning }]}>REAL · READ ONLY</Text><Text style={[styles.title, { color: theme.colors.text }]}>실계좌 관측</Text><Text style={[styles.description, { color: theme.colors.textMuted }]}>실계좌를 읽기 전용으로 관측만 합니다. 주문·출금·이체 기능이 없으며 PAPER 잔고와 절대 합산되지 않습니다.</Text></View><StatusChip label={status} tone={tone} /></View>
    {snapshot == null ? <NusaCard><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>REAL 데이터 없음</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{unavailableReason ?? "현재 Cloud 실계좌 읽기 전용 transport가 준비되지 않았습니다."}</Text></NusaCard> : <>
      <NusaCard testID="real-readonly-connection"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>연결 / 인증</Text><View style={styles.grid}><Metric label="MODE" value="REAL_READ_ONLY" /><Metric label="CONNECTION" value={snapshot.connection.code} /><Metric label="FRESHNESS" value={snapshot.freshness} /><Metric label="LAST REFRESH" value={time(snapshot.connection.lastSuccessfulRefreshAt)} /><Metric label="LAST ERROR" value={time(snapshot.connection.lastErrorAt)} /><Metric label="CREDENTIAL" value={snapshot.credentialReadiness.configured ? "CONFIGURED" : "NOT_CONFIGURED"} /></View>{snapshot.connection.lastErrorReason ? <Text style={[styles.reason, { color: theme.colors.danger }]} testID="real-readonly-last-error">{snapshot.connection.lastErrorReason}</Text> : null}<Text style={[styles.reason, { color: theme.colors.textMuted }]}>LIVE NONE · PRODUCTION MUTATION OFF · AI ZERO_AUTHORITY · 주문/출금/이체 없음</Text></NusaCard>
      <NusaCard testID="real-readonly-account"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>관측된 실계좌</Text><View style={styles.grid}><Metric label="ACCOUNT" value={snapshot.account.maskedAccountReference ?? "UNKNOWN"} /><Metric label="OBSERVED AT" value={time(snapshot.account.observedAt)} /><Metric label="관측 현금 KRW" value={amount(snapshot.account.observedCashKrw)} /><Metric label="관측 잠금 KRW" value={amount(snapshot.account.observedLockedKrw)} /><Metric label="OPEN ORDERS" value={snapshot.account.openOrderCount == null ? "UNKNOWN" : String(snapshot.account.openOrderCount)} /><Metric label="ASSETS" value={String(snapshot.account.observedAssets.length)} /></View>
        <Text style={[styles.reason, { color: theme.colors.textMuted }]}>이 값은 실계좌 관측값입니다. PAPER 자산/손익과 별개이며 합산하지 않습니다.</Text>
        {snapshot.account.observedAssets.map((asset) => <View key={asset.currency} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: theme.colors.text }]}>{asset.currency}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{amount(asset.available)} · 잠금 {amount(asset.locked)} · 평균매수가 {amount(asset.avgBuyPrice)} {asset.unitCurrency}</Text></View></View>)}
      </NusaCard>
      <NusaCard testID="real-readonly-reconciliation"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>재대사(Reconciliation)</Text><View style={styles.grid}><Metric label="STATUS" value={snapshot.reconciliation.status} /><Metric label="OBSERVED AT" value={time(snapshot.reconciliation.observedAt)} /><Metric label="변경 통화" value={snapshot.reconciliation.changedCurrencies.join(", ") || "-"} /><Metric label="주문 차이" value={snapshot.reconciliation.openOrderDifferenceCount == null ? "UNKNOWN" : String(snapshot.reconciliation.openOrderDifferenceCount)} /></View><Text style={[styles.reason, { color: theme.colors.textMuted }]}>{snapshot.reconciliation.reason}</Text></NusaCard>
      {snapshot.alerts.length > 0 ? <NusaCard testID="real-readonly-alerts"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>경보</Text>{snapshot.alerts.map((alert) => <View key={`${alert.code}-${alert.raisedAt}`} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: alert.severity === "CRITICAL" ? theme.colors.danger : theme.colors.warning }]}>{alert.code}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{alert.severity} · {time(alert.raisedAt)}</Text></View><Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{alert.reason}</Text></View>)}</NusaCard> : null}
      {snapshot.blockers.length > 0 ? <NusaCard testID="real-readonly-blockers"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>차단 사유</Text>{snapshot.blockers.map((blocker) => <Text key={blocker} style={[styles.body, { color: theme.colors.textMuted }]}>· {blocker}</Text>)}</NusaCard> : null}
      <NusaCard testID="real-readonly-timeline"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>관측 Timeline</Text>{snapshot.events.length === 0 ? <Text style={[styles.body, { color: theme.colors.textMuted }]}>관측 이벤트 없음</Text> : snapshot.events.slice().reverse().map((event) => <View key={event.id} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: theme.colors.text }]}>{event.eventType}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{time(event.occurredAt)}</Text></View><Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{event.reason}</Text></View>)}</NusaCard>
      <NusaCard testID="real-readonly-counters"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Counters</Text><View style={styles.grid}><Metric label="REFRESH" value={String(snapshot.counters.refreshCount)} /><Metric label="ERROR" value={String(snapshot.counters.errorCount)} /><Metric label="RECONCILIATION" value={String(snapshot.counters.reconciliationCount)} /><Metric label="ORDER MUTATION" value={String(snapshot.counters.orderMutationCount)} /><Metric label="WITHDRAWAL" value={String(snapshot.counters.withdrawalCount)} /><Metric label="TRANSFER" value={String(snapshot.counters.transferCount)} /></View></NusaCard>
    </>}
    {onClose ? <NusaButton label="닫기" onPress={onClose} /> : null}
  </ScrollView>;
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { const { theme } = useTheme(); return <View style={styles.metric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: theme.colors.text }]}>{value}</Text></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 20, gap: 14, paddingBottom: 36 }, titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }, eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }, title: { fontSize: 26, fontWeight: "800", marginTop: 4 }, description: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 620 }, sectionTitle: { fontSize: 16, fontWeight: "800", marginBottom: 10 }, body: { fontSize: 13, lineHeight: 20 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, metric: { minWidth: "30%", flexGrow: 1 }, metricLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1 }, metricValue: { fontSize: 14, fontWeight: "700", marginTop: 4 }, reason: { fontSize: 12, lineHeight: 18, marginTop: 12 }, row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 }, rowMain: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, rowLabel: { fontSize: 12, fontWeight: "700", flexShrink: 1 }, rowMeta: { fontSize: 11 }, rowValue: { fontSize: 11 },
});
