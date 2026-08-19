import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
import { CompactMetric, InsightPanel, OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";
interface HomeViewProps { readonly snapshot: Snapshot | null; readonly investmentPercent: number; readonly readOnlyError: string | null; readonly notConfigured: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly onGoSettings: () => void; readonly onNavigate: (destination: HomeDestination) => void; }
function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" { return health === "HEALTHY" || health === "READY" || health === "ONLINE" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning"; }

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onGoSettings, onNavigate }: HomeViewProps) {
  const { theme } = useTheme();
  const profile = getHomeVisualProfile(theme.preset);
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const account = snapshot?.portfolio?.account ?? null;
  const allocation = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : undefined;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const statusLabel = snapshot ? `PAPER · ${signalReady ? "READY" : snapshot.health}` : notConfigured ? "PAPER · 연결 필요" : "PAPER · 대기";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = snapshot ? `PAPER 상태 신호: ${signalReady ? "준비됨" : "점검 필요"}` : "PAPER 상태 신호: 연결 데이터 없음";
  const terrainState = signalReady ? "CONVERGED" : snapshot ? "OBSERVING" : "NO INPUT";
  const sourceState = snapshot ? "PAPER" : "NO INPUT";
  const gateState = snapshot ? (snapshot.readyForPaperOperations ? "PASS" : "CHECK") : "WAIT";
  const aiState = aiInsightAvailable ? "VERIFIED" : "NONE";
  const nextAction = notConfigured
    ? { title: "설정에서 연결", detail: "PAPER 연결을 검증합니다.", destination: null }
    : snapshot?.health !== "HEALTHY" || snapshot?.dashboard.killSwitchActive || !snapshot?.readyForPaperOperations
      ? { title: "시장 상태 보기", detail: "연결과 안전 상태를 먼저 확인합니다.", destination: "Markets" as const }
      : aiInsightAvailable
        ? { title: "AI 분석 보기", detail: "검증된 읽기 전용 분석으로 이동합니다.", destination: "AiSignal" as const }
        : { title: "시장 보기", detail: "검증된 시장 데이터를 확인합니다.", destination: "Markets" as const };
  const runNextAction = () => { if (nextAction.destination === null) onGoSettings(); else onNavigate(nextAction.destination); };
  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: Math.max(10, profile.screen.topPadding - 6),
    gap: 0,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? profile.hero.tabletBalanceSize : profile.hero.balanceSize,
    lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : profile.hero.balanceLineHeight,
    letterSpacing: profile.hero.balanceLetterSpacing,
    color: theme.colors.text,
  } as const;
  const notice = readOnlyError
    ? { title: "PAPER 서버 연결 오류", detail: readOnlyError, tone: "danger" as const, actionLabel: undefined }
    : notConfigured
      ? { title: "PAPER 연결이 필요합니다", detail: "Settings에서 PAPER 연결을 검증하면 실제 계정 데이터가 표시됩니다.", tone: "warning" as const, actionLabel: "설정" }
      : null;

  return <ScrollView contentContainerStyle={[styles.content, contentStyle]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <View style={[styles.wordmarkHeader, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.brandLockup}>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.systemLabel, { color: theme.colors.textMuted }]}>PAPER CONTROL</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.equitySection, { borderBottomColor: theme.colors.border }]} testID="account-hero-card">
        <View style={styles.sectionTopline}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text>
          <Text style={[styles.heroMode, { color: account ? theme.colors.textMuted : theme.colors.warning }]}>{account ? "PAPER ACTUAL" : "DATA OFFLINE"}</Text>
        </View>
        {account ? <>
          <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{krw(account.equity)}</Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>실제 누적 손익</Text>
          </View>
        </> : <View style={styles.unavailableHero}>
          <Text style={[styles.unavailableValue, { color: theme.colors.text }]}>EQUITY UNAVAILABLE</Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>연결 검증 전 · 숫자 표시 안 함</Text>
        </View>}
      </View>
    </MotionReveal>

    <InsightPanel
      title={aiInsightAvailable ? "검증된 분석" : "NO VERIFIED JUDGEMENT"}
      thesis={aiInsightAvailable ? ai?.thesis ?? "" : "검증된 근거 없음 · AI는 읽기 전용으로 대기합니다."}
      meta={aiInsightAvailable ? `ZERO AUTHORITY · EVIDENCE ${ai?.evidenceReferences.length ?? 0}` : "ZERO AUTHORITY · EVIDENCE 0"}
      confidenceLabel={calibratedConfidence}
      actionLabel={aiInsightAvailable ? "AI 보기" : undefined}
      onAction={aiInsightAvailable ? () => onNavigate("AiSignal") : undefined}
      testID="ai-card"
    />

    <View style={[styles.terrainSection, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.terrainHeader}>
        <View>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>TERRAIN SIGNAL</Text>
          <Text style={[styles.terrainTitle, { color: theme.colors.text }]}>판단 지형</Text>
        </View>
        <View style={styles.terrainStatusBlock}>
          <Text style={[styles.terrainState, { color: signalReady ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{terrainState}</Text>
          <Text style={[styles.terrainSubstate, { color: theme.colors.textMuted }]}>SYSTEM FIELD</Text>
        </View>
      </View>
      <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
      <View style={[styles.signalRail, { borderTopColor: theme.colors.border }]}>
        <View style={styles.signalDatum}><Text style={[styles.signalDatumLabel, { color: theme.colors.textMuted }]}>SOURCE</Text><Text style={[styles.signalDatumValue, { color: snapshot ? theme.colors.text : theme.colors.textMuted }]}>{sourceState}</Text></View>
        <View style={[styles.signalDatum, styles.signalDatumMiddle, { borderLeftColor: theme.colors.border, borderRightColor: theme.colors.border }]}><Text style={[styles.signalDatumLabel, { color: theme.colors.textMuted }]}>GATE</Text><Text style={[styles.signalDatumValue, { color: signalReady ? theme.colors.success : theme.colors.textMuted }]}>{gateState}</Text></View>
        <View style={styles.signalDatum}><Text style={[styles.signalDatumLabel, { color: theme.colors.textMuted }]}>AI</Text><Text style={[styles.signalDatumValue, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{aiState}</Text></View>
      </View>
    </View>

    <View style={styles.metricsSection} testID="safety-card">
      <View style={styles.metricsTopline}><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PRIMARY INDICATORS</Text><Text style={[styles.metricsCount, { color: theme.colors.textMuted }]}>03 CORE</Text></View>
      <CompactMetric label="PAPER 연결" value={snapshot?.operations.transport ?? "OFFLINE"} detail="DATA PATH" tone={snapshot?.operations.transport === "ONLINE" ? "success" : "warning"} />
      <CompactMetric label="안전 게이트" value={snapshot?.readyForPaperOperations ? "PASS" : snapshot ? "CHECK" : "WAIT"} detail="PAPER READY" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} />
      <CompactMetric label="AI 분석" value={aiInsightAvailable ? "VERIFIED" : "NONE"} detail="ZERO AUTHORITY" tone={aiInsightAvailable ? "info" : "default"} />
      {snapshot ? <CompactMetric label="LIVE 권한" value={snapshot.liveAuthority} detail="AUTHORITY" tone={snapshot.liveAuthority === "NONE" ? "success" : "danger"} /> : null}
      {snapshot ? <CompactMetric label="Production mutation" value={snapshot.productionMutationAllowed ? "허용" : "금지"} detail="MUTATION" tone={snapshot.productionMutationAllowed ? "danger" : "success"} /> : null}
    </View>

    {allocation ? <View style={[styles.capitalSection, { borderTopColor: theme.colors.border }]} testID="home-allocation-panel">
      <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>CAPITAL ENVELOPE · {allocation.investmentPercent}%</Text>
      <CompactMetric label="투자 가능" value={krw(allocation.investableCash)} testID="home-investable-cash" />
      <CompactMetric label="보호 현금" value={krw(allocation.reservedCash)} testID="home-reserved-cash" />
    </View> : null}

    {notice ? <OperationalNotice title={notice.title} detail={notice.detail} tone={notice.tone} actionLabel={notice.actionLabel} onAction={notice.actionLabel ? onGoSettings : undefined} testID={notConfigured ? "dashboard-session-card" : "home-operational-notice"} actionTestID={notConfigured ? "dashboard-open-settings" : undefined} /> : null}

    <View style={styles.nextAction} testID="home-next-action">
      <View style={styles.nextActionCopy}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text>
        <Text style={[styles.nextActionDetail, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={runNextAction} style={({ pressed }) => [styles.nextActionButton, { borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-next-action-button">
        <Text style={[styles.nextActionLabel, { color: theme.colors.text }]}>{nextAction.title}</Text>
      </Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  wordmarkHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  brandLockup: { flexDirection: "row", alignItems: "baseline", gap: 9 },
  wordmark: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: 2.2 },
  systemLabel: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1.45 },
  equitySection: { minHeight: 126, justifyContent: "center", gap: 7, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 15 },
  sectionTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  kicker: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.7 },
  heroMode: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1.2 },
  balance: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  unavailableHero: { gap: 5, paddingTop: 3 },
  unavailableValue: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.45 },
  pnlRow: { minHeight: 22, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  pnlValue: { fontSize: 14, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 10, lineHeight: 15 },
  terrainSection: { borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 14, paddingBottom: 0 },
  terrainHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  terrainTitle: { marginTop: 3, fontSize: 21, lineHeight: 27, fontWeight: "700", letterSpacing: -0.55 },
  terrainStatusBlock: { alignItems: "flex-end", gap: 1 },
  terrainState: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.4 },
  terrainSubstate: { fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: 1.1 },
  signalRail: { minHeight: 50, flexDirection: "row", alignItems: "stretch", borderTopWidth: StyleSheet.hairlineWidth },
  signalDatum: { flex: 1, minWidth: 0, justifyContent: "center", gap: 2, paddingHorizontal: 9 },
  signalDatumMiddle: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  signalDatumLabel: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 1.2 },
  signalDatumValue: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.65 },
  metricsSection: { gap: 0, paddingTop: 15 },
  metricsTopline: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  metricsCount: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 1.1 },
  capitalSection: { gap: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  nextAction: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 },
  nextActionCopy: { flex: 1, minWidth: 0, gap: 3 },
  nextActionDetail: { fontSize: 11, lineHeight: 16 },
  nextActionButton: { minHeight: 44, minWidth: 44, maxWidth: "48%", justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 5, paddingHorizontal: 11 },
  nextActionLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
