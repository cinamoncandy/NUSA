import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, NusaButton, TerrainSignal } from "./components";
import { CompactMetric, InsightPanel, OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";

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

  const localPaperActive = snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;

  const account = snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const accountSource = snapshot != null ? "CLOUD" : localPortfolio != null ? "LOCAL" : null;
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : undefined;
  const disconnected = notConfigured != null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const runtimeState = snapshot?.operations.runtimeState;
  const statusLabel = snapshot
    ? `PAPER · ${runtimeState === "RUNNING" ? "RUNNING" : runtimeState === "DEGRADED" ? "DEGRADED" : runtimeState === "HALTED" ? "HALTED" : signalReady ? "READY" : "CHECK"}`
    : accountSource === "LOCAL" ? "PAPER · LOCAL" : notConfigured ? "PAPER · OFFLINE" : "PAPER · STANDBY";
  const statusTone = snapshot ? healthTone(snapshot.health) : accountSource === "LOCAL" ? "info" as const : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = aiInsightAvailable ? "NUSA verified signal field" : signalReady ? "NUSA analyzing market" : "NUSA waiting for market connection";

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

  const primaryLabel = notConfigured ? "CONNECT PAPER" : readOnlyError ? "RECOVER" : aiInsightAvailable ? "OPEN SIGNAL" : "OPEN MARKET";
  const primaryDetail = notConfigured
    ? "PAPER 연결 후 실제 시장 입력과 모의계좌 상태를 표시합니다."
    : readOnlyError
      ? "현재 연결 상태를 복구한 뒤 판단을 다시 확인합니다."
      : aiInsightAvailable
        ? "검증된 근거와 현재 NUSA 판단을 확인합니다."
        : "시장 데이터는 읽기 전용으로 분석 중입니다.";
  const runPrimaryAction = () => {
    if (notConfigured || readOnlyError) return onGoSettings();
    onNavigate(aiInsightAvailable ? "AiSignal" : "Markets");
  };

  const supervisorNow = disconnected
    ? "PAPER LINK REQUIRED"
    : readOnlyError
      ? "RECOVERY REQUIRED"
      : runtimeState === "RUNNING"
        ? "PAPER SUPERVISION RUNNING"
        : signalReady
          ? "PAPER DECISION READY"
          : "DECISION HOLD";
  const supervisorWhy = aiInsightAvailable
    ? (ai?.thesis ?? "")
    : disconnected
      ? "PAPER 데이터 연결 전에는 판단을 생성하지 않습니다."
      : readOnlyError
        ? "시장 연결의 신뢰성이 확인될 때까지 새로운 판단을 보류합니다."
        : signalReady
          ? "검증 가능한 AI 근거가 축적될 때까지 판단을 확대하지 않습니다."
          : "운영·시장 입력이 안전 게이트를 통과할 때까지 대기합니다.";
  const supervisorResult = account == null
    ? "검증된 PAPER 성과 데이터 없음"
    : `PAPER P&L ${totalPnl == null ? "—" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`} · EQUITY ${krw(account.equity)}`;
  const supervisorLearning = aiInsightAvailable
    ? `근거 ${ai?.evidenceReferences.length ?? 0}개 · ${calibratedConfidence ?? "UNCALIBRATED"} · 검증된 근거만 학습 화면으로 연결`
    : "검증 근거가 없으므로 새로운 학습 결론을 표시하지 않습니다.";

  const cornerStyle = { borderColor: theme.colors.aiSignalEnd } as const;

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.masterRail} testID="home-master-rail">
      <View style={styles.brandLockup}>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <View style={[styles.brandUnderline, { backgroundColor: theme.colors.aiSignalEnd }]} />
        <Text style={[styles.brandMeta, { color: theme.colors.textMuted }]}>INTELLIGENCE / PAPER CONTROL</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <View style={[styles.supervisorDeck, { borderColor: theme.colors.borderStrong }]} testID="home-supervisor-summary">
      <View style={styles.deckHeader}>
        <Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>SUPERVISOR / EVIDENCE FIRST</Text>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE</Text>
      </View>
      <View style={styles.supervisorRow} testID="home-supervisor-now">
        <Text style={[styles.supervisorKey, { color: theme.colors.aiSignalEnd }]}>NOW</Text>
        <Text style={[styles.supervisorValueStrong, { color: theme.colors.text }]}>{supervisorNow}</Text>
      </View>
      <View style={[styles.supervisorRow, { borderTopColor: theme.colors.border }]} testID="home-supervisor-why">
        <Text style={[styles.supervisorKey, { color: theme.colors.textMuted }]}>WHY</Text>
        <Text style={[styles.supervisorValue, { color: theme.colors.text }]}>{supervisorWhy}</Text>
      </View>
      <View style={[styles.supervisorRow, { borderTopColor: theme.colors.border }]} testID="home-supervisor-result">
        <Text style={[styles.supervisorKey, { color: theme.colors.textMuted }]}>RESULT</Text>
        <Text style={[styles.supervisorValue, { color: theme.colors.text }]}>{supervisorResult}</Text>
      </View>
      <View style={[styles.supervisorRow, { borderTopColor: theme.colors.border }]} testID="home-supervisor-learning">
        <Text style={[styles.supervisorKey, { color: theme.colors.textMuted }]}>LEARNING</Text>
        <Text style={[styles.supervisorValue, { color: theme.colors.text }]}>{supervisorLearning}</Text>
      </View>
      <View style={[styles.supervisorAuthority, { borderTopColor: theme.colors.border }]}>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>AI ZERO AUTHORITY · productionMutationAllowed=false · liveAuthority=NONE</Text>
        <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryButton, { borderColor: theme.colors.aiSignalEnd, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action">
          <Text style={[styles.primaryLabel, { color: theme.colors.aiSignalEnd }]}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.commandDeck, { borderColor: theme.colors.borderStrong }]} testID="account-hero-card">
        <View style={[styles.cornerTL, cornerStyle]} /><View style={[styles.cornerTR, cornerStyle]} /><View style={[styles.cornerBL, cornerStyle]} /><View style={[styles.cornerBR, cornerStyle]} />
        <View style={styles.deckHeader}>
          <Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>01 // CAPITAL CORE</Text>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
        </View>
        <Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text>
        {account == null
          ? <Text style={[styles.placeholderBalance, { color: theme.colors.textMuted }]} testID="home-equity-placeholder">NO LINK</Text>
          : <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1} testID={accountSource === "LOCAL" ? "home-equity-local" : "home-equity-cloud"}>{krw(account.equity)}</Text>}
        {accountSource === "LOCAL" ? <Text style={[styles.meta, { color: theme.colors.textMuted }]} testID="home-local-paper-note">Cloud 연결 없이 기기 내 LOCAL PAPER 잔고를 표시합니다 · 실제 주문 아님</Text> : null}
        <View style={styles.pnlRow}>
          <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.aiSignalEnd : theme.colors.danger }]}>{totalPnl == null ? "P&L —" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>CUMULATIVE PAPER P&L</Text>
        </View>
        {cashEnvelope ? <View style={[styles.cashRail, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation">
          <View style={styles.cashMetric} testID="home-investable-cash"><Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>DEPLOYABLE {cashEnvelope.investmentPercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text></View>
          <View style={[styles.cashDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.cashMetric} testID="home-reserved-cash"><Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>RESERVE {cashEnvelope.reservePercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text></View>
        </View> : null}
      </View>
    </MotionReveal>

    <View style={[styles.signalStage, { borderColor: theme.colors.borderStrong }]} testID="ai-card">
      <View style={styles.deckHeader}>
        <View><Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>02 // SIGNAL TERRAIN</Text><Text style={[styles.stageTitle, { color: theme.colors.text }]}>NUSA VIEW</Text></View>
        <Text style={[styles.decisionState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING"}</Text>
      </View>
      <View style={styles.terrainHero} testID="home-decision-stage">
        <View style={[styles.crosshairH, { backgroundColor: theme.colors.border }]} />
        <View style={[styles.crosshairV, { backgroundColor: theme.colors.border }]} />
        <View style={[styles.scanlineA, { backgroundColor: theme.colors.aiSignalEnd }]} />
        <View style={[styles.scanlineB, { backgroundColor: theme.colors.aiSignalEnd }]} />
        <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
        <View style={styles.signalLegend}><Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.signalLegendText, { color: theme.colors.aiSignalEnd }]}>NEUTRAL</Text><Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>OPPORTUNITY</Text></View>
      </View>
      <View style={[styles.decisionCopy, { borderTopColor: theme.colors.border }]} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
        <Text style={[styles.judgement, { color: theme.colors.text }]}>{aiInsightAvailable ? (ai?.thesis ?? "") : disconnected ? "PAPER LINK REQUIRED" : "DECISION HOLD"}</Text>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `EVIDENCE ${ai?.evidenceReferences.length ?? 0} · ${calibratedConfidence ?? "UNCALIBRATED"} · AI READ ONLY · ZERO AUTHORITY` : primaryDetail}</Text>
      </View>
    </View>

    {disconnected ? <OperationalNotice title="PAPER 연결이 필요합니다" detail="연결 전에는 실제 PAPER 계좌와 판단 데이터를 표시하지 않습니다." tone="warning" actionLabel="PAPER 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}
    {readOnlyError ? <OperationalNotice title="시장 연결을 확인할 수 없습니다" detail="NUSA는 새로운 PAPER 판단을 보류합니다." tone="danger" actionLabel="설정에서 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}

    {!disconnected ? <View style={[styles.actionDeck, { borderColor: theme.colors.borderStrong }]} testID="home-next-action">
      <View style={styles.primaryCopy}><Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>NEXT DECISION</Text><Text style={[styles.actionDetail, { color: theme.colors.textMuted }]}>{primaryDetail}</Text></View>
      <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryButton, { borderColor: theme.colors.aiSignalEnd, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-next-action-button"><Text style={[styles.primaryLabel, { color: theme.colors.aiSignalEnd }]}>{primaryLabel}</Text></Pressable>
    </View> : null}

    {!disconnected ? <NusaButton label="PAPER 학습 보기" tone="neutral" onPress={onOpenPaperLearning} testID="home-paper-learning" /> : null}

    <View style={[styles.secondaryDiagnostics, { borderTopColor: theme.colors.border }]} testID="safety-card">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: diagnosticsOpen }} onPress={() => setDiagnosticsOpen((open) => !open)} style={({ pressed }) => [styles.diagnosticsToggle, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-diagnostics-toggle">
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SYSTEM / SAFETY</Text><Text style={[styles.diagnosticsToggleLabel, { color: theme.colors.text }]}>{diagnosticsOpen ? "CLOSE" : "OPEN"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : accountSource === "LOCAL" ? "LOCAL PAPER" : notConfigured ? "연결 필요" : "대기"} detail={statusLabel} tone={snapshot ? "success" : accountSource === "LOCAL" ? "info" : "warning"} />
        <CompactMetric label="Runtime" value={runtimeState ?? "STANDBY"} detail="현재 PAPER runtime 상태" tone={runtimeState === "RUNNING" ? "success" : runtimeState === "HALTED" ? "danger" : "default"} />
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
  masterRail: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingBottom: 4 },
  brandLockup: { gap: 3 },
  wordmark: { fontSize: 32, lineHeight: 34, fontWeight: "900", letterSpacing: 1.8 },
  brandUnderline: { width: 74, height: 3 },
  brandMeta: { fontSize: 9, lineHeight: 12, fontWeight: "800", letterSpacing: 2.1 },
  supervisorDeck: { borderWidth: 1, padding: 14, gap: 0 },
  supervisorRow: { borderTopWidth: 1, paddingVertical: 12, gap: 5 },
  supervisorKey: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.5 },
  supervisorValueStrong: { fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: 0.3 },
  supervisorValue: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  supervisorAuthority: { borderTopWidth: 1, marginTop: 2, paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  commandDeck: { position: "relative", borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16, minHeight: 210, overflow: "hidden" },
  cornerTL: { position: "absolute", left: -1, top: -1, width: 18, height: 18, borderLeftWidth: 3, borderTopWidth: 3 },
  cornerTR: { position: "absolute", right: -1, top: -1, width: 18, height: 18, borderRightWidth: 3, borderTopWidth: 3 },
  cornerBL: { position: "absolute", left: -1, bottom: -1, width: 18, height: 18, borderLeftWidth: 3, borderBottomWidth: 3 },
  cornerBR: { position: "absolute", right: -1, bottom: -1, width: 18, height: 18, borderRightWidth: 3, borderBottomWidth: 3 },
  deckHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  kicker: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.6 },
  heroLabel: { marginTop: 28, fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 2 },
  balance: { marginTop: 4, fontWeight: "900", fontVariant: ["tabular-nums"] },
  placeholderBalance: { marginTop: 12, fontSize: 42, lineHeight: 48, fontWeight: "900", letterSpacing: 1 },
  pnlRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  pnlValue: { fontSize: 17, lineHeight: 22, fontWeight: "900", letterSpacing: 0.3, fontVariant: ["tabular-nums"] },
  meta: { fontSize: 10, lineHeight: 15, fontWeight: "700", letterSpacing: 0.5 },
  cashRail: { flexDirection: "row", borderTopWidth: 1, marginTop: 22, paddingTop: 14 },
  cashMetric: { flex: 1, gap: 5 },
  cashDivider: { width: 1, marginHorizontal: 14 },
  cashLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.2 },
  cashValue: { fontSize: 15, lineHeight: 19, fontWeight: "800" },
  signalStage: { borderWidth: 1, padding: 14, overflow: "hidden" },
  stageTitle: { marginTop: 3, fontSize: 24, lineHeight: 28, fontWeight: "900", letterSpacing: 0.6 },
  decisionState: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 1.3 },
  terrainHero: { position: "relative", height: 300, marginTop: 10, overflow: "hidden", justifyContent: "center" },
  crosshairH: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, opacity: 0.7 },
  crosshairV: { position: "absolute", top: 0, bottom: 22, left: "50%", width: 1, opacity: 0.55 },
  scanlineA: { position: "absolute", width: 1, height: 52, left: "28%", top: 70, opacity: 0.45 },
  scanlineB: { position: "absolute", width: 1, height: 72, right: "23%", bottom: 58, opacity: 0.28 },
  signalLegend: { position: "absolute", left: 4, right: 4, bottom: 2, flexDirection: "row", justifyContent: "space-between" },
  signalLegendText: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.4 },
  decisionCopy: { borderTopWidth: 1, paddingTop: 14, gap: 6 },
  judgement: { fontSize: 19, lineHeight: 26, fontWeight: "900" },
  actionDeck: { borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 14 },
  primaryCopy: { flex: 1, gap: 5 },
  actionDetail: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  primaryButton: { borderWidth: 1, minHeight: 44, minWidth: 112, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 0.9 },
  secondaryDiagnostics: { borderTopWidth: 1, paddingTop: 12 },
  diagnosticsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diagnosticsToggleLabel: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.8 },
});