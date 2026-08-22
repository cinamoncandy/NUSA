import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
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
}

const NUSA_ACCENT = "#C8FF3D";
const NUSA_ACCENT_SOFT = "rgba(200,255,61,0.09)";
const NUSA_PANEL = "#090B0D";
const NUSA_PANEL_RAISED = "#0D1012";
const NUSA_GRID = "#1B2220";

function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" || health === "ONLINE" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning";
}

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onGoSettings, onNavigate }: HomeViewProps) {
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
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : undefined;
  const disconnected = notConfigured != null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const blocked = Boolean(notConfigured || readOnlyError || !signalReady);
  const statusLabel = snapshot ? `PAPER ${signalReady ? "READY" : "CHECK"}` : notConfigured ? "PAPER CONNECT" : "PAPER WAIT";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = aiInsightAvailable ? "NUSA 검증 분석 신호" : signalReady ? "NUSA 시장 분석 중" : "NUSA 시장 연결 대기";

  const decisionState = aiInsightAvailable ? "VERIFIED" : signalReady ? "PROCESSING" : "WAITING";
  const decisionTitle = aiInsightAvailable ? (ai?.thesis ?? "") : blocked ? "시장 연결이 필요합니다" : "시장 구조를 분석하고 있습니다";
  const decisionDetail = notConfigured
    ? "PAPER 시장 데이터를 연결하면 NUSA가 분석을 시작합니다."
    : readOnlyError
      ? "현재 연결 상태를 복구한 뒤 시장 판단을 다시 확인합니다."
      : aiInsightAvailable
        ? `검증된 근거 ${ai?.evidenceReferences.length ?? 0}개를 현재 판단에 반영했습니다.`
        : signalReady
          ? "시장 데이터는 준비됐습니다. 충분한 근거가 모일 때까지 실행 판단을 보류합니다."
          : "시장 상태와 연결 상태를 확인합니다.";
  const primaryLabel = notConfigured ? "CONNECT PAPER" : readOnlyError ? "CHECK CONNECTION" : aiInsightAvailable ? "OPEN ANALYSIS" : "OPEN MARKET";
  const runPrimaryAction = () => {
    if (notConfigured || readOnlyError) { onGoSettings(); return; }
    onNavigate(aiInsightAvailable ? "AiSignal" : "Markets");
  };

  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    gap: tablet ? 20 : 10,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? profile.hero.tabletBalanceSize : Math.min(profile.hero.balanceSize, 42),
    lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : Math.min(profile.hero.balanceLineHeight, 47),
    letterSpacing: -1.6,
    color: theme.colors.text,
  } as const;

  return <ScrollView
    style={{ backgroundColor: "#050607" }}
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={NUSA_ACCENT} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.topbar}>
      <View>
        <Text style={[styles.wordmark, { color: NUSA_ACCENT }]}>NUSA</Text>
        <Text style={[styles.topCaption, { color: theme.colors.textMuted }]}>INTELLIGENCE SYSTEM / MOBILE</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <View style={styles.systemRail}>
      <View style={styles.systemItem}><View style={[styles.modeDot, { backgroundColor: signalReady ? NUSA_ACCENT : theme.colors.textMuted }]} /><Text style={styles.systemStrong}>PAPER</Text></View>
      <Text style={styles.systemMeta}>AI READ ONLY</Text>
      <Text style={styles.systemMeta}>LIVE NONE</Text>
      <Text style={[styles.systemMeta, { color: NUSA_ACCENT }]}>{decisionState}</Text>
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={styles.heroGrid} testID="account-hero-card">
        <View style={styles.heroTopline}>
          <Text style={styles.terminalLabel}>ACCOUNT / PAPER EQUITY</Text>
          <Pressable accessibilityRole="button" onPress={() => onNavigate("Portfolio")} testID="home-portfolio-shortcut">
            <Text style={styles.terminalLink}>PORTFOLIO ↗</Text>
          </Pressable>
        </View>
        {disconnected ? <Text style={styles.placeholder} testID="home-equity-placeholder">DATA OFFLINE</Text> : <>
          <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? NUSA_ACCENT : theme.colors.danger }]}>
              {totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
            </Text>
            <Text style={styles.meta}>TOTAL PAPER PNL</Text>
          </View>
        </>}
        {cashEnvelope ? <View style={styles.cashGrid} testID="home-cash-allocation">
          <View style={styles.cashMetric} testID="home-investable-cash"><Text style={styles.cashLabel}>INVESTABLE / {cashEnvelope.investmentPercent}%</Text><Text style={styles.cashValue}>{krw(cashEnvelope.investableCash)}</Text></View>
          <View style={styles.cashMetric} testID="home-reserved-cash"><Text style={styles.cashLabel}>RESERVE / {cashEnvelope.reservePercent}%</Text><Text style={styles.cashValue}>{krw(cashEnvelope.reservedCash)}</Text></View>
        </View> : null}
      </View>
    </MotionReveal>

    <View testID="ai-card">
      <View style={styles.intelligencePanel} testID="home-decision-stage">
        <View style={styles.intelligenceHeader}>
          <View>
            <Text style={styles.terminalLabel}>MARKET INTELLIGENCE</Text>
            <Text style={[styles.decisionState, { color: aiInsightAvailable ? NUSA_ACCENT : theme.colors.textMuted }]}>{decisionState}</Text>
          </View>
          {calibratedConfidence ? <View style={styles.confidenceBox}><Text style={styles.confidence}>{calibratedConfidence}</Text><Text style={styles.confidenceMeta}>CONF.</Text></View> : null}
        </View>

        <View style={styles.signalFrame}>
          <View style={styles.scanline} />
          <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
          <View style={styles.signalFooter}><Text style={styles.signalCode}>SIGNAL FIELD / 01</Text><Text style={styles.signalCode}>{signalReady ? "FEED ACTIVE" : "FEED HOLD"}</Text></View>
        </View>

        <View style={styles.decisionCopy} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
          <Text style={styles.judgement}>{decisionTitle}</Text>
          <Text style={styles.body}>{decisionDetail}</Text>
          <View style={styles.readOnlyRow}><View style={styles.readOnlyDot} /><Text style={styles.meta}>AI ZERO AUTHORITY / READ ONLY / NO EXECUTION</Text></View>
        </View>

        <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-next-action-button">
          <Text style={styles.primaryLabel}>{primaryLabel}</Text><Text style={styles.primaryArrow}>↗</Text>
        </Pressable>
      </View>
    </View>

    {disconnected ? <OperationalNotice title="PAPER를 연결하면 시장 분석과 모의거래를 시작합니다" tone="warning" actionLabel="PAPER 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : readOnlyError ? <OperationalNotice title="시장 연결을 확인할 수 없습니다" detail="NUSA는 안전하게 새로운 PAPER 판단을 보류하고 있습니다." tone="danger" actionLabel="설정에서 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}

    <View style={styles.processStrip} testID="home-next-action">
      <Text style={styles.terminalLabel}>PROCESS</Text>
      <View style={styles.processTrack}><View style={[styles.processFill, { width: signalReady ? "78%" : snapshot ? "46%" : "22%" }]} /></View>
      <Text style={styles.processValue}>{aiInsightAvailable ? "EVIDENCE VERIFIED" : signalReady ? "ANALYZING MARKET" : "WAITING FOR FEED"}</Text>
    </View>

    <View style={styles.secondaryDiagnostics} testID="safety-card">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: diagnosticsOpen }} onPress={() => setDiagnosticsOpen((open) => !open)} style={({ pressed }) => [styles.diagnosticsToggle, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-diagnostics-toggle">
        <View><Text style={styles.terminalLabel}>SYSTEM DIAGNOSTICS</Text><Text style={styles.diagnosticsToggleLabel}>{diagnosticsOpen ? "CLOSE STATUS GRID" : "OPEN STATUS GRID"}</Text></View><Text style={styles.terminalLink}>{diagnosticsOpen ? "−" : "+"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View style={styles.diagnosticsBody} testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : notConfigured ? "연결 필요" : "대기"} detail={`PAPER 상태 신호: ${statusLabel}`} tone={snapshot ? "success" : "warning"} />
        <CompactMetric label="안전 게이트" value={snapshot?.readyForPaperOperations ? "준비됨" : "차단"} detail="PAPER-only · Kill Switch 보호" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} />
        <CompactMetric label="AI 분석" value={aiInsightAvailable ? "검증됨" : "판단 보류"} detail="AI ZERO AUTHORITY · READ ONLY" tone={aiInsightAvailable ? "info" : "default"} />
        <CompactMetric label="LIVE 권한" value="NONE" detail="실거래 mutation 없음" />
        <CompactMetric label="Production mutation" value="false" detail="fail-closed" />
        {aiInsightAvailable ? <InsightPanel title="MARKET INTELLIGENCE" thesis={ai?.thesis ?? ""} meta={`근거 ${ai?.evidenceReferences.length ?? 0}개 · READ ONLY`} confidenceLabel={calibratedConfidence} /> : null}
      </View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  topbar: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wordmark: { fontSize: 22, lineHeight: 25, fontWeight: "900", letterSpacing: 2.6 },
  topCaption: { marginTop: 2, fontSize: 8, lineHeight: 11, fontWeight: "700", letterSpacing: 1.4 },
  systemRail: { minHeight: 34, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: NUSA_GRID, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 2 },
  systemItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  modeDot: { width: 5, height: 5, borderRadius: 9999 },
  systemStrong: { color: "#F5F7F2", fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 1 },
  systemMeta: { color: "#7F8984", fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: .7 },
  heroGrid: { backgroundColor: NUSA_PANEL, borderWidth: 1, borderColor: NUSA_GRID, padding: 16, gap: 10, overflow: "hidden" },
  heroTopline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  terminalLabel: { color: "#8B948F", fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1.4 },
  terminalLink: { color: NUSA_ACCENT, fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: .8 },
  placeholder: { color: "#7F8984", fontSize: 24, lineHeight: 30, fontWeight: "800", paddingVertical: 18, letterSpacing: 1 },
  balance: { fontWeight: "850", fontVariant: ["tabular-nums"] },
  pnlRow: { minHeight: 20, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  pnlValue: { fontSize: 13, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  meta: { color: "#7F8984", fontSize: 9, lineHeight: 14, fontWeight: "700", letterSpacing: .55 },
  cashGrid: { flexDirection: "row", gap: 8, paddingTop: 4 },
  cashMetric: { flex: 1, backgroundColor: NUSA_PANEL_RAISED, borderWidth: StyleSheet.hairlineWidth, borderColor: NUSA_GRID, padding: 10, gap: 4 },
  cashLabel: { color: "#737D77", fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: .6 },
  cashValue: { color: "#F5F7F2", fontSize: 13, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  intelligencePanel: { backgroundColor: NUSA_PANEL, borderWidth: 1, borderColor: "#2B352E", padding: 14, gap: 12, overflow: "hidden" },
  intelligenceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  decisionState: { marginTop: 3, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.2 },
  confidenceBox: { minWidth: 54, backgroundColor: NUSA_ACCENT_SOFT, borderWidth: 1, borderColor: "#536A29", paddingHorizontal: 9, paddingVertical: 6, alignItems: "flex-end" },
  confidence: { color: NUSA_ACCENT, fontSize: 14, lineHeight: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  confidenceMeta: { color: "#7F8E67", fontSize: 7, lineHeight: 9, fontWeight: "800", letterSpacing: .8 },
  signalFrame: { minHeight: 138, backgroundColor: "#060807", borderWidth: StyleSheet.hairlineWidth, borderColor: "#263029", paddingHorizontal: 8, paddingTop: 6, justifyContent: "center", overflow: "hidden" },
  scanline: { position: "absolute", top: 16, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: NUSA_ACCENT, opacity: .24 },
  signalFooter: { position: "absolute", left: 8, right: 8, bottom: 6, flexDirection: "row", justifyContent: "space-between" },
  signalCode: { color: "#5E6A62", fontSize: 7, lineHeight: 10, fontWeight: "700", letterSpacing: .75 },
  decisionCopy: { gap: 7 },
  judgement: { color: "#F5F7F2", fontSize: 20, lineHeight: 28, fontWeight: "750", letterSpacing: -.35 },
  body: { color: "#939C97", fontSize: 11, lineHeight: 18, fontWeight: "500" },
  readOnlyRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 3 },
  readOnlyDot: { width: 5, height: 5, borderRadius: 9999, backgroundColor: NUSA_ACCENT },
  primaryButton: { minHeight: 46, backgroundColor: NUSA_ACCENT, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryLabel: { color: "#080A08", fontSize: 11, lineHeight: 16, fontWeight: "900", letterSpacing: .7 },
  primaryArrow: { color: "#080A08", fontSize: 18, lineHeight: 20, fontWeight: "900" },
  processStrip: { borderWidth: StyleSheet.hairlineWidth, borderColor: NUSA_GRID, backgroundColor: "#070908", padding: 10, gap: 7 },
  processTrack: { height: 3, backgroundColor: "#161C18", overflow: "hidden" },
  processFill: { height: 3, backgroundColor: NUSA_ACCENT },
  processValue: { color: "#D9DED9", fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: .7 },
  secondaryDiagnostics: { gap: 8 },
  diagnosticsToggle: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderColor: NUSA_GRID, backgroundColor: NUSA_PANEL, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diagnosticsToggleLabel: { color: "#EEF2EC", marginTop: 2, fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: .5 },
  diagnosticsBody: { gap: 8 },
});