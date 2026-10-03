import { Fragment, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { NusaButton, NusaCard } from "./components";
import { useTheme } from "./ThemeProvider";
import { FieldHeader } from "./fieldHeader";
import { buildLiveFieldHeader, liveUnavailableMessage, type LiveUnavailableKind } from "./fieldScreensModel";
import { buildLiveGates, type LiveGateState } from "./liveGateModel";
import type { LiveReadinessObservabilitySnapshot } from "../../../packages/contracts/src/liveReadinessObservability";
import { labelFont, readableFont } from "./designSystem";
import { monitorLabel } from "./monitorCopy";

export interface LiveReadinessMonitorViewProps {
  readonly snapshot: LiveReadinessObservabilitySnapshot | null;
  readonly unavailableReason?: string;
  readonly unavailableKind?: LiveUnavailableKind;
  readonly refreshing: boolean;
  readonly onRefresh: () => void | Promise<void>;
  readonly onClose?: () => void;
}

const time = (value: string | undefined): string => value == null ? "확인되지 않음" : new Date(value).toLocaleString("ko-KR");
const state = (value: boolean): string => value ? "ACTIVE" : "CLEAR";

export function LiveReadinessMonitorView({ snapshot, unavailableReason, unavailableKind = "FAILED", refreshing, onRefresh, onClose }: LiveReadinessMonitorViewProps) {
  const { theme } = useTheme();
  const status = snapshot?.status ?? "UNAVAILABLE";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const gates = buildLiveGates(snapshot);
  const runtimeBlocked = snapshot != null && (snapshot.runtimeSafety.killSwitchActive || snapshot.runtimeSafety.exchangeError || snapshot.runtimeSafety.staleMarketData || snapshot.runtimeSafety.riskBudgetBreached || snapshot.runtimeSafety.reconciliationMismatch || snapshot.runtimeSafety.abnormalBalanceDrift || snapshot.runtimeSafety.strategyInvalidated);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />} style={[styles.screen, { backgroundColor: theme.colors.background }]} testID="live-ready-monitor">
    <View style={styles.fieldBleed}><FieldHeader model={buildLiveFieldHeader(snapshot, unavailableReason, unavailableKind)} testID="live-field-header" /></View>
    {snapshot == null || gates == null ? <NusaCard testID="live-ready-unavailable"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>LIVE 준비 데이터 없음</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{liveUnavailableMessage(unavailableKind)}</Text>{unavailableReason ? <Text style={[styles.body, { color: theme.colors.textMuted, fontSize: readableFont(11), opacity: 0.7 }]} testID="live-ready-unavailable-reason">오류 내용: {unavailableReason}</Text> : null}</NusaCard> : <>
      <View style={styles.hero} testID="live-ready-overview">
        <Text style={[styles.heroTitle, { color: runtimeBlocked ? theme.colors.warning : theme.colors.text }]}>{gates.headline}</Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>{gates.detail}</Text>
        <View style={[styles.track, { backgroundColor: theme.colors.border }]} accessibilityLabel={`관문 ${gates.total}개 중 ${gates.passed}개 통과`}>
          <View style={[styles.fill, { width: `${Math.round((gates.passed / gates.total) * 100)}%`, backgroundColor: theme.colors.primary }]} />
        </View>
        <Text style={[styles.count, { color: theme.colors.textMuted }]}>{gates.passed} / {gates.total} 관문 통과</Text>
      </View>
      <View style={[styles.gateList, { borderTopColor: theme.colors.border }]} testID="live-ready-gates">
        {[...gates.gates].sort((left, right) => Number(left.state === "PASS") - Number(right.state === "PASS")).map((gate, index, ordered) => <Fragment key={gate.id}>
        {index === 0 || (ordered[index - 1].state !== "PASS" && gate.state === "PASS") ? <Text style={[styles.gateGroup, { color: theme.colors.textMuted }]} testID={gate.state === "PASS" ? "live-gates-passed-heading" : "live-gates-remaining-heading"}>{gate.state === "PASS" ? `통과 ${gates.passed}개` : `남은 조건 ${gates.total - gates.passed}개`}</Text> : null} <View key={gate.id} style={[styles.gateRow, { borderBottomColor: theme.colors.border }]} testID={`live-gate-${gate.id}`}>
          <View style={[styles.gateDot, gateDotStyle(gate.state, theme.colors.primary, theme.colors.warning, theme.colors.textMuted)]} />
          <View style={styles.rowMain}>
            <Text style={[styles.gateTitle, { color: gate.state === "PASS" ? theme.colors.text : theme.colors.textMuted }]}>{gate.title}</Text>
            <Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{gate.detail}</Text>
          </View>
          <Text style={[styles.gateState, { color: gate.state === "PASS" ? theme.colors.primary : gate.state === "BLOCKED" ? theme.colors.warning : theme.colors.textMuted }]}>{GATE_LABEL[gate.state]}</Text>
        </View></Fragment>)}
      </View>
      <Text style={[styles.reason, { color: theme.colors.textMuted }]}>관측 전용: 주문·취소·출금·이체·LIVE 활성화·lease 생성 기능이 없습니다.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((open) => !open)} style={({ pressed }) => [styles.toggle, { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 }]} testID="live-ready-details-toggle">
        <Text style={[styles.toggleText, { color: theme.colors.text }]}>{detailsOpen ? "세부 기록 닫기" : "세부 기록 보기"}</Text>
      </Pressable>
      {detailsOpen ? <>
      <NusaCard testID="live-ready-status"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>준비 상태</Text><View style={styles.grid}><Metric label="STATUS" value={snapshot.status} /><Metric label="LAST REFRESH" value={time(snapshot.lastRefresh)} /><Metric label="HEAD" value={snapshot.currentHeadSha || "UNKNOWN"} /><Metric label="ACTIVATION" value={snapshot.activationState} /><Metric label="LEASE" value={snapshot.activationLeaseState} /><Metric label="CREDENTIAL" value={snapshot.credentialReadiness} /></View><Text style={[styles.reason, { color: theme.colors.textMuted }]}>liveAuthority=NONE · productionMutationAllowed=false · AI authority=ZERO_AUTHORITY</Text></NusaCard>
      <NusaCard testID="live-ready-safety"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Safety & Readiness</Text><View style={styles.grid}><Metric label="GOVERNANCE" value={snapshot.governance} /><Metric label="TRADE PERMISSION" value={snapshot.tradePermission} /><Metric label="RISK AUTHORITY" value={snapshot.riskAuthority} /><Metric label="RECONCILIATION" value={snapshot.reconciliationTests} /><Metric label="KILL SWITCH TEST" value={snapshot.killSwitchTests} /><Metric label="CIRCUIT BREAKER" value={state(snapshot.runtimeSafety.exchangeError || snapshot.runtimeSafety.staleMarketData || snapshot.runtimeSafety.riskBudgetBreached || snapshot.runtimeSafety.reconciliationMismatch)} /><Metric label="CREDENTIAL SOURCE" value={snapshot.realAccountMonitor} /><Metric label="PROHIBITED MUTATION" value={snapshot.prohibitedFinancialMutationScan} /></View></NusaCard>
      {snapshot.blockers.length > 0 ? <NusaCard testID="live-ready-blockers"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>차단 근거</Text>{snapshot.blockers.map((blocker) => <Text key={blocker} style={[styles.body, { color: theme.colors.warning }]}>· {blocker}</Text>)}</NusaCard> : <NusaCard testID="live-ready-blockers"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>차단 근거</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>현재 canonical evaluator에서 보고된 차단 근거가 없습니다. 그래도 이 화면은 실행 권한을 부여하지 않습니다.</Text></NusaCard>}
      <NusaCard testID="live-ready-freshness"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Evidence Freshness</Text>{Object.entries(snapshot.freshness).sort(([left], [right]) => left.localeCompare(right)).map(([source, freshness]) => <View key={source} style={[styles.row, { borderBottomColor: theme.colors.border }]}><Text style={[styles.rowLabel, { color: theme.colors.text }]}>{source}</Text><Text style={[styles.rowValue, { color: freshness === "FRESH" ? theme.colors.primary : theme.colors.warning }]}>{freshness}</Text></View>)}<Text style={[styles.reason, { color: theme.colors.textMuted }]}>source version: {snapshot.provenance.sourceVersion} · fingerprint: {snapshot.provenance.sourceFingerprint.slice(0, 16)}…</Text></NusaCard>
      <NusaCard testID="live-ready-incidents"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Incidents</Text>{snapshot.incidents.length === 0 ? <Text style={[styles.body, { color: theme.colors.textMuted }]}>현재 readiness incident 없음</Text> : snapshot.incidents.map((incident) => <View key={incident.code} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: incident.severity === "CRITICAL" ? theme.colors.danger : theme.colors.warning }]}>{incident.code}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{incident.severity} · {time(incident.observedAt)}</Text></View></View>)}</NusaCard>
      <NusaCard testID="live-ready-timeline"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Future LIVE Lifecycle · READ ONLY</Text>{snapshot.timeline.length === 0 ? <Text style={[styles.body, { color: theme.colors.textMuted }]}>기록된 canonical LIVE mock/rehearsal lifecycle이 없습니다.</Text> : snapshot.timeline.map((entry) => <View key={entry.eventId} style={[styles.row, { borderBottomColor: theme.colors.border }]}><View style={styles.rowMain}><Text style={[styles.rowLabel, { color: theme.colors.text }]}>{entry.sequence}. {entry.stage}</Text><Text style={[styles.rowMeta, { color: theme.colors.textMuted }]}>{entry.status} · {time(entry.occurredAt)}</Text></View><Text style={[styles.rowValue, { color: theme.colors.primary }]}>BROKER {entry.brokerMutation}</Text></View>)}</NusaCard>
      <NusaCard testID="live-ready-authority"><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Authority</Text><View style={styles.grid}><Metric label="KILL SWITCH" value={state(snapshot.runtimeSafety.killSwitchActive)} /><Metric label="STALE MARKET" value={state(snapshot.runtimeSafety.staleMarketData)} /><Metric label="BALANCE DRIFT" value={state(snapshot.runtimeSafety.abnormalBalanceDrift)} /><Metric label={monitorLabel("STRATEGY")} value={state(snapshot.runtimeSafety.strategyInvalidated)} /></View></NusaCard>
      </> : null}
    </>}
    {onClose ? <NusaButton label="닫기" onPress={onClose} /> : null}
  </ScrollView>;
}

