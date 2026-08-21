import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
import { OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { getLocalPaperState, subscribeLocalPaper, type LocalPaperState } from "./localPaperStore";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";

interface HomeViewProps {
  readonly snapshot: Snapshot | null;
  readonly investmentPercent: number;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onGoSettings: () => void;
  readonly onNavigate: (destination: HomeDestination) => void;
}

function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(healthy: boolean): "success" | "warning" { return healthy ? "success" : "warning"; }

export function HomeView({ snapshot, investmentPercent, readOnlyError, refreshing, onRefresh, onGoSettings, onNavigate }: HomeViewProps) {
  const { theme } = useTheme();
  const profile = getHomeVisualProfile(theme.preset);
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [localState, setLocalState] = useState<LocalPaperState>(() => getLocalPaperState());
  useEffect(() => subscribeLocalPaper(setLocalState), []);

  const cloudAccount = snapshot?.portfolio?.account ?? null;
  const usingLocalPaper = cloudAccount === null;
  const account = cloudAccount ?? localState.portfolio.account;
  const cashEnvelope = createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const localReady = localState.markPrice != null;
  const cloudReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const signalReady = usingLocalPaper ? localReady : Boolean(cloudReady);
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = !usingLocalPaper && ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const statusLabel = usingLocalPaper ? `LOCAL PAPER · ${localReady ? "READY" : "시세 대기"}` : `PAPER · ${cloudReady ? "READY" : "점검 필요"}`;
  const terrainStrength = signalReady ? 0.92 : 0.3;
  const terrainLabel = aiInsightAvailable ? "NUSA 검증 분석 신호" : signalReady ? "NUSA 시장 분석 중" : "NUSA 시장 연결 대기";
  const contentStyle = { paddingHorizontal: profile.screen.horizontalPadding, paddingTop: profile.screen.topPadding, gap: tablet ? 18 : profile.screen.sectionGap, paddingBottom: profile.screen.bottomPadding, maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth } as const;
  const balanceStyle = { fontSize: tablet ? profile.hero.tabletBalanceSize : profile.hero.balanceSize, lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : profile.hero.balanceLineHeight, letterSpacing: profile.hero.balanceLetterSpacing, color: theme.colors.text } as const;

  return <ScrollView contentContainerStyle={[styles.content, contentStyle]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={usingLocalPaper ? () => undefined : onRefresh} />} testID="home-screen">
    <View style={styles.wordmarkHeader}><Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text><QuietStatus label={statusLabel} tone={healthTone(signalReady)} testID="home-paper-status" /></View>

    <MotionReveal testID="home-hero-reveal"><View style={styles.equity} testID="account-hero-card"><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>{usingLocalPaper ? "LOCAL PAPER EQUITY" : "PAPER EQUITY"}</Text><Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{krw(account.equity)}</Text><View style={styles.pnlRow}><Text style={[styles.pnl, { color: totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl >= 0 ? "+" : ""}{krw(totalPnl)}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>누적 PAPER 손익</Text></View><View style={[styles.cashRail, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation"><View style={styles.cashMetric} testID="home-investable-cash"><Text style={[styles.meta, { color: theme.colors.textMuted }]}>투자 가능 · {cashEnvelope.investmentPercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text></View><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><View style={styles.cashMetric} testID="home-reserved-cash"><Text style={[styles.meta, { color: theme.colors.textMuted }]}>보호 현금 · {cashEnvelope.reservePercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text></View></View></View></MotionReveal>

    <View testID="ai-card"><View style={[styles.signalStage, { borderColor: theme.colors.borderStrong }]} testID="home-decision-stage"><View style={styles.signalTop}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NUSA VIEW</Text><QuietStatus label={usingLocalPaper ? "ZERO AUTHORITY" : aiInsightAvailable ? "ANALYSIS" : "OBSERVE"} tone="info" /></View><View style={styles.terrain}><TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" /></View><View testID="home-pending-decision"><Text style={[styles.decision, { color: theme.colors.text }]}>{aiInsightAvailable ? ai?.thesis : usingLocalPaper ? "LOCAL PAPER 시장과 계좌 상태를 관찰 중입니다." : "검증된 판단을 기다리고 있습니다."}</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>AI는 주문 권한이 없으며 PAPER 실행과 분리됩니다.</Text></View></View></View>

    {usingLocalPaper ? <OperationalNotice title={localReady ? "LOCAL PAPER 사용 가능" : "Upbit 공개 시세를 기다리는 중"} detail={localReady ? "TRADE와 PORTFOLIO가 동일한 가상 원장을 사용합니다." : "공개 시세가 연결되면 PAPER 주문을 사용할 수 있습니다."} tone={localReady ? "success" : "warning"} testID="home-operational-notice" /> : readOnlyError ? <OperationalNotice title="Cloud PAPER 연결 확인 필요" detail={readOnlyError} tone="warning" actionLabel="설정" onAction={onGoSettings} testID="home-operational-notice" /> : null}

    <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => onNavigate("Markets")} style={[styles.action, { borderColor: theme.colors.border }]} testID="home-go-markets"><Text style={[styles.actionTitle, { color: theme.colors.text }]}>시장 보기</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>Upbit 공개 시세와 차트</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onNavigate("Portfolio")} style={[styles.action, { borderColor: theme.colors.border }]} testID="home-go-portfolio"><Text style={[styles.actionTitle, { color: theme.colors.text }]}>자산 보기</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>같은 PAPER 원장 확인</Text></Pressable>{aiInsightAvailable ? <Pressable accessibilityRole="button" onPress={() => onNavigate("AiSignal")} style={[styles.action, { borderColor: theme.colors.border }]} testID="home-go-ai"><Text style={[styles.actionTitle, { color: theme.colors.text }]}>분석 보기</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>검증된 AI 근거 확인</Text></Pressable> : null}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" }, wordmarkHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, wordmark: { fontSize: 18, lineHeight: 24, fontWeight: "900", letterSpacing: 2.2 }, equity: { gap: 8, paddingVertical: 8 }, kicker: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 }, balance: { fontWeight: "800", fontVariant: ["tabular-nums"] }, pnlRow: { flexDirection: "row", alignItems: "center", gap: 8 }, pnl: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] }, meta: { fontSize: 12, lineHeight: 18 }, cashRail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", alignItems: "stretch", gap: 14 }, cashMetric: { flex: 1, gap: 4 }, cashValue: { fontSize: 17, lineHeight: 23, fontWeight: "800" }, divider: { width: StyleSheet.hairlineWidth }, signalStage: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, padding: 16, gap: 12 }, signalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, terrain: { minHeight: 170 }, decision: { fontSize: 18, lineHeight: 26, fontWeight: "800" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, flexGrow: 1, flexBasis: 160, gap: 3 }, actionTitle: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
});
