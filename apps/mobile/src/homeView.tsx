import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DataRow, MotionReveal, NusaButton, TerrainSignal } from "./components";
import { InlineNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "Trade" | "Portfolio" | "More";
interface HomeViewProps { readonly snapshot: Snapshot | null; readonly investmentPercent: number; readonly readOnlyError: string | null; readonly notConfigured: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onGoSettings: () => void; readonly onNavigate: (destination: HomeDestination) => void; }
function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" { return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning"; }

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onGoSettings, onNavigate }: HomeViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const account = snapshot?.portfolio?.account ?? null;
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const nextAction = notConfigured
    ? { title: "PAPER 연결 설정", detail: "읽기 전용 endpoint와 메모리 세션을 확인합니다.", tab: null }
    : snapshot?.health !== "HEALTHY" || snapshot?.dashboard.killSwitchActive || !snapshot?.readyForPaperOperations
      ? { title: "PAPER 상태 보기", detail: "연결과 안전 상태를 확인합니다.", tab: "Markets" as const }
      : aiInsightAvailable
        ? { title: "AI 분석 보기", detail: "검증된 읽기 전용 분석을 확인합니다.", tab: "More" as const }
        : { title: "시장 보기", detail: "검증된 시장 데이터를 확인합니다.", tab: "Markets" as const };
  const runNextAction = () => { if (nextAction.tab === null) onGoSettings(); else onNavigate(nextAction.tab); };

  return <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]} refreshControl={<RefreshControl tintColor={theme.colors.text} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <View style={styles.headerRow}><View><Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>NUSA / HOME</Text></View><Text style={[styles.compactStatus, { color: theme.colors.textMuted }]}>PAPER · LIVE OFF</Text></View>
    {readOnlyError ? <InlineNotice title="PAPER 연결 오류" detail={readOnlyError} tone="danger" /> : null}

    <MotionReveal testID="home-hero-reveal"><View style={styles.hero} testID="account-hero-card">
      <View style={styles.heroLabelRow}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text><Text style={[styles.heroState, { color: signalReady ? theme.colors.text : theme.colors.textMuted }]}>{snapshot ? (signalReady ? "PAPER READY" : "PAPER CHECK") : "PAPER SETUP"}</Text></View>
      <Text style={[styles.balance, tablet && styles.balanceTablet, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "—"}</Text>
      <View style={styles.changeRow}>{totalPnl != null ? <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.text : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text> : <Text style={[styles.pnl, { color: theme.colors.textMuted }]}>오늘 변화 대기</Text>}<Text style={[styles.changeLabel, { color: theme.colors.textMuted }]}>오늘의 손익</Text></View>

      <View style={styles.aiBlock} testID="ai-card"><View style={styles.aiHeading}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>AI SIGNAL</Text><Text style={[styles.readOnlyLabel, { color: theme.colors.textMuted }]}>READ ONLY</Text></View><Text style={[styles.aiThesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]} numberOfLines={tablet ? 2 : 3}>{ai?.thesis ?? "검증된 관찰을 기다리는 중입니다."}</Text><Text style={[styles.aiEvidence, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `근거 ${ai?.evidenceReferences.length ?? 0}개 · 주문 권한 없음` : "근거 없음 · 주문 권한 없음"}</Text></View>

      <MotionReveal testID="home-signal-reveal"><View style={styles.signalStage}><TerrainSignal variant="symbolic" signalStrength={signalReady ? 0.95 : 0.38} accessibilityLabel={`PAPER 상태 신호: ${signalReady ? "준비됨" : "점검 필요"}`} testID="home-signal-trace" hero /><View style={[styles.signalNode, { backgroundColor: theme.colors.text, shadowColor: theme.colors.aiSignalMid }]} /><Text style={[styles.signalCaption, { color: theme.colors.textMuted }]}>NUSA TERRAIN / STATE TRACE</Text></View></MotionReveal>
    </View></MotionReveal>

    {notConfigured ? <View style={styles.operationNotice} testID="home-operation-notice"><View><Text style={[styles.operationTitle, { color: theme.colors.text }]}>PAPER 연결 필요</Text><Text style={[styles.operationDetail, { color: theme.colors.textMuted }]}>Home은 계속 볼 수 있고, 연결은 읽기 전용으로 설정합니다.</Text></View><NusaButton label="연결 설정" onPress={onGoSettings} tone="neutral" testID="home-next-action-button" /></View> : <View style={styles.nextAction} testID="home-next-action"><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>NEXT</Text><Text style={[styles.nextTitle, { color: theme.colors.text }]}>{nextAction.title}</Text><Text style={[styles.operationDetail, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text></View><NusaButton label={nextAction.title} onPress={runNextAction} tone="neutral" testID="home-next-action-button" /></View>}

    {snapshot ? <View style={styles.metricsSection} testID="home-status-summary"><View style={styles.sectionHeader}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>PRIMARY METRICS</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>오늘의 기준</Text></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={healthTone(snapshot.operations.runtimeState)} /><DataRow label="안전 게이트" value={snapshot.readyForPaperOperations ? "통과" : "점검 필요"} tone={snapshot.readyForPaperOperations ? "success" : "warning"} />{allocation ? <><View style={styles.metricRow}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>투자 가능 현금</Text><Text testID="home-investable-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.investableCash)}</Text></View><View style={styles.metricRow}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="home-reserved-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.reservedCash)}</Text></View></> : null}</View> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 22, paddingBottom: 48, width: "100%", maxWidth: 920, alignSelf: "center" }, contentTablet: { maxWidth: 1120, paddingHorizontal: 48, paddingTop: 24, gap: 26 },
  headerRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, wordmark: { fontSize: 23, lineHeight: 26, fontWeight: "800", letterSpacing: 2.4 }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.35 }, compactStatus: { fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 0.45 },
  hero: { minHeight: 560, paddingTop: 8, paddingBottom: 0 }, heroLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, heroState: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 0.9 }, balance: { marginTop: 12, fontSize: 66, lineHeight: 76, fontWeight: "800", letterSpacing: -3.5, fontVariant: ["tabular-nums"] }, balanceTablet: { fontSize: 92, lineHeight: 100 }, changeRow: { marginTop: 4, flexDirection: "row", alignItems: "baseline", gap: 9 }, pnl: { fontSize: 21, lineHeight: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }, value: { fontSize: 15, lineHeight: 22, fontWeight: "700", fontVariant: ["tabular-nums"] }, changeLabel: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  aiBlock: { marginTop: 24, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.2)", borderBottomColor: "rgba(255,255,255,0.2)", gap: 7 }, aiHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, readOnlyLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.05 }, aiThesis: { fontSize: 18, lineHeight: 25, fontWeight: "700", letterSpacing: -0.25 }, aiEvidence: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  signalStage: { height: 216, marginTop: 14, justifyContent: "center", position: "relative" }, signalNode: { position: "absolute", left: "68%", top: "47%", width: 5, height: 5, borderRadius: 3, shadowOpacity: 0.8, shadowRadius: 12, elevation: 2 }, signalCaption: { position: "absolute", left: 0, bottom: 0, fontSize: 9, lineHeight: 14, fontWeight: "700", letterSpacing: 1.1 },
  operationNotice: { minHeight: 58, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.14)", borderBottomColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }, operationTitle: { fontSize: 14, lineHeight: 20, fontWeight: "800" }, operationDetail: { marginTop: 2, fontSize: 12, lineHeight: 18, fontWeight: "500" }, nextAction: { minHeight: 58, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.14)", borderBottomColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }, nextTitle: { marginTop: 2, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  metricsSection: { gap: 6, paddingTop: 2 }, sectionHeader: { marginBottom: 4, gap: 2 }, sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.4 }, metricRow: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, metricLabel: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
});
