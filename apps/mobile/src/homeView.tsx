import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AIInsight, MotionReveal, NusaButton, SafetyNotice, StatusChip, TerrainSignal } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";
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
  const aiTrustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const allocationWidth = allocation ? `${allocation.investmentPercent}%` as `${number}%` : "0%";
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const nextAction = notConfigured
    ? { title: "PAPER 연결 설정", detail: "Settings에서 endpoint와 메모리 전용 세션 토큰을 검증하세요.", tab: null }
    : snapshot?.health !== "HEALTHY" || snapshot?.dashboard.killSwitchActive || !snapshot?.readyForPaperOperations
      ? { title: "PAPER 상태 보기", detail: "연결과 안전 상태를 확인하세요.", tab: "Markets" as const }
      : aiInsightAvailable
        ? { title: "AI 분석 보기", detail: "검증된 읽기 전용 분석을 확인하세요.", tab: "AiSignal" as const }
        : { title: "시장 보기", detail: "검증된 시장 데이터를 확인하세요.", tab: "Markets" as const };
  const runNextAction = () => { if (nextAction.tab === null) onGoSettings(); else onNavigate(nextAction.tab); };

  return <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenPadding, gap: theme.layout.sectionGap }, tablet && styles.contentTablet]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <ScreenHeader eyebrow="NUSA ISLAND" title="홈" description="자산 상태와 지금 필요한 한 가지 행동을 확인합니다." statusLabel={snapshot?.health ?? "미연결"} statusTone={snapshot ? healthTone(snapshot.health) : "neutral"} />
    <View style={styles.topline}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER ONLY</Text><View style={styles.toplineRight}><StatusChip label={snapshot?.health ?? (notConfigured ? "연결 필요" : "대기")} tone={snapshot ? healthTone(snapshot.health) : "warning"} /><StatusChip label="LIVE NONE" tone="neutral" /></View></View>
    {readOnlyError ? <InlineNotice title="PAPER 서버 연결 오류" detail={readOnlyError} tone="danger" /> : null}
    {notConfigured ? <View style={styles.connection} testID="dashboard-session-card"><Text style={[styles.connectionTitle, { color: theme.colors.text }]}>PAPER 서버 연결이 필요합니다</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{notConfigured}</Text><NusaButton label="설정에서 연결" onPress={onGoSettings} testID="dashboard-open-settings" /></View> : null}

    <View style={[styles.dashboard, tablet && styles.dashboardTablet]}>
      <View style={styles.primaryColumn}>
        {snapshot ? <MotionReveal testID="home-hero-reveal"><View style={[styles.hero, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.layout.heroRadius, paddingHorizontal: theme.layout.screenPadding }]} testID="account-hero-card"><View style={styles.heroTopline}><View><Text style={[styles.balanceLabel, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text><Text style={[styles.heroState, { color: signalReady ? theme.colors.success : theme.colors.warning }]}>{signalReady ? "PAPER READY" : "PAPER CHECK"}</Text></View><View style={[styles.heroLiveDot, { backgroundColor: signalReady ? theme.colors.success : theme.colors.warning }]} /></View><Text style={[styles.balance, tablet && styles.balanceTablet, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text><View style={styles.heroMeta}>{totalPnl != null ? <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text> : null}<Text style={[styles.metaText, { color: theme.colors.textMuted }]}>누적 손익</Text><View style={[styles.metaDot, { backgroundColor: theme.colors.borderStrong }]} /><Text style={[styles.metaText, { color: theme.colors.textMuted }]}>{snapshot.readyForPaperOperations ? "실행 전 안전 게이트 통과" : "안전 게이트 점검 필요"}</Text></View><TerrainSignal variant="symbolic" signalStrength={signalReady ? 0.9 : 0.35} accessibilityLabel={`PAPER 상태 신호: ${signalReady ? "준비됨" : "점검 필요"}`} testID="home-signal-trace" /></View></MotionReveal> : null}
        <View style={styles.nextAction} testID="home-next-action"><View style={[styles.nextActionCopy, styles.column]}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{nextAction.title}</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text></View><NusaButton label={nextAction.title} onPress={runNextAction} testID="home-next-action-button" /></View>
        <View style={styles.grid}><MetricTile label="PAPER 연결" value={snapshot?.operations.transport ?? "UNKNOWN"} detail="PAPER 데이터" tone={snapshot?.operations.transport === "ONLINE" ? "success" : "warning"} /><MetricTile label="PAPER 준비" value={snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"} detail="안전 게이트" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} /><MetricTile label="AI 신뢰도" value={aiTrustedConfidence} detail="AI READ-ONLY" tone="info" /></View>
        {snapshot && allocation ? <View style={styles.allocation} testID="home-allocation-panel"><View style={styles.allocationHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현금 배분</Text></View><Text style={[styles.allocationRatio, { color: theme.colors.primary }]}>{allocation.investmentPercent}%</Text></View><View style={[styles.rail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationSplit}><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>투자 가능</Text><Text testID="home-investable-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.investableCash)}</Text></View><View style={[styles.splitDivider, { backgroundColor: theme.colors.border }]} /><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="home-reserved-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.reservedCash)}</Text></View></View></View> : null}
      </View>

      {snapshot ? <View style={[styles.secondaryColumn, tablet && styles.secondaryColumnTablet]}>
        <AIInsight thesis={ai?.thesis ?? null} evidenceCount={ai?.evidenceReferences.length ?? 0} confidence={ai?.calibrationStatus === "CALIBRATED" ? aiTrustedConfidence : undefined} onPress={() => onNavigate("AiSignal")} testID="ai-card" />
        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
        {/* SafetyNotice keeps the canonical label="LIVE 권한" and label="Production mutation" rows visible. */}
        <SafetyNotice health={snapshot.health} runtimeState={snapshot.operations.runtimeState} killSwitchActive={snapshot.dashboard.killSwitchActive} liveAuthority={snapshot.liveAuthority} productionMutationAllowed={snapshot.productionMutationAllowed} testID="safety-card" />
      </View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 22, paddingBottom: 44, width: "100%", maxWidth: 920, alignSelf: "center" }, contentTablet: { maxWidth: 1280, paddingHorizontal: 32, paddingTop: 24, gap: 26 },
  dashboard: { gap: 22 }, dashboardTablet: { flexDirection: "row", alignItems: "flex-start", gap: 32 }, primaryColumn: { flex: 1, minWidth: 0, gap: 22 }, secondaryColumn: { gap: 22 }, secondaryColumnTablet: { flex: 0.72, minWidth: 300, maxWidth: 460, paddingLeft: 28 },
  topline: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, toplineRight: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, kicker: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.35 },
  connection: { gap: 12, paddingVertical: 12 }, connectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20 },
  hero: { minHeight: 300, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6, borderWidth: 1, borderRadius: 22, overflow: "hidden" }, heroTopline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, balanceLabel: { fontSize: 10, lineHeight: 16, fontWeight: "800", letterSpacing: 1.7 }, heroState: { marginTop: 4, fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.9 }, heroLiveDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 }, balance: { marginTop: 12, fontSize: 52, lineHeight: 59, fontWeight: "800", letterSpacing: -2.5, fontVariant: ["tabular-nums"] }, balanceTablet: { fontSize: 62, lineHeight: 69 }, heroMeta: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, pnl: { fontSize: 16, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }, metaText: { fontSize: 12, lineHeight: 18, fontWeight: "600" }, metaDot: { width: 3, height: 3, borderRadius: 2 },
  allocation: { gap: 13, paddingVertical: 4 }, allocationHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }, sectionTitle: { marginTop: 3, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.45 }, allocationRatio: { fontSize: 20, lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] }, rail: { height: 6, borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 }, allocationSplit: { flexDirection: "row", alignItems: "stretch", gap: 16 }, allocationCell: { flex: 1 }, splitDivider: { width: StyleSheet.hairlineWidth }, valueLabel: { fontSize: 11, lineHeight: 16, fontWeight: "600" }, value: { marginTop: 4, fontSize: 20, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, column: { flexGrow: 1, flexBasis: 440 }, nextAction: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", paddingVertical: 4 }, nextActionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  insight: { gap: 14, paddingVertical: 4 }, insightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, insightBadges: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, thesis: { fontSize: 21, lineHeight: 31, fontWeight: "700", letterSpacing: -0.45 }, insightFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, divider: { height: StyleSheet.hairlineWidth }, operations: { gap: 8 }, operationsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 },
});
