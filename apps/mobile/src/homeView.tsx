import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, StatusChip } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
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
  const account = snapshot?.portfolio?.account ?? null;
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiTrustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const allocationWidth = allocation ? `${allocation.investmentPercent}%` as `${number}%` : "0%";
  const nextAction = snapshot?.health !== "HEALTHY" || snapshot?.dashboard.killSwitchActive || !snapshot?.readyForPaperOperations
    ? { title: "PAPER 상태 보기", detail: "연결과 안전 상태를 확인하세요.", tab: "Markets" as const }
    : aiInsightAvailable
      ? { title: "AI 분석 보기", detail: "검증된 읽기 전용 분석을 확인하세요.", tab: "More" as const }
      : { title: "시장 보기", detail: "검증된 시장 데이터를 확인하세요.", tab: "Markets" as const };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <ScreenHeader eyebrow="NUSA ISLAND" title="홈" description="자산 상태와 지금 필요한 한 가지 행동을 확인합니다." statusLabel={snapshot?.health ?? "미연결"} statusTone={snapshot ? healthTone(snapshot.health) : "neutral"} />
    <View style={styles.topline}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER ONLY</Text><View style={styles.toplineRight}><StatusChip label={snapshot?.health ?? (notConfigured ? "연결 필요" : "대기")} tone={snapshot ? healthTone(snapshot.health) : "warning"} /><StatusChip label="LIVE NONE" tone="neutral" /></View></View>

    {readOnlyError ? <InlineNotice title="PAPER 서버 연결 오류" detail={readOnlyError} tone="danger" /> : null}
    {notConfigured ? <View style={styles.connection} testID="dashboard-session-card"><Text style={[styles.connectionTitle, { color: theme.colors.text }]}>PAPER 서버 연결이 필요합니다</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{notConfigured}</Text><NusaButton label="설정에서 연결" onPress={onGoSettings} testID="dashboard-open-settings" /></View> : null}

    {snapshot ? <View style={styles.hero} testID="account-hero-card">
      <Text style={[styles.balanceLabel, { color: theme.colors.textMuted }]}>총 평가자산</Text>
      <Text style={[styles.balance, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text>
      <View style={styles.heroMeta}>
        {totalPnl != null ? <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text> : null}
        <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>누적 손익</Text>
        <View style={[styles.metaDot, { backgroundColor: theme.colors.borderStrong }]} />
        <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>{snapshot.readyForPaperOperations ? "PAPER 준비됨" : "PAPER 대기/차단"}</Text>
      </View>
    </View> : null}

    <View style={styles.nextAction} testID="home-next-action"><View style={styles.nextActionCopy}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{nextAction.title}</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text></View><NusaButton label={nextAction.title} onPress={() => onNavigate(nextAction.tab)} testID="home-next-action-button" /></View>

    <View style={styles.metricGrid}><MetricTile label="시장" value={snapshot?.operations.transport ?? "UNKNOWN"} detail="PAPER 데이터 연결" tone={snapshot?.operations.transport === "ONLINE" ? "success" : "warning"} /><MetricTile label="PAPER" value={snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"} detail="안전 게이트" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} /><MetricTile label="AI" value={aiTrustedConfidence} detail="READ ONLY" tone="info" /></View>

    {snapshot ? <>
      {allocation ? <View style={styles.allocation} testID="home-allocation-panel">
        <View style={styles.allocationHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현금 배분</Text></View><Text style={[styles.allocationRatio, { color: theme.colors.primary }]}>{allocation.investmentPercent}%</Text></View>
        <View style={[styles.rail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View>
        <View style={styles.allocationSplit}><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>투자 가능</Text><Text testID="home-investable-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.investableCash)}</Text></View><View style={[styles.splitDivider, { backgroundColor: theme.colors.border }]} /><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="home-reserved-cash" style={[styles.value, { color: theme.colors.text }]}>{krw(allocation.reservedCash)}</Text></View></View>
      </View> : null}

      <View style={styles.primaryActions}><NusaButton label="시장 보기" onPress={() => onNavigate("Markets")} tone="neutral" /><NusaButton label="PAPER 주문" onPress={() => onNavigate("Trade")} /></View>

      <View style={styles.insight} testID="ai-card">
        <View style={styles.insightHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>AI INSIGHT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>오늘의 분석</Text></View><View style={styles.insightBadges}><StatusChip label="READ ONLY" tone="info" />{ai?.calibrationStatus === "CALIBRATED" ? <StatusChip label={aiTrustedConfidence} tone="info" /> : null}</View></View>
        <Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]} numberOfLines={4}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text>
        <View style={styles.insightFooter}><Text style={[styles.metaText, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `근거 ${ai?.evidenceReferences.length ?? 0}개` : "검증된 근거 없음"}</Text><NusaButton label="AI 보기" onPress={() => onNavigate("More")} tone="neutral" /></View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
      <View style={styles.operations} testID="safety-card"><View style={styles.operationsHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SYSTEM</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>운영 상태</Text></View><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={healthTone(snapshot.operations.runtimeState)} /><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></View>
    </> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 22, paddingBottom: 44, width: "100%", maxWidth: 920, alignSelf: "center" },
  topline: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  toplineRight: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" },
  kicker: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.35 },
  connection: { gap: 12, paddingVertical: 12 }, connectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.4 }, body: { fontSize: 13, lineHeight: 20 },
  hero: { paddingTop: 8, paddingBottom: 4 }, balanceLabel: { fontSize: 12, lineHeight: 18, fontWeight: "600" }, balance: { marginTop: 6, fontSize: 48, lineHeight: 54, fontWeight: "800", letterSpacing: -2.2, fontVariant: ["tabular-nums"] }, heroMeta: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, pnl: { fontSize: 16, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }, metaText: { fontSize: 12, lineHeight: 18, fontWeight: "600" }, metaDot: { width: 3, height: 3, borderRadius: 2 },
  allocation: { gap: 13, paddingVertical: 4 }, allocationHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }, sectionTitle: { marginTop: 3, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.45 }, allocationRatio: { fontSize: 20, lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] }, rail: { height: 6, borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 }, allocationSplit: { flexDirection: "row", alignItems: "stretch", gap: 16 }, allocationCell: { flex: 1 }, splitDivider: { width: StyleSheet.hairlineWidth }, valueLabel: { fontSize: 11, lineHeight: 16, fontWeight: "600" }, value: { marginTop: 4, fontSize: 20, lineHeight: 27, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  nextAction: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", paddingVertical: 4 }, nextActionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  primaryActions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  insight: { gap: 14, paddingVertical: 4 }, insightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, insightBadges: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, thesis: { fontSize: 21, lineHeight: 31, fontWeight: "700", letterSpacing: -0.45 }, insightFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  divider: { height: StyleSheet.hairlineWidth }, operations: { gap: 8 }, operationsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 },
});
