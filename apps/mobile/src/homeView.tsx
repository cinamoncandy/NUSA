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
  const signal = theme.colors.aiSignalEnd;

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

  const cornerStyle = { borderColor: signal } as const;
  const terminalBorder = { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface } as const;

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.masterRail} testID="home-master-rail">
      <View style={styles.brandLockup}>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <View style={[styles.brandUnderline, { backgroundColor: signal }]} />
        <Text style={[styles.brandMeta, { color: signal }]}>AI + MARKETS + OPERATIONS</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <View style={styles.terminalGrid} testID="home-terminal-grid">
      <View style={[styles.terminalPanel, styles.environmentPanel, terminalBorder]} testID="home-environment-panel">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>ENVIRONMENT</Text><Text style={[styles.panelCode, { color: signal }]}>01</Text></View>
        <Text style={[styles.bigStatus, { color: signal }]}>{accountSource === "LOCAL" ? "PAPER / LOCAL" : snapshot ? "PAPER / CLOUD" : "PAPER / OFFLINE"}</Text>
        <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>READ ONLY · ZERO AUTHORITY</Text>
        <View style={[styles.authorityMiniRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.authorityMini, { color: theme.colors.textMuted }]}>LIVE</Text><Text style={[styles.authorityMiniValue, { color: theme.colors.text }]}>NONE</Text></View>
        <View style={[styles.authorityMiniRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.authorityMini, { color: theme.colors.textMuted }]}>MUTATION</Text><Text style={[styles.authorityMiniValue, { color: theme.colors.text }]}>FALSE</Text></View>
      </View>

      <Pressable onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.terminalPanel, styles.marketPanel, terminalBorder, { opacity: pressed ? 0.72 : 1 }]} testID="home-market-pulse">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>MARKET PULSE</Text><Text style={[styles.panelCode, { color: signal }]}>PUBLIC</Text></View>
        <Text style={[styles.marketHeadline, { color: theme.colors.text }]}>{signalReady ? "MARKET INPUT READY" : "MARKET INPUT WAITING"}</Text>
        <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>OPEN LIVE PUBLIC-MARKET SCREEN →</Text>
        <View style={styles.pulseBars} accessibilityLabel="system readiness pulse">
          {[0.28, 0.46, 0.82, 0.54, 0.94, 0.63, 0.76, 0.41, 0.68, 0.88, 0.58, 0.72].map((v, i) => <View key={i} style={[styles.pulseBar, { height: 8 + v * 28, backgroundColor: signal, opacity: signalReady ? 0.85 : 0.28 }]} />)}
        </View>
      </Pressable>
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.commandDeck, terminalBorder]} testID="account-hero-card">
        <View style={[styles.cornerTL, cornerStyle]} /><View style={[styles.cornerTR, cornerStyle]} /><View style={[styles.cornerBL, cornerStyle]} /><View style={[styles.cornerBR, cornerStyle]} />
        <View style={styles.deckHeader}>
          <Text style={[styles.kicker, { color: signal }]}>CAPITAL / PAPER PERFORMANCE</Text>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
        </View>
        <Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text>
        {account == null ? <Text style={[styles.placeholderBalance, { color: theme.colors.textMuted }]} testID="home-equity-placeholder">NO LINK</Text> : <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1} testID={accountSource === "LOCAL" ? "home-equity-local" : "home-equity-cloud"}>{krw(account.equity)}</Text>}
        {accountSource === "LOCAL" ? <Text style={[styles.meta, { color: theme.colors.textMuted }]} testID="home-local-paper-note">Cloud 연결 없이 기기 내 LOCAL PAPER 잔고를 표시합니다 · 실제 주문 아님</Text> : null}
        <View style={styles.pnlRow}>
          <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? signal : theme.colors.danger }]}>{totalPnl == null ? "P&L —" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>CUMULATIVE PAPER P&L</Text>
        </View>
        {cashEnvelope ? <View style={[styles.cashRail, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation">
          <View style={styles.cashMetric} testID="home-investable-cash"><Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>DEPLOYABLE {cashEnvelope.investmentPercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text></View>
          <View style={[styles.cashDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.cashMetric} testID="home-reserved-cash"><Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>RESERVE {cashEnvelope.reservePercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text></View>
        </View> : null}
      </View>
    </MotionReveal>

    <View style={styles.terminalGrid}>
      <View style={[styles.terminalPanel, terminalBorder]} testID="home-performance-cluster">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>PERFORMANCE</Text><Text style={[styles.panelCode, { color: signal }]}>PAPER</Text></View>
        <View style={styles.metricMatrix}>
          <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>P&L</Text><Text style={[styles.metricNumber, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? signal : theme.colors.danger }]}>{totalPnl == null ? "—" : krw(totalPnl)}</Text></View>
          <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>EQUITY</Text><Text style={[styles.metricNumber, { color: theme.colors.text }]}>{account ? krw(account.equity) : "—"}</Text></View>
          <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>CASH</Text><Text style={[styles.metricNumber, { color: theme.colors.text }]}>{account ? krw(account.cash) : "—"}</Text></View>
          <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>SOURCE</Text><Text style={[styles.metricNumber, { color: signal }]}>{accountSource ?? "NONE"}</Text></View>
        </View>
      </View>

      <View style={[styles.terminalPanel, terminalBorder]} testID="home-context-panel">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>NEWS / ECON</Text><Text style={[styles.panelCode, { color: theme.colors.textMuted }]}>SOURCE</Text></View>
        <Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>NO VERIFIED FEED</Text>
        <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>헤드라인과 경제지표는 검증된 소스 연결 전까지 표시하지 않습니다.</Text>
      </View>
    </View>

    <View style={[styles.signalStage, terminalBorder]} testID="ai-card">
      <View style={styles.deckHeader}>
        <View><Text style={[styles.kicker, { color: signal }]}>ORDER FLOW / AI SIGNAL TERRAIN</Text><Text style={[styles.stageTitle, { color: theme.colors.text }]}>NUSA VIEW</Text></View>
        <Text style={[styles.decisionState, { color: aiInsightAvailable ? signal : theme.colors.textMuted }]}>{aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING"}</Text>
      </View>
      <View style={styles.terrainHero} testID="home-decision-stage">
        <View style={[styles.crosshairH, { backgroundColor: theme.colors.border }]} />
        <View style={[styles.crosshairV, { backgroundColor: theme.colors.border }]} />
        <View style={[styles.scanlineA, { backgroundColor: signal }]} />
        <View style={[styles.scanlineB, { backgroundColor: signal }]} />
        <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
        <View style={styles.signalLegend}><Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.signalLegendText, { color: signal }]}>NEUTRAL</Text><Text style={[styles.signalLegendText, { color: theme.colors.textMuted }]}>OPPORTUNITY</Text></View>
      </View>
      <View style={[styles.decisionCopy, { borderTopColor: theme.colors.border }]} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
        <Text style={[styles.judgement, { color: theme.colors.text }]}>{aiInsightAvailable ? (ai?.thesis ?? "") : disconnected ? "PAPER LINK REQUIRED" : "DECISION HOLD"}</Text>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `EVIDENCE ${ai?.evidenceReferences.length ?? 0} · ${calibratedConfidence ?? "UNCALIBRATED"} · AI READ ONLY · ZERO AUTHORITY` : primaryDetail}</Text>
      </View>
    </View>

    <View style={styles.terminalGrid}>
      <Pressable onPress={() => onNavigate("Portfolio")} style={({ pressed }) => [styles.terminalPanel, terminalBorder, { opacity: pressed ? 0.72 : 1 }]} testID="home-portfolio-matrix">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>PORTFOLIO MATRIX</Text><Text style={[styles.panelCode, { color: signal }]}>OPEN →</Text></View>
        <View style={styles.matrixRows}>
          {["TREND", "MOMENTUM", "VOLATILITY", "LIQUIDITY"].map((label, row) => <View key={label} style={styles.matrixRow}><Text style={[styles.matrixLabel, { color: theme.colors.textMuted }]}>{label}</Text>{[0, 1, 2, 3].map((cell) => <View key={cell} style={[styles.matrixCell, { backgroundColor: cell === row % 4 && account ? signal : theme.colors.border, opacity: cell === row % 4 && account ? 0.72 : 0.34 }]} />)}</View>)}
        </View>
        <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>GRID IS STATUS-ONLY · OPEN PORTFOLIO FOR ACTUAL POSITIONS</Text>
      </Pressable>

      <Pressable onPress={() => onNavigate("AiSignal")} style={({ pressed }) => [styles.terminalPanel, terminalBorder, { opacity: pressed ? 0.72 : 1 }]} testID="home-ai-insights">
        <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>AI INSIGHTS</Text><Text style={[styles.panelCode, { color: signal }]}>READ ONLY</Text></View>
        <Text style={[styles.aiState, { color: aiInsightAvailable ? signal : theme.colors.textMuted }]}>{aiInsightAvailable ? "VERIFIED THESIS" : "NO VERIFIED THESIS"}</Text>
        <Text numberOfLines={3} style={[styles.panelMeta, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? ai?.thesis : "NUSA는 검증된 근거가 없으면 판단을 만들어내지 않습니다."}</Text>
      </Pressable>
    </View>

    <View style={[styles.riskPanel, terminalBorder]} testID="home-risk-authority">
      <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: theme.colors.text }]}>RISK AUTHORITY</Text><Text style={[styles.panelCode, { color: signal }]}>LEVEL 0</Text></View>
      <View style={styles.riskRows}>
        <View style={[styles.riskRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.riskKey, { color: theme.colors.textMuted }]}>TRADE PERMISSION</Text><Text style={[styles.riskValue, { color: theme.colors.text }]}>PAPER ONLY</Text></View>
        <View style={[styles.riskRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.riskKey, { color: theme.colors.textMuted }]}>AI AUTHORITY</Text><Text style={[styles.riskValue, { color: signal }]}>ZERO</Text></View>
        <View style={[styles.riskRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.riskKey, { color: theme.colors.textMuted }]}>LIVE AUTHORITY</Text><Text style={[styles.riskValue, { color: theme.colors.text }]}>NONE</Text></View>
        <View style={[styles.riskRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.riskKey, { color: theme.colors.textMuted }]}>PRODUCTION MUTATION</Text><Text style={[styles.riskValue, { color: theme.colors.text }]}>FALSE</Text></View>
      </View>
    </View>

    <View style={styles.telemetryGrid} testID="home-telemetry-grid">
      <View style={[styles.telemetryCell, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Text style={[styles.telemetryLabel, { color: theme.colors.textMuted }]}>RUNTIME</Text><Text style={[styles.telemetryValue, { color: theme.colors.text }]}>{runtimeState ?? "STANDBY"}</Text></View>
      <View style={[styles.telemetryCell, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Text style={[styles.telemetryLabel, { color: theme.colors.textMuted }]}>AI AUTH</Text><Text style={[styles.telemetryValue, { color: signal }]}>ZERO</Text></View>
      <View style={[styles.telemetryCell, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Text style={[styles.telemetryLabel, { color: theme.colors.textMuted }]}>LIVE AUTH</Text><Text style={[styles.telemetryValue, { color: theme.colors.text }]}>NONE</Text></View>
      <View style={[styles.telemetryCell, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}><Text style={[styles.telemetryLabel, { color: theme.colors.textMuted }]}>MUTATION</Text><Text style={[styles.telemetryValue, { color: theme.colors.text }]}>FALSE</Text></View>
    </View>

    {disconnected ? <OperationalNotice title="PAPER 연결이 필요합니다" detail="연결 전에는 실제 PAPER 계좌와 판단 데이터를 표시하지 않습니다." tone="warning" actionLabel="PAPER 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}
    {readOnlyError ? <OperationalNotice title="시장 연결을 확인할 수 없습니다" detail="NUSA는 새로운 PAPER 판단을 보류합니다." tone="danger" actionLabel="설정에서 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}

    {!disconnected ? <View style={[styles.actionDeck, terminalBorder]} testID="home-next-action">
      <View style={styles.primaryCopy}><Text style={[styles.kicker, { color: signal }]}>NEXT DECISION</Text><Text style={[styles.actionDetail, { color: theme.colors.textMuted }]}>{primaryDetail}</Text></View>
      <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryButton, { borderColor: signal, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-next-action-button"><Text style={[styles.primaryLabel, { color: signal }]}>{primaryLabel}</Text></Pressable>
    </View> : null}

    {!disconnected ? <NusaButton label="PAPER 학습 보기" tone="neutral" onPress={onOpenPaperLearning} testID="home-paper-learning" /> : null}

    <View style={[styles.secondaryDiagnostics, { borderTopColor: theme.colors.border }]} testID="safety-card">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: diagnosticsOpen }} onPress={() => setDiagnosticsOpen((open) => !open)} style={({ pressed }) => [styles.diagnosticsToggle, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-diagnostics-toggle">
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SYSTEM / SAFETY</Text><Text style={[styles.diagnosticsToggleLabel, { color: theme.colors.text }]}>{diagnosticsOpen ? "CLOSE" : "OPEN"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : accountSource === "LOCAL" ? "LOCAL PAPER" : notConfigured ? "연결 필요" : "대기"} detail={statusLabel} tone={snapshot ? "success" : accountSource === "LOCAL" ? "info" : "warning"} />
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
  brandMeta: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.8 },
  terminalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  terminalPanel: { flexGrow: 1, flexBasis: 160, minHeight: 132, borderWidth: 1, padding: 12, gap: 8 },
  environmentPanel: { minHeight: 154 },
  marketPanel: { minHeight: 154 },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelTitle: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7 },
  panelCode: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1 },
  panelMeta: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.45 },
  bigStatus: { marginTop: 8, fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: 0.7 },
  authorityMiniRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 5 },
  authorityMini: { fontSize: 8, lineHeight: 11, fontWeight: "800", letterSpacing: 0.8 },
  authorityMiniValue: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 0.8 },
  marketHeadline: { marginTop: 8, fontSize: 15, lineHeight: 18, fontWeight: "900", letterSpacing: 0.4 },
  pulseBars: { height: 42, flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 2 },
  pulseBar: { flex: 1, minWidth: 2 },
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
  metricMatrix: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metricTile: { width: "48%", borderWidth: 1, padding: 8, minHeight: 58, justifyContent: "space-between" },
  metricKey: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.8 },
  metricNumber: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
  unavailableTitle: { marginTop: 12, fontSize: 14, lineHeight: 18, fontWeight: "900", letterSpacing: 0.7 },
  signalStage: { borderWidth: 1, padding: 14, overflow: "hidden" },
  stageTitle: { marginTop: 3, fontSize: 24, lineHeight: 28, fontWeight: "900", letterSpacing: 0.6 },
  decisionState: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 1.3 },
  terrainHero: { position: "relative", height: 260, marginTop: 10, overflow: "hidden", justifyContent: "center" },
  crosshairH: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, opacity: 0.7 },
  crosshairV: { position: "absolute", top: 0, bottom: 22, left: "50%", width: 1, opacity: 0.55 },
  scanlineA: { position: "absolute", width: 1, height: 52, left: "28%", top: 70, opacity: 0.45 },
  scanlineB: { position: "absolute", width: 1, height: 72, right: "23%", bottom: 58, opacity: 0.28 },
  signalLegend: { position: "absolute", left: 4, right: 4, bottom: 2, flexDirection: "row", justifyContent: "space-between" },
  signalLegendText: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.4 },
  decisionCopy: { borderTopWidth: 1, paddingTop: 14, gap: 6 },
  judgement: { fontSize: 19, lineHeight: 26, fontWeight: "900" },
  matrixRows: { gap: 5, marginTop: 4 },
  matrixRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  matrixLabel: { width: 58, fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 0.45 },
  matrixCell: { flex: 1, height: 12 },
  aiState: { marginTop: 16, fontSize: 15, lineHeight: 19, fontWeight: "900", letterSpacing: 0.6 },
  riskPanel: { borderWidth: 1, padding: 12, gap: 10 },
  riskRows: { gap: 7 },
  riskRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 6 },
  riskKey: { fontSize: 8, lineHeight: 11, fontWeight: "800", letterSpacing: 0.65 },
  riskValue: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 0.7 },
  telemetryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  telemetryCell: { width: "48.7%", borderWidth: 1, minHeight: 72, padding: 11, justifyContent: "space-between" },
  telemetryLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.3 },
  telemetryValue: { fontSize: 17, lineHeight: 21, fontWeight: "900", letterSpacing: 0.5 },
  actionDeck: { borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 14 },
  primaryCopy: { flex: 1, gap: 5 },
  actionDetail: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  primaryButton: { borderWidth: 1, minHeight: 44, minWidth: 112, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 0.9 },
  secondaryDiagnostics: { borderTopWidth: 1, paddingTop: 12 },
  diagnosticsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diagnosticsToggleLabel: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.8 },
});