const GATE_LABEL: Readonly<Record<LiveGateState, string>> = Object.freeze({ PASS: "통과", BLOCKED: "막힘", UNKNOWN: "확인 중" });

function gateDotStyle(state: LiveGateState, pass: string, blocked: string, unknown: string) {
  return state === "PASS" ? { backgroundColor: pass, borderColor: pass } : { backgroundColor: "transparent", borderColor: state === "BLOCKED" ? blocked : unknown };
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { const { theme } = useTheme(); return <View style={styles.metric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: theme.colors.text }]}>{value}</Text></View>; }

const styles = StyleSheet.create({
  hero: { gap: 8, paddingTop: 4 },
  heroTitle: { fontSize: 24, lineHeight: 31, fontWeight: "600", letterSpacing: -0.4 },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6 },
  fill: { height: 4, borderRadius: 2 },
  count: { fontSize: labelFont(11), letterSpacing: 0.6 },
  gateGroup: { fontSize: 12, marginTop: 14, marginBottom: 4 },
  gateList: { borderTopWidth: StyleSheet.hairlineWidth },
  gateRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  gateDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  gateTitle: { fontSize: 14, fontWeight: "500" },
  gateState: { fontSize: readableFont(11), fontWeight: "600" },
  toggle: { minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  toggleText: { fontSize: 13, fontWeight: "500" },
  screen: { flex: 1 }, fieldBleed: { marginHorizontal: -20, marginTop: -20 }, content: { padding: 20, gap: 14, paddingBottom: 36 }, sectionTitle: { fontSize: 16, fontWeight: "500", marginBottom: 10 }, body: { fontSize: 13, lineHeight: 20 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, metric: { minWidth: "30%", flexGrow: 1 }, metricLabel: { fontSize: labelFont(10), fontWeight: "700", letterSpacing: 1 }, metricValue: { fontSize: 14, fontWeight: "700", marginTop: 4 }, reason: { fontSize: 12, lineHeight: 18, marginTop: 12 }, row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", gap: 8 }, rowMain: { flex: 1, gap: 4 }, rowLabel: { fontSize: 12, fontWeight: "700", flexShrink: 1 }, rowMeta: { fontSize: readableFont(11) }, rowValue: { fontSize: readableFont(11), fontWeight: "700" },
});
