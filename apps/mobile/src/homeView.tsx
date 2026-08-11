import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
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
  const aiRawProbability = ai?.rawProbability == null || !Number.isFinite(ai.rawProbability) ? "-" : `${Math.round(ai.rawProbability * 100)}%`;
  const aiTrustedConfidence = ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "-";
  const runtimeTone = healthTone(snapshot?.operations.runtimeState);
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const nextAction = snapshot == null ? null : snapshot.health !== "HEALTHY" || snapshot.dashboard.killSwitchActive || !snapshot.readyForPaperOperations ? { title: "안전 상태를 먼저 확인하세요", detail: "차단·저하 또는 PAPER 운영 대기 상태에서는 주문보다 운영 상태 확인이 우선입니다.", label: "PAPER 상태 보기", destination: "Trade" as const, tone: "warning" as const } : aiInsightAvailable ? { title: "최신 AI 분석이 있습니다", detail: "검증된 분석과 근거를 읽기 전용으로 확인할 수 있습니다.", label: "AI 분석 보기", destination: "More" as const, tone: "info" as const } : { title: "시장 관찰을 이어가세요", detail: "AI 분석이 없을 때는 수신된 시장 데이터와 연결 상태부터 확인합니다.", label: "시장 보기", destination: "Markets" as const, tone: "primary" as const };

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <ScreenHeader eyebrow="PERSONAL PAPER" title="홈" description="PAPER 계정, 투자 가능 현금과 다음 행동을 우선순위대로 보여줍니다." statusLabel={snapshot?.health ?? (notConfigured ? "연결 필요" : "대기")} statusTone={snapshot ? healthTone(snapshot.health) : "warning"} />
    {readOnlyError ? <InlineNotice title="PAPER 서버 연결 오류" detail={readOnlyError} tone="danger" /> : null}
    {notConfigured ? <NusaCard testID="dashboard-session-card" raised><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>PAPER CONNECTION</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>서버 연결이 필요합니다</Text></View><StatusChip label="설정 필요" tone="warning" /></View><Text style={[styles.body, { color: theme.colors.textMuted }]}>{notConfigured}</Text><NusaButton label="설정에서 PAPER 연결" onPress={onGoSettings} testID="dashboard-open-settings" /></NusaCard> : null}
    {snapshot ? <>
      <View style={styles.hero} testID="account-hero-card"><View style={styles.heroTop}><View><Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text><Text style={[styles.heroValue, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text></View><StatusChip label={snapshot.operations.runtimeState} tone={runtimeTone} /></View>{totalPnl != null ? <Text style={[styles.heroPnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)} 누적 손익</Text> : null}</View>
      <View style={styles.metrics}>
        <MetricTile label="투자 가능 현금" value={allocation ? krw(allocation.investableCash) : "-"} detail={allocation ? `${allocation.investmentPercent}% 신규 매수 한도` : "계정 정보 없음"} tone="primary" testID="home-investable-cash" />
        <MetricTile label="미투자 보호 현금" value={allocation ? krw(allocation.reservedCash) : "-"} detail={allocation ? `${allocation.reservePercent}% 보호` : "계정 정보 없음"} tone="info" testID="home-reserved-cash" />
        <MetricTile label="PAPER 준비" value={snapshot.readyForPaperOperations ? "준비됨" : "대기/차단"} detail="주문 가능 상태" tone={snapshot.readyForPaperOperations ? "success" : "warning"} />
        <MetricTile label="AI 신뢰도" value={aiTrustedConfidence} detail={ai?.calibrationStatus ?? "UNKNOWN"} tone={ai?.calibrationStatus === "CALIBRATED" ? "info" : "default"} />
      </View>
      {allocation && allocation.reservePercent > 0 ? <InlineNotice title={`${allocation.reservePercent}% 현금 보호 중`} detail={`${krw(allocation.reservedCash)}는 신규 매수에 사용하지 않습니다. 비중은 Settings에서 변경할 수 있습니다.`} tone="info" testID="home-allocation-notice" /> : null}
      {nextAction ? <InlineNotice title={nextAction.title} detail={nextAction.detail} tone={nextAction.tone === "primary" ? "info" : nextAction.tone} testID="home-next-action-notice" /> : null}
      {nextAction ? <NusaButton accessibilityLabel={nextAction.label} label={nextAction.label} onPress={() => onNavigate(nextAction.destination)} testID="home-next-action-button" /> : null}
      <View style={styles.grid} testID="home-responsive-grid"><View style={styles.column}><NusaCard testID="ai-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.info }]}>AI READ-ONLY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>AI 인텔리전스</Text></View><StatusChip label={ai?.status ?? "UNAVAILABLE"} tone={ai?.status === "AVAILABLE" ? "success" : ai?.status === "INCOMPLETE" ? "warning" : "neutral"} /></View><Text style={[styles.thesis, { color: ai?.thesis ? theme.colors.text : theme.colors.textMuted }]}>{ai?.thesis ?? "현재 표시할 AI 분석이 없습니다."}</Text><DataRow label="원시 모델 확률" value={aiRawProbability} /><DataRow label="검증 신뢰도" value={aiTrustedConfidence} /><DataRow label="불확실성" value={ai?.uncertainty ?? "-"} /><NusaButton label="AI 자세히 보기" onPress={() => onNavigate("More")} tone="neutral" /></NusaCard></View><View style={styles.column}><NusaCard testID="safety-card"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>SAFETY</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>운영 상태</Text></View><StatusChip label={snapshot.health} tone={healthTone(snapshot.health)} /></View><DataRow label="PAPER 런타임" value={snapshot.operations.runtimeState} tone={runtimeTone} /><DataRow label="킬 스위치" value={snapshot.dashboard.killSwitchActive ? "활성" : "비활성"} tone={snapshot.dashboard.killSwitchActive ? "danger" : "success"} /><DataRow label="LIVE 권한" value={snapshot.liveAuthority} emphasis /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /><NusaButton label="PAPER 작업공간" onPress={() => onNavigate("Trade")} tone="neutral" /></NusaCard></View></View>
    </> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 16, paddingBottom: 36, width: "100%", maxWidth: 1080, alignSelf: "center" }, hero: { paddingVertical: 8, gap: 6 }, heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, heroLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, heroValue: { marginTop: 5, fontSize: 42, lineHeight: 49, fontWeight: "800", letterSpacing: -1.8, fontVariant: ["tabular-nums"] }, heroPnl: { fontSize: 15, lineHeight: 21, fontWeight: "700", fontVariant: ["tabular-nums"] }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }, column: { flexGrow: 1, flexBasis: 440 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, thesis: { fontSize: 16, fontWeight: "600", lineHeight: 24, marginBottom: 10 }, body: { fontSize: 13, lineHeight: 20, marginTop: 8 } });
