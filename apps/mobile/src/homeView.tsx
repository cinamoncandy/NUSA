import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, NusaButton, TerrainSignal } from "./components";
import { CompactMetric, InsightPanel, OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";

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
  readonly onOpenPaperLearning: () => void;
}

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" || health === "ONLINE" || health === "RUNNING"
    ? "success"
    : health === "FAIL_CLOSED" || health === "DOWN"
      ? "danger"
      : "warning";
}

export function HomeView({
  snapshot,
  investmentPercent,
  readOnlyError,
  notConfigured,
  refreshing,
  onRefresh,
  onGoSettings,
  onNavigate,
  onOpenPaperLearning,
}: HomeViewProps) {
  const { theme } = useTheme();
  const profile = getHomeVisualProfile(theme.preset);
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);

  const account = snapshot?.portfolio?.account ?? null;
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED"
    ? `${Math.round(ai.confidence * 100)}%`
    : undefined;
  const disconnected = notConfigured != null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const runtimeState = snapshot?.operations.runtimeState;
  const statusLabel = snapshot
    ? `PAPER · ${runtimeState === "RUNNING" ? "RUNNING" : runtimeState === "DEGRADED" ? "DEGRADED" : runtimeState === "HALTED" ? "HALTED" : signalReady ? "READY" : "점검 필요"}`
    : notConfigured
      ? "PAPER · 연결 필요"
      : "PAPER · 대기";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = aiInsightAvailable
    ? "NUSA 검증 분석 신호"
    : signalReady
      ? "NUSA 시장 분석 중"
      : "NUSA 시장 연결 대기";

  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    gap: tablet ? 24 : 18,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? Math.max(profile.hero.tabletBalanceSize, 58) : Math.max(profile.hero.balanceSize, 42),
    lineHeight: tablet ? Math.max(profile.hero.tabletBalanceLineHeight, 64) : Math.max(profile.hero.balanceLineHeight, 48),
    letterSpacing: profile.hero.balanceLetterSpacing,
    color: theme.colors.text,
  } as const;

  const blocked = Boolean(notConfigured || readOnlyError || !signalReady);
  const primaryLabel = notConfigured
    ? "PAPER 연결"
    : readOnlyError
      ? "다시 확인"
      : aiInsightAvailable
        ? "분석 보기"
        : "시장 보기";
  const primaryDetail = notConfigured
    ? "PAPER 시장 데이터를 연결하면 NUSA가 분석을 시작합니다."
    : readOnlyError
      ? "현재 연결 상태를 복구한 뒤 시장 판단을 다시 확인합니다."
      : aiInsightAvailable
        ? "검증된 근거와 현재 NUSA 판단을 확인합니다."
        : signalReady
          ? "시장 데이터는 준비됐습니다. 검증된 판단을 기다리고 있습니다."
          : "시장 상태와 연결 상태를 확인합니다.";
  const runPrimaryAction = () => {
    if (notConfigured || readOnlyError) {
      onGoSettings();
      return;
    }
    onNavigate(aiInsightAvailable ? "AiSignal" : "Markets");
  };

  const notice = readOnlyError
    ? { title: "시장 연결을 확인할 수 없습니다", detail: "NUSA는 안전하게 새로운 PAPER 판단을 보류하고 있습니다.", tone: "danger" as const }
    : null;

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.wordmarkHeader}>
      <View style={styles.brandLockup}>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.brandMeta, { color: theme.colors.textMuted }]}>INTELLIGENCE OS</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <NusaButton label="PAPER 학습 보기" tone="neutral" onPress={onOpenPaperLearning} testID="home-paper-learning" />

    <MotionReveal testID="home-hero-reveal">
      <View style={styles.equitySection} testID="account-hero-card">
        <View style={styles.sectionEyebrow}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>01 / HOME</Text>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text>
        </View>
        {disconnected ? <Text style={[styles.placeholderBalance, { color: theme.colors.textMuted }]} testID="home-equity-placeholder">연결 후 표시</Text> : <>
          <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>
            {account ? krw(account.equity) : "-"}
          </Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>
              {totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
            </Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>누적 PAPER 손익</Text>
          </View>
        </>}
        {cashEnvelope ? <View style={[styles.cashRail, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation">
          <View style={styles.cashMetric} testID="home-investable-cash">
            <Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>INVESTABLE · {cashEnvelope.investmentPercent}%</Text>
            <Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text>
          </View>
          <View style={[styles.cashDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.cashMetric} testID="home-reserved-cash">
            <Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>RESERVE · {cashEnvelope.reservePercent}%</Text>
            <Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text>
          </View>
        </View> : null}
      </View>
    </MotionReveal>

    <View testID="ai-card">
      <View style={[styles.signalStage, { borderColor: theme.colors.borderStrong }]} testID="home-decision-stage">
        <View style={styles.signalTopRail}>
          <View style={styles.decisionHeaderCopy}>
            <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SIGNAL FIELD</Text>
            <Text style={[styles.stageTitle, { color: theme.colors.text }]}>NUSA VIEW</Text>
          </View>
          <Text style={[styles.decisionState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>
            {aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING"}
          </Text>
        </View>
        <View style={[styles.terrainHero, disconnected && styles.terrainHeroDisconnected]}>
          <View style={[styles.axisLine, styles.axisLineTop, { backgroundColor: theme.colors.border }]} />
          <View style={[styles.axisLine, styles.axisLineBottom, { backgroundColor: theme.colors.border }]} />
          <View style={[styles.axisTick, styles.axisTickLeft, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={[styles.axisTick, styles.axisTickRight, { backgroundColor: theme.colors.borderStrong }]} />
          <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
          <View style={styles.signalLegend}>
            <Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>RISK</Text>
            <Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>NEUTRAL</Text>
            <Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>OPPORTUNITY</Text>
          </View>
        </View>
        {aiInsightAvailable ? <View style={[styles.decisionCopy, { borderTopColor: theme.colors.border }]} testID="home-verified-decision">
          <View style={styles.judgementRow}>
            <Text style={[styles.judgement, { color: theme.colors.text }]}>{ai?.thesis ?? ""}</Text>
            {calibratedConfidence ? <Text style={[styles.confidence, { color: theme.colors.aiSignalEnd }]}>{calibratedConfidence}</Text> : null}
          </View>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>근거 {ai?.evidenceReferences.length ?? 0}개 · AI READ ONLY · ZERO AUTHORITY</Text>
        </View> : <View style={[styles.decisionCopy, { borderTopColor: theme.colors.border }]} testID="home-pending-decision">
          <Text style={[styles.judgement, { color: theme.colors.text }]}>{blocked ? "시장 연결이 필요합니다" : "판단 보류"}</Text>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>{disconnected ? "시장 데이터가 아직 연결되지 않았습니다." : primaryDetail}</Text>
        </View>}
      </View>
      {disconnected ? <OperationalNotice
        title="PAPER를 연결하면 시장 분석과 모의거래를 시작합니다"
        tone="warning"
        actionLabel="PAPER 연결"
        onAction={onGoSettings}
        actionTestID="dashboard-open-settings"
        testID="home-operational-notice"
      /> : null}
    </View>

    {notice ? <OperationalNotice
      title={notice.title}
      detail={notice.detail}
      tone={notice.tone}
      actionLabel="설정에서 연결"
      onAction={onGoSettings}
      actionTestID="dashboard-open-settings"
      testID="home-operational-notice"
    /> : null}

    {!disconnected ? <View style={styles.primaryAction} testID="home-next-action">
      <View style={styles.primaryCopy}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT DECISION</Text>
        <Text style={[styles.actionDetail, { color: theme.colors.textMuted }]}>{primaryDetail}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={runPrimaryAction}
        style={({ pressed }) => [styles.primaryButton, { borderColor: theme.colors.borderStrong, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-next-action-button"
      >
        <Text style={[styles.primaryLabel, { color: theme.colors.text }]}>{primaryLabel}</Text>
      </Pressable>
    </View> : null}

    <View style={styles.secondaryDiagnostics} testID="safety-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: diagnosticsOpen }}
        onPress={() => setDiagnosticsOpen((open) => !open)}
        style={({ pressed }) => [styles.diagnosticsToggle, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-diagnostics-toggle"
      >
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>운영 진단</Text>
        <Text style={[styles.diagnosticsToggleLabel, { color: theme.colors.text }]}>{diagnosticsOpen ? "진단 닫기" : "진단 보기"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : notConfigured ? "연결 필요" : "대기"} detail={`PAPER 상태 신호: ${statusLabel}`} tone={snapshot ? "success" : "warning"} />
        {snapshot?.operations.heartbeat ? <CompactMetric
          label="PAPER runtime"
          value={runtimeState ?? "UNKNOWN"}
          detail={`heartbeat ${new Date(snapshot.operations.heartbeat.lastHeartbeatAt).toISOString()} · 시장 이벤트 ${snapshot.operations.heartbeat.eventCount}`}
          tone={runtimeState === "RUNNING" ? "success" : runtimeState === "DEGRADED" ? "warning" : "default"}
        /> : null}
        <CompactMetric label="안전 게이트" value={snapshot?.readyForPaperOperations ? "준비됨" : "차단"} detail="PAPER-only · Kill Switch 보호" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} />
        <CompactMetric label="AI 분석" value={aiInsightAvailable ? "검증됨" : "판단 보류"} detail="AI ZERO AUTHORITY · READ ONLY" tone={aiInsightAvailable ? "info" : "default"} />
        <CompactMetric label="LIVE 권한" value="NONE" detail="실거래 mutation 없음" />
        <CompactMetric label="Production mutation" value="false" detail="fail-closed" />
        {aiInsightAvailable ? <InsightPanel title="NUSA VIEW" thesis={ai?.thesis ?? ""} meta={`근거 ${ai?.evidenceReferences.length ?? 0}개 · READ ONLY`} confidenceLabel={calibratedConfidence} /> : null}
      </View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  wordmarkHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brandLockup: { flexDirection: "row", alignItems: "baseline", gap: 9 },
  wordmark: { fontSize: 20, lineHeight: 26, fontWeight: "900", letterSpacing: 3.2 },
  brandMeta: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1.5 },
  sectionEyebrow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  equitySection: { gap: 8, paddingTop: 10, paddingBottom: 4 },
  kicker: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.7 },
  balance: { fontWeight: "900", fontVariant: ["tabular-nums"] },
  placeholderBalance: { fontSize: 32, lineHeight: 40, fontWeight: "700", paddingVertical: 8 },
  pnlRow: { minHeight: 22, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  pnlValue: { fontSize: 14, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  cashRail: { flexDirection: "row", alignItems: "stretch", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 3 },
  cashMetric: { flex: 1, minWidth: 0, gap: 2 },
  cashDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  cashLabel: { fontSize: 9, lineHeight: 13, fontWeight: "600" },
  cashValue: { fontSize: 12, lineHeight: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 11, lineHeight: 16 },
  body: { fontSize: 13, lineHeight: 20 },
  signalStage: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16, gap: 10 },
  terrainHero: { minHeight: 228, justifyContent: "center", overflow: "hidden", position: "relative" },
  terrainHeroDisconnected: { opacity: 0.68 },
  axisLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  axisLineTop: { top: 34 },
  axisLineBottom: { bottom: 34 },
  axisTick: { position: "absolute", width: 1, height: 14 },
  axisTickLeft: { left: 2, top: "50%" },
  axisTickRight: { right: 2, top: "50%" },
  signalLegend: { position: "absolute", left: 0, right: 0, bottom: 8, flexDirection: "row", justifyContent: "space-between" },
  signalLegendText: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 1.2 },
  decisionStage: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16, gap: 10 },
  signalTopRail: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  decisionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  decisionHeaderCopy: { gap: 3 },
  stageTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.5 },
  decisionState: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.4 },
  decisionCopy: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  judgementRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  judgement: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "700", letterSpacing: -0.25 },
  confidence: { fontSize: 18, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  primaryAction: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 },
  primaryCopy: { flex: 1, minWidth: 0, gap: 4 },
  actionDetail: { fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 48, minWidth: 112, maxWidth: "46%", justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 6, paddingHorizontal: 14 },
  primaryLabel: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  secondaryDiagnostics: { gap: 6, paddingTop: 2 },
  diagnosticsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  diagnosticsToggleLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
