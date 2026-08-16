import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DataRow, MotionReveal, NusaButton, StatusChip, TerrainSignal } from "./components";
import { InlineNotice, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>['snapshot'];
export type HomeDestination = "Markets" | "Trade" | "Portfolio" | "More";
interface HomeViewProps { readonly snapshot: Snapshot | null; readonly investmentPercent: number; readonly readOnlyError: string | null; readonly notConfigured: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onNavigate: (destination: HomeDestination) => void; }

function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" { return health === "HEALTHY" || health === "READY" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning"; }

function SignalMap({ snapshot, signalReady }: Readonly<{ snapshot: Snapshot | null; signalReady: boolean }>) {
  const { theme } = useTheme();
  const aiAvailable = snapshot?.ai?.status === "AVAILABLE" && Boolean(snapshot.ai.thesis?.trim()) && snapshot.ai.evidenceReferences.length > 0;
  return <View style={[styles.map, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="home-signal-map">
    <View style={styles.mapHeader}><Text style={[styles.mapLabel, { color: theme.colors.textMuted }]}>NUSA SIGNAL MAP</Text><Text style={[styles.mapState, { color: signalReady ? theme.colors.success : theme.colors.warning }]}>{signalReady ? "LIVE STATE" : "WAITING FOR DATA"}</Text></View>
    <TerrainSignal variant="symbolic" signalStrength={signalReady ? 0.9 : 0.28} accessibilityLabel={signalReady ? "현재 PAPER 상태를 표현하는 NUSA 시그널 지도" : "데이터 대기 중인 NUSA 시그널 지도"} testID="home-signal-trace" />
    <View style={styles.markerRail} accessibilityLabel="NUSA 상태 마커">
      <View style={styles.markerItem}><View style={[styles.marker, { backgroundColor: theme.colors.aiSignalStart }]} /><Text style={[styles.markerText, { color: theme.colors.textMuted }]}>STATE</Text><Text style={[styles.markerValue, { color: theme.colors.text }]}>{snapshot?.health ?? "—"}</Text></View>
      <View style={styles.markerItem}><View style={[styles.marker, { backgroundColor: theme.colors.aiSignalMid }]} /><Text style={[styles.markerText, { color: theme.colors.textMuted }]}>PAPER</Text><Text style={[styles.markerValue, { color: theme.colors.text }]}>{snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"}</Text></View>
      <View style={styles.markerItem}><View style={[styles.marker, { backgroundColor: aiAvailable ? theme.colors.aiSignalEnd : theme.colors.borderStrong }]} /><Text style={[styles.markerText, { color: theme.colors.textMuted }]}>AI</Text><Text style={[styles.markerValue, { color: theme.colors.text }]}>{aiAvailable ? "EVIDENCE" : "UNAVAILABLE"}</Text></View>
    </View>
  </View>;
}

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onNavigate }: HomeViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const account = snapshot?.portfolio?.account ?? null;
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const nextAction = notConfigured ? { title: "시장 보기", detail: "Cloud 없이 공개 시장 데이터를 확인합니다.", tab: "Markets" as const } : aiAvailable ? { title: "AI 보기", detail: "근거가 있는 읽기 전용 분석을 확인합니다.", tab: "More" as const } : { title: "시장 보기", detail: "현재 확인 가능한 시장 데이터를 봅니다.", tab: "Markets" as const };

  return <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <ScreenHeader eyebrow="NUSA / HOME" title="오늘의 PAPER 상태" description="핵심 상태와 신호를 한 화면에서 확인합니다." statusLabel={snapshot?.health ?? "연결 필요"} statusTone={snapshot ? healthTone(snapshot.health) : "neutral"} />
    {readOnlyError ? <InlineNotice title="PAPER 데이터를 표시할 수 없습니다" detail={readOnlyError} tone="danger" /> : null}
    {notConfigured ? <InlineNotice title="NUSA Cloud 연결 불가" detail="Home은 유지되며 공개 시장 데이터만 사용할 수 있습니다." tone="warning" testID="home-cloud-unavailable" /> : null}
    <MotionReveal testID="home-hero-reveal"><View style={[styles.hero, { borderBottomColor: theme.colors.border }]} testID="account-hero-card">
      <View style={styles.heroHeader}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>ACCOUNT EQUITY</Text><Text style={[styles.compactStatus, { color: signalReady ? theme.colors.success : theme.colors.warning }]}>PAPER · LIVE OFF</Text></View>
      <Text style={[styles.balance, tablet && styles.balanceTablet, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "—"}</Text>
      <View style={styles.heroMeta}>{totalPnl != null ? <Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text> : <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>손익 데이터 없음</Text>}<Text style={[styles.metaText, { color: theme.colors.textMuted }]}>오늘의 변화</Text></View>
      <SignalMap signalReady={signalReady} snapshot={snapshot} />
    </View></MotionReveal>
    <View style={[styles.actionRow, { borderBottomColor: theme.colors.border }]} testID="home-next-action"><View style={styles.actionCopy}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>NEXT ACTION</Text><Text style={[styles.actionTitle, { color: theme.colors.text }]}>{nextAction.title}</Text><Text style={[styles.body, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text></View><NusaButton label={nextAction.title} onPress={() => onNavigate(nextAction.tab)} testID="home-next-action-button" /></View>
    <View style={[styles.insight, { borderBottomColor: theme.colors.border }]} testID="ai-card"><View style={styles.insightHeader}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>AI INSIGHT</Text><StatusChip label="READ ONLY" tone="info" /></View><Text style={[styles.insightText, { color: aiAvailable ? theme.colors.text : theme.colors.textMuted }]} numberOfLines={3}>{aiAvailable ? ai?.thesis : "현재 표시할 검증된 AI 분석이 없습니다."}</Text><Text style={[styles.metaText, { color: theme.colors.textMuted }]}>{aiAvailable ? `근거 ${ai?.evidenceReferences.length ?? 0}개` : "근거 없음"}</Text></View>
    {allocation ? <View style={[styles.allocation, { borderBottomColor: theme.colors.border }]} testID="home-allocation-panel"><View style={styles.rowHeader}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>PRIMARY METRICS</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>현금 배분</Text></View><Text style={[styles.allocationRatio, { color: theme.colors.text }]}>{allocation.investmentPercent}%</Text></View><View style={[styles.rail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: `${allocation.investmentPercent}%`, backgroundColor: theme.colors.aiSignalMid }]} /></View><View style={styles.split}><DataRow label="투자 가능" value={krw(allocation.investableCash)} testID="home-investable-cash" /><DataRow label="보호 현금" value={krw(allocation.reservedCash)} testID="home-reserved-cash" /></View></View> : null}
    {snapshot ? <View style={[styles.safety, { borderBottomColor: theme.colors.border }]} testID="safety-card"><View style={styles.rowHeader}><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>SAFETY STATE</Text><StatusChip label="PAPER ONLY" tone="primary" /></View><DataRow label="LIVE 권한" value={snapshot.liveAuthority} /><DataRow label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} tone={snapshot.productionMutationAllowed ? "danger" : "success"} /></View> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 20, paddingBottom: 44, width: "100%", maxWidth: 920, alignSelf: "center" }, contentTablet: { maxWidth: 1160, paddingHorizontal: 40, paddingTop: 26, gap: 24 },
  hero: { gap: 12, paddingBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth }, heroHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.45 }, compactStatus: { fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.5 }, balance: { marginTop: 4, fontSize: 56, lineHeight: 64, fontWeight: "800", letterSpacing: -2.6, fontVariant: ["tabular-nums"] }, balanceTablet: { fontSize: 72, lineHeight: 80 }, heroMeta: { flexDirection: "row", alignItems: "baseline", gap: 9, flexWrap: "wrap" }, pnl: { fontSize: 18, lineHeight: 25, fontWeight: "800", fontVariant: ["tabular-nums"] }, metaText: { fontSize: 12, lineHeight: 18, fontWeight: "600" }, map: { minHeight: 224, borderWidth: 1, borderRadius: 18, padding: 16, overflow: "hidden" }, mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, mapLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }, mapState: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 }, markerRail: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 4 }, markerItem: { flexGrow: 1, flexBasis: 90, gap: 3 }, marker: { width: 6, height: 6, borderRadius: 3, marginBottom: 2 }, markerText: { fontSize: 9, fontWeight: "800", letterSpacing: 1 }, markerValue: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }, actionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth }, actionCopy: { flex: 1, minWidth: 180, gap: 4 }, actionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.5 }, body: { fontSize: 13, lineHeight: 20 }, insight: { gap: 10, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth }, insightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, insightText: { fontSize: 19, lineHeight: 28, fontWeight: "700", letterSpacing: -0.35 }, allocation: { gap: 12, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth }, safety: { gap: 4, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth }, rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }, sectionTitle: { marginTop: 3, fontSize: 20, lineHeight: 26, fontWeight: "800", letterSpacing: -0.4 }, allocationRatio: { fontSize: 22, lineHeight: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }, rail: { height: 6, borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 }, split: { gap: 2 },
});
