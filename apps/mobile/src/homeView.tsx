import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
import { OperationalNotice, QuietStatus } from "./uxPrimitives";
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
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const statusLabel = snapshot ? `PAPER · ${signalReady ? "READY" : snapshot.health}` : notConfigured ? "PAPER · 연결 필요" : "PAPER · 대기";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = snapshot ? `PAPER 상태 신호: ${signalReady ? "준비됨" : "점검 필요"}` : "PAPER 상태 신호: 연결 데이터 없음";
  const signalReadout = signalReady ? "PAPER READY" : snapshot ? "OBSERVING" : "NO VERIFIED SIGNAL";
  const aiTitle = aiInsightAvailable ? "검증된 AI 판단" : "검증 대기";
  const aiThesis = aiInsightAvailable ? ai?.thesis ?? "" : "실제 근거가 확인되기 전에는 판단을 만들지 않습니다.";
  const transportValue = snapshot?.operations.transport === "ONLINE" ? "ONLINE" : "OFFLINE";
  const safetyValue = snapshot?.readyForPaperOperations ? "PASS" : snapshot ? "CHECK" : "LOCKED";
  const aiValue = aiInsightAvailable ? "READY" : "LOCKED";
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
    paddingTop: profile.screen.topPadding,
    gap: tablet ? 18 : 14,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? 66 : 54,
    lineHeight: tablet ? 70 : 58,
    letterSpacing: tablet ? -3.2 : -2.8,
    color: theme.colors.text,
  } as const;
  const notice = readOnlyError
    ? { title: "PAPER 서버 연결 오류", detail: readOnlyError, tone: "danger" as const, actionLabel: undefined }
    : notConfigured
      ? { title: "PAPER 연결이 필요합니다", detail: notConfigured, tone: "warning" as const, actionLabel: "설정" }
      : null;

  return <ScrollView contentContainerStyle={[styles.content, contentStyle]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <View style={styles.wordmarkHeader}>
      <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.signalStage, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID="home-signal-stage">
        <View style={styles.stageTopRow}>
          <View style={styles.equityBlock} testID="account-hero-card">
            <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text>
            <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text>
            <View style={styles.pnlRow}>
              <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text>
              <Text style={[styles.meta, { color: theme.colors.textMuted }]}>실제 누적 손익</Text>
            </View>
          </View>
          <View style={styles.stageState}>
            <Text style={[styles.stageStateLabel, { color: theme.colors.textMuted }]}>SIGNAL FIELD</Text>
            <Text style={[styles.stageStateValue, { color: signalReady ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{signalReadout}</Text>
          </View>
        </View>

        <View style={styles.stageCanvas} testID="home-stage-canvas">
          <View style={[styles.canvasAxis, styles.canvasAxisVertical, { backgroundColor: theme.colors.border, opacity: 0.32 }]} />
          <View style={[styles.canvasAxis, styles.canvasAxisHorizontal, { backgroundColor: theme.colors.border, opacity: 0.26 }]} />
          <View style={styles.terrainHero}>
            <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
          </View>
          <View style={[styles.fieldNode, { borderColor: theme.colors.aiSignalMid, shadowColor: theme.colors.aiSignalEnd }]}>
            <View style={[styles.fieldNodeCore, { backgroundColor: theme.colors.aiSignalEnd }]} />
          </View>
          <View style={styles.canvasLegend} pointerEvents="none">
            <Text style={[styles.canvasLegendText, { color: theme.colors.textMuted }]}>GATHER</Text>
            <Text style={[styles.canvasLegendText, { color: theme.colors.textMuted }]}>ANALYZE</Text>
            <Text style={[styles.canvasLegendText, { color: theme.colors.textMuted }]}>CONVERGE</Text>
          </View>
        </View>

        <View style={[styles.judgementStrip, { borderTopColor: theme.colors.border }]} testID="home-ai-judgement">
          <View style={[styles.judgementRail, { backgroundColor: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.borderStrong }]} />
          <View style={styles.judgementCopy}>
            <Text style={[styles.kicker, { color: aiInsightAvailable ? theme.colors.aiSignalMid : theme.colors.textMuted }]}>AI JUDGEMENT · READ ONLY</Text>
            <Text style={[styles.judgementTitle, { color: theme.colors.text }]}>{aiTitle}</Text>
            <Text style={[styles.judgementThesis, { color: theme.colors.textMuted }]} numberOfLines={3}>{aiThesis}</Text>
          </View>
          {calibratedConfidence ? <View style={styles.confidenceBlock}>
            <Text style={[styles.confidenceValue, { color: theme.colors.text }]}>{calibratedConfidence}</Text>
            <Text style={[styles.confidenceLabel, { color: theme.colors.textMuted }]}>CALIBRATED</Text>
          </View> : null}
        </View>
      </View>
    </MotionReveal>

    <View style={[styles.indicatorStrip, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID="home-indicator-strip">
      <View style={[styles.indicatorCell, { borderRightColor: theme.colors.border }]}>
        <Text style={[styles.indicatorLabel, { color: theme.colors.textMuted }]}>CONNECT</Text>
        <Text style={[styles.indicatorValue, { color: transportValue === "ONLINE" ? theme.colors.success : theme.colors.text }]}>{transportValue}</Text>
        <Text style={[styles.indicatorDetail, { color: theme.colors.textMuted }]}>PAPER DATA</Text>
      </View>
      <View style={[styles.indicatorCell, { borderRightColor: theme.colors.border }]}>
        <Text style={[styles.indicatorLabel, { color: theme.colors.textMuted }]}>SAFETY</Text>
        <Text style={[styles.indicatorValue, { color: safetyValue === "PASS" ? theme.colors.success : theme.colors.text }]}>{safetyValue}</Text>
        <Text style={[styles.indicatorDetail, { color: theme.colors.textMuted }]}>PAPER GATE</Text>
      </View>
      <View style={styles.indicatorCell}>
        <Text style={[styles.indicatorLabel, { color: theme.colors.textMuted }]}>AI</Text>
        <Text style={[styles.indicatorValue, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.text }]}>{aiValue}</Text>
        <Text style={[styles.indicatorDetail, { color: theme.colors.textMuted }]}>ZERO AUTHORITY</Text>
      </View>
    </View>

    <View style={styles.authorityLine} testID="home-authority-line">
      <Text style={[styles.authorityText, { color: theme.colors.textMuted }]}>LIVE {snapshot?.liveAuthority ?? "NONE"}</Text>
      <View style={[styles.authorityDot, { backgroundColor: theme.colors.borderStrong }]} />
      <Text style={[styles.authorityText, { color: theme.colors.textMuted }]}>PRODUCTION MUTATION {snapshot?.productionMutationAllowed ? "ALLOWED" : "BLOCKED"}</Text>
    </View>

    {allocation ? <View style={[styles.capitalRail, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]} testID="home-allocation-panel">
      <View style={styles.capitalHeading}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>CAPITAL ENVELOPE</Text>
        <Text style={[styles.capitalPercent, { color: theme.colors.text }]}>{allocation.investmentPercent}%</Text>
      </View>
      <View style={styles.capitalValues}>
        <View style={styles.capitalValueBlock}><Text style={[styles.capitalLabel, { color: theme.colors.textMuted }]}>INVESTABLE</Text><Text style={[styles.capitalValue, { color: theme.colors.text }]} testID="home-investable-cash">{krw(allocation.investableCash)}</Text></View>
        <View style={styles.capitalValueBlock}><Text style={[styles.capitalLabel, { color: theme.colors.textMuted }]}>RESERVED</Text><Text style={[styles.capitalValue, { color: theme.colors.text }]} testID="home-reserved-cash">{krw(allocation.reservedCash)}</Text></View>
      </View>
    </View> : null}

    {notice ? <OperationalNotice title={notice.title} detail={notice.detail} tone={notice.tone} actionLabel={notice.actionLabel} onAction={notice.actionLabel ? onGoSettings : undefined} testID={notConfigured ? "dashboard-session-card" : "home-operational-notice"} actionTestID={notConfigured ? "dashboard-open-settings" : undefined} /> : null}

    <Pressable accessibilityRole="button" onPress={runNextAction} style={({ pressed }) => [styles.nextAction, { borderTopColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-next-action-button">
      <View style={styles.nextActionCopy}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text>
        <Text style={[styles.nextActionDetail, { color: theme.colors.textMuted }]}>{nextAction.detail}</Text>
      </View>
      <Text style={[styles.nextActionLabel, { color: theme.colors.text }]}>{nextAction.title}  ›</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  wordmarkHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wordmark: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: 2.2 },
  kicker: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.7 },
  signalStage: { minHeight: 510, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 18, paddingBottom: 16 },
  stageTopRow: { minHeight: 122, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 20 },
  equityBlock: { flex: 1, minWidth: 0, gap: 5 },
  balance: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  pnlRow: { minHeight: 22, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  pnlValue: { fontSize: 14, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 11, lineHeight: 16 },
  stageState: { maxWidth: "34%", alignItems: "flex-end", paddingTop: 2, gap: 5 },
  stageStateLabel: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1.5 },
  stageStateValue: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1.2, textAlign: "right" },
  stageCanvas: { height: 300, position: "relative", overflow: "hidden", justifyContent: "center", marginHorizontal: -8 },
  terrainHero: { transform: [{ scaleX: 1.08 }, { scaleY: 1.18 }] },
  canvasAxis: { position: "absolute" },
  canvasAxisVertical: { top: "8%", bottom: "9%", left: "50%", width: StyleSheet.hairlineWidth },
  canvasAxisHorizontal: { left: "4%", right: "4%", top: "52%", height: StyleSheet.hairlineWidth },
  fieldNode: { position: "absolute", left: "50%", top: "50%", width: 72, height: 72, marginLeft: -36, marginTop: -36, borderRadius: 36, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", shadowOpacity: 0.4, shadowRadius: 18 },
  fieldNodeCore: { width: 6, height: 6, borderRadius: 3 },
  canvasLegend: { position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  canvasLegendText: { fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: 1.3 },
  judgementStrip: { minHeight: 112, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  judgementRail: { width: 2, alignSelf: "stretch", minHeight: 78 },
  judgementCopy: { flex: 1, minWidth: 0, gap: 5 },
  judgementTitle: { fontSize: 22, lineHeight: 28, fontWeight: "750", letterSpacing: -0.6 },
  judgementThesis: { fontSize: 12, lineHeight: 19 },
  confidenceBlock: { minWidth: 72, alignItems: "flex-end", gap: 2 },
  confidenceValue: { fontSize: 20, lineHeight: 25, fontWeight: "800", fontVariant: ["tabular-nums"] },
  confidenceLabel: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 1.1 },
  indicatorStrip: { minHeight: 84, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  indicatorCell: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 12, justifyContent: "center", gap: 3, borderRightWidth: StyleSheet.hairlineWidth },
  indicatorLabel: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 1.2 },
  indicatorValue: { fontSize: 14, lineHeight: 19, fontWeight: "800", letterSpacing: 0.2 },
  indicatorDetail: { fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: 0.8 },
  authorityLine: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" },
  authorityText: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.7 },
  authorityDot: { width: 2, height: 2, borderRadius: 1 },
  capitalRail: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 10 },
  capitalHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  capitalPercent: { fontSize: 13, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  capitalValues: { flexDirection: "row", gap: 18 },
  capitalValueBlock: { flex: 1, gap: 2 },
  capitalLabel: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 1.1 },
  capitalValue: { fontSize: 15, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  nextAction: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 8 },
  nextActionCopy: { flex: 1, minWidth: 0, gap: 3 },
  nextActionDetail: { fontSize: 11, lineHeight: 16 },
  nextActionLabel: { maxWidth: "46%", fontSize: 11, lineHeight: 16, fontWeight: "800", textAlign: "right" },
});
