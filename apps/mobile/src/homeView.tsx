import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DataRow, MotionReveal, NusaButton, StatusChip, TerrainSignal } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";
interface HomeViewProps { readonly snapshot: Snapshot | null; readonly investmentPercent: number; readonly readOnlyError: string | null; readonly notConfigured: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onGoSettings: () => void; readonly onNavigate: (destination: HomeDestination) => void; }
function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" { return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning"; }

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onGoSettings, onNavigate }: HomeViewProps) {
  const { theme } = useTheme();
  const profile = getHomeVisualProfile(theme.preset);
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

  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    gap: profile.screen.sectionGap,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 1120) : profile.screen.maxWidth,
  } as const;
  const heroStyle = {
    minHeight: profile.hero.minHeight,
    paddingHorizontal: profile.hero.horizontalPadding,
    paddingTop: profile.hero.topPadding,
    paddingBottom: profile.hero.bottomPadding,
    borderRadius: profile.hero.radius,
    borderWidth: profile.hero.borderWidth,
    backgroundColor: theme.preset === "master" ? theme.colors.surfaceRaised : theme.colors.surface,
    borderColor: theme.colors.border,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? profile.hero.tabletBalanceSize : profile.hero.balanceSize,
    lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : profile.hero.balanceLineHeight,
    letterSpacing: profile.hero.balanceLetterSpacing,
    color: theme.colors.text,
  } as const;

  return <ScrollView contentContainerStyle={[styles.content, contentStyle]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <ScreenHeader eyebrow="NUSA ISLAND" title="홈" description="자산 상태와 지금 필요한 한 가지 행동을 확인합니다." statusLabel={snapshot?.health ?? "미연결"} statusTone={snapshot ? healthTone(snapshot.health) : "neutral"} />
    <View style={styles.topline}><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>PAPER ONLY</Text><View style={styles.toplineRight}><StatusChip label={snapshot?.health ?? (notConfigured ? "연결 필요" : "대기")} tone={snapshot ? healthTone(snapshot.health) : "warning"} /><StatusChip label="LIVE NONE" tone="neutral" /></View></View>
    {readOnlyError ? <InlineNotice title="PAPER 서버 연결 오류" detail={readOnlyError} tone="danger" /> : null}
    {notConfigured ? <View style={[styles.connection, { gap: profile.density.sectionGap }]} testID="dashboard-session-card"><Text style={[styles.connectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>PAPER 서버 연결이 필요합니다</Text><Text style={[styles.body, { color: theme.colors.textMuted, fontSize: profile.type.body, lineHeight: profile.type.bodyLineHeight }]}>{notConfigured}</Text><NusaButton label="설정에서 연결" onPress={onGoSettings} testID="dashboard-open-settings" /></View> : null}

    <View style={[styles.dashboard, { gap: tablet ? profile.dashboard.tabletGap : profile.dashboard.gap }, tablet && styles.dashboardTablet]} testID={`home-visual-${theme.preset}`}>
      <View style={[styles.primaryColumn, { gap: profile.density.contentGap }]}>
        {snapshot ? <MotionReveal testID="home-hero-reveal"><View style={[styles.hero, heroStyle]} testID="account-hero-card"><View style={styles.heroTopline}><View><Text style={[styles.balanceLabel, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>TOTAL EQUITY</Text><Text style={[styles.heroState, { color: signalReady ? theme.colors.success : theme.colors.warning }]}>{signalReady ? "PAPER READY" : "PAPER CHECK"}</Text></View><View style={[styles.heroLiveDot, { backgroundColor: signalReady ? theme.colors.success : theme.colors.warning }]} /></View><Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text><View style={styles.heroMeta}>{totalPnl != null ? <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text> : null}<Text style={[styles.metaText, { color: theme.colors.textMuted, fontSize: profile.type.meta }]}>누적 손익</Text><View style={[styles.metaDot, { backgroundColor: theme.colors.borderStrong }]} /><Text style={[styles.metaText, { color: theme.colors.textMuted, fontSize: profile.type.meta }]}>{snapshot.readyForPaperOperations ? "실행 전 안전 게이트 통과" : "안전 게이트 점검 필요"}</Text></View><TerrainSignal variant="symbolic" signalStrength={signalReady ? 0.9 : 0.35} accessibilityLabel={`PAPER 상태 신호: ${signalReady ? "준비됨" : "점검 필요"}`} testID="home-signal-trace" /></View></MotionReveal> : null}

        {theme.preset === "master" && snapshot && allocation ? <View style={[styles.allocation, { gap: profile.density.sectionGap, paddingVertical: profile.density.compactPadding }]} testID="home-allocation-panel"><View style={styles.allocationHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>현금 배분</Text></View><Text style={[styles.allocationRatio, { color: theme.colors.primary, fontSize: profile.type.sectionTitle }]}>{allocation.investmentPercent}%</Text></View><View style={[styles.rail, { height: profile.density.railHeight, backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationSplit}><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>투자 가능</Text><Text testID="home-investable-cash" style={[styles.value, { color: theme.colors.text, fontSize: profile.type.value, lineHeight: profile.type.valueLineHeight }]}>{krw(allocation.investableCash)}</Text></View><View style={[styles.splitDivider, { backgroundColor: theme.colors.border }]} /><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="home-reserved-cash" style={[styles.value, { color: theme.colors.text, fontSize: profile.type.value, lineHeight: profile.type.valueLineHeight }]}>{krw(allocation.reservedCash)}</Text></View></View></View> : null}

        <View style={[styles.grid, { gap: profile.density.metricGap }]}><MetricTile label="PAPER 연결" value={snapshot?.operations.transport ?? "UNKNOWN"} detail="PAPER 데이터" tone={snapshot?.operations.transport === "ONLINE" ? "success" : "warning"} /><MetricTile label="PAPER 준비" value={snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"} detail="안전 게이트" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} /><MetricTile label="AI 신뢰도" value={aiTrustedConfidence} detail="AI READ-ONLY" tone="info" /></View>

        <View style={[styles.nextAction, { gap: profile.density.sectionGap, paddingVertical: profile.density.compactPadding }]} testID="home-next-action"><View style={[styles.nextActionCopy, styles.column]}><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>NEXT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>{nextAction.title}</Text><Text style={[styles.body, { color: theme.colors.textMuted, fontSize: profile.type.body, lineHeight: profile.type.bodyLineHeight }]}>{nextAction.detail}</Text></View><NusaButton label={nextAction.title} onPress={runNextAction} testID="home-next-action-button" /></View>

        {theme.preset === "classic" && snapshot && allocation ? <View style={[styles.allocation, { gap: profile.density.sectionGap, paddingVertical: profile.density.compactPadding }]} testID="home-allocation-panel"><View style={styles.allocationHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>CASH ALLOCATION</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>현금 배분</Text></View><Text style={[styles.allocationRatio, { color: theme.colors.primary, fontSize: profile.type.sectionTitle }]}>{allocation.investmentPercent}%</Text></View><View style={[styles.rail, { height: profile.density.railHeight, backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationSplit}><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>투자 가능</Text><Text testID="home-investable-cash" style={[styles.value, { color: theme.colors.text, fontSize: profile.type.value, lineHeight: profile.type.valueLineHeight }]}>{krw(allocation.investableCash)}</Text></View><View style={[styles.splitDivider, { backgroundColor: theme.colors.border }]} /><View style={styles.allocationCell}><Text style={[styles.valueLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="home-reserved-cash" style={[styles.value, { color: theme.colors.text, fontSize: profile.type.value, lineHeight: profile.type.valueLineHeight }]}>{krw(allocation.reservedCash)}</Text></View></View></View> : null}
      </View>

      {snapshot ? <View style={[styles.secondaryColumn, { gap: profile.density.contentGap }, tablet && styles.secondaryColumnTablet, tablet && { paddingLeft: profile.dashboard.secondaryPaddingLeft }]}>
        {theme.preset === "master" ? <><View style={styles.operations} testID="safety-card"><View style={styles.operationsHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>SYSTEM</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>운영 상태</Text></View><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={healthTone(snapshot.operations.runtimeState)} /><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></View><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /></> : null}
        <View style={[styles.insight, { gap: profile.density.sectionGap }]} testID="ai-card"><View style={styles.insightHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>AI INSIGHT</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>오늘의 분석</Text></View><View style={styles.insightBadges}><StatusChip label="READ ONLY" tone="info" />{ai?.calibrationStatus === "CALIBRATED" ? <StatusChip label={aiTrustedConfidence} tone="info" /> : null}</View></View><Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted, fontSize: profile.type.thesis, lineHeight: profile.type.thesisLineHeight }]} numberOfLines={tablet ? 6 : 4}>{ai?.thesis ?? "현재 표시할 검증된 AI 분석이 없습니다."}</Text><View style={styles.insightFooter}><Text style={[styles.metaText, { color: theme.colors.textMuted, fontSize: profile.type.meta }]}>{aiInsightAvailable ? `근거 ${ai?.evidenceReferences.length ?? 0}개` : "검증된 근거 없음"}</Text><NusaButton label="AI 보기" onPress={() => onNavigate("AiSignal")} tone="neutral" /></View></View>
        {theme.preset === "classic" ? <><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><View style={styles.operations} testID="safety-card"><View style={styles.operationsHeader}><View><Text style={[styles.kicker, { color: theme.colors.textMuted, fontSize: profile.type.kicker }]}>SYSTEM</Text><Text style={[styles.sectionTitle, { color: theme.colors.text, fontSize: profile.type.sectionTitle, lineHeight: profile.type.sectionTitleLineHeight }]}>운영 상태</Text></View><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={healthTone(snapshot.operations.runtimeState)} /><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></View></> : null}
      </View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  dashboard: {}, dashboardTablet: { flexDirection: "row", alignItems: "flex-start" }, primaryColumn: { flex: 1, minWidth: 0 }, secondaryColumn: {}, secondaryColumnTablet: { flex: 0.72, minWidth: 300, maxWidth: 460 },
  topline: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, toplineRight: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, kicker: { lineHeight: 15, fontWeight: "800", letterSpacing: 1.35 },
  connection: { paddingVertical: 12 }, connectionTitle: { fontWeight: "800", letterSpacing: -0.4 }, body: {},
  hero: { overflow: "hidden" }, heroTopline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, balanceLabel: { lineHeight: 16, fontWeight: "800", letterSpacing: 1.7 }, heroState: { marginTop: 4, fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.9 }, heroLiveDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 }, balance: { marginTop: 12, fontWeight: "800", fontVariant: ["tabular-nums"] }, heroMeta: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, pnl: { fontSize: 16, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }, metaText: { lineHeight: 18, fontWeight: "600" }, metaDot: { width: 3, height: 3, borderRadius: 2 },
  allocation: {}, allocationHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }, sectionTitle: { marginTop: 3, fontWeight: "800", letterSpacing: -0.45 }, allocationRatio: { lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] }, rail: { borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 }, allocationSplit: { flexDirection: "row", alignItems: "stretch", gap: 16 }, allocationCell: { flex: 1 }, splitDivider: { width: StyleSheet.hairlineWidth }, valueLabel: { fontSize: 11, lineHeight: 16, fontWeight: "600" }, value: { marginTop: 4, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap" }, column: { flexGrow: 1, flexBasis: 440 }, nextAction: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }, nextActionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  insight: { paddingVertical: 4 }, insightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, insightBadges: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }, thesis: { fontWeight: "700", letterSpacing: -0.45 }, insightFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, divider: { height: StyleSheet.hairlineWidth }, operations: { gap: 8 }, operationsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 },
});