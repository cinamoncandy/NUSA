import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
import { CompactMetric, OperationalNotice, QuietStatus } from "./uxPrimitives";
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

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" || health === "ONLINE"
    ? "success"
    : health === "FAIL_CLOSED" || health === "DOWN"
      ? "danger"
      : "warning";
}

function ActionTile({ label, detail, onPress, testID }: Readonly<{ label: string; detail: string; onPress: () => void; testID: string }>) {
  const { theme } = useTheme();
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [
      styles.actionTile,
      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 },
    ]}
    testID={testID}
  >
    <Text style={[styles.actionLabel, { color: theme.colors.text }]}>{label}</Text>
    <Text style={[styles.actionDetail, { color: theme.colors.textMuted }]} numberOfLines={2}>{detail}</Text>
    <Text style={[styles.actionArrow, { color: theme.colors.aiSignalEnd }]}>↗</Text>
  </Pressable>;
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
    : null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const disconnected = notConfigured != null;
  const runtimeLiveEnabled = snapshot?.productionMutationAllowed === true;
  const statusLabel = snapshot
    ? `PAPER · ${signalReady ? "READY" : "CHECK"}`
    : disconnected
      ? "PAPER · CONNECT"
      : "PAPER · WAIT";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const liveLabel = runtimeLiveEnabled ? "AUTHORIZED" : "OFF";
  const liveTone = runtimeLiveEnabled ? "warning" as const : "success" as const;
  const terrainStrength = aiInsightAvailable ? Math.max(0.35, Math.min(1, ai?.confidence ?? 0.72)) : signalReady ? 0.58 : 0.22;

  const contentStyle = {
    paddingHorizontal: tablet ? 28 : 18,
    paddingTop: tablet ? 24 : 16,
    paddingBottom: 124,
    gap: tablet ? 22 : 16,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;

  const primaryLabel = disconnected ? "PAPER 연결하기" : readOnlyError ? "연결 복구" : aiInsightAvailable ? "AI 판단 보기" : "시장 열기";
  const primaryAction = () => {
    if (disconnected || readOnlyError) onGoSettings();
    else onNavigate(aiInsightAvailable ? "AiSignal" : "Markets");
  };

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.aiSignalEnd} refreshing={refreshing} onRefresh={onRefresh} />}
    showsVerticalScrollIndicator={false}
    testID="home-screen"
  >
    <View style={styles.topbar}>
      <View>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.topbarMeta, { color: theme.colors.textMuted }]}>AI TRADING CONTROL</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.heroCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID="account-hero-card">
        <View style={styles.heroHeader}>
          <View>
            <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>TOTAL PAPER EQUITY</Text>
            <Text style={[styles.heroCaption, { color: theme.colors.textMuted }]}>현재 운용 상태</Text>
          </View>
          <View style={[styles.liveBadge, { backgroundColor: runtimeLiveEnabled ? theme.colors.primarySoft : theme.colors.surfaceRaised, borderColor: theme.colors.borderStrong }]}>
            <View style={[styles.liveDot, { backgroundColor: runtimeLiveEnabled ? theme.colors.warning : theme.colors.textMuted }]} />
            <Text style={[styles.liveBadgeText, { color: theme.colors.text }]}>LIVE {liveLabel}</Text>
          </View>
        </View>

        {disconnected ? <Text style={[styles.emptyBalance, { color: theme.colors.textMuted }]} testID="home-equity-placeholder">PAPER 서버 연결 후 자산을 표시합니다.</Text> : <>
          <Text style={[styles.balance, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>
            {account ? krw(account.equity) : "-"}
          </Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>
              {totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
            </Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>누적 손익</Text>
          </View>
        </>}

        {cashEnvelope ? <View style={[styles.allocationRow, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation">
          <View style={styles.allocationMetric} testID="home-investable-cash">
            <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>투자 가능 · {cashEnvelope.investmentPercent}%</Text>
            <Text style={[styles.metricValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.allocationMetric} testID="home-reserved-cash">
            <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>보호 현금 · {cashEnvelope.reservePercent}%</Text>
            <Text style={[styles.metricValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text>
          </View>
        </View> : null}
      </View>
    </MotionReveal>

    <View style={[styles.signalCard, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.borderStrong }]} testID="ai-card">
      <View style={styles.signalHeader}>
        <View>
          <Text style={[styles.kicker, { color: theme.colors.aiSignalEnd }]}>NUSA VIEW</Text>
          <Text style={[styles.signalTitle, { color: theme.colors.text }]}>{aiInsightAvailable ? "검증된 AI 판단" : signalReady ? "시장 분석 중" : "분석 대기"}</Text>
        </View>
        <Text style={[styles.signalState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>
          {aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING"}
        </Text>
      </View>

      <View style={styles.signalVisual} testID="home-decision-stage">
        <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel="NUSA AI signal" testID="home-signal-trace" />
      </View>

      <View testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
        <Text style={[styles.thesis, { color: theme.colors.text }]} numberOfLines={3}>
          {aiInsightAvailable ? ai?.thesis : disconnected ? "시장 데이터를 연결하면 NUSA가 분석을 시작합니다." : readOnlyError ? "연결 상태를 확인한 뒤 판단을 재개합니다." : "신뢰할 수 있는 신호가 생길 때까지 기다립니다."}
        </Text>
        <View style={styles.signalMetaRow}>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `근거 ${ai?.evidenceReferences.length ?? 0}개` : "AI ZERO AUTHORITY"}</Text>
          {calibratedConfidence ? <Text style={[styles.confidence, { color: theme.colors.aiSignalEnd }]}>{calibratedConfidence}</Text> : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={primaryAction}
        style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.colors.primary, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-next-action-button"
      >
        <Text style={[styles.primaryButtonText, { color: theme.colors.onPrimary }]}>{primaryLabel}</Text>
        <Text style={[styles.primaryArrow, { color: theme.colors.onPrimary }]}>→</Text>
      </Pressable>
    </View>

    {disconnected ? <OperationalNotice
      title="PAPER 연결이 필요합니다"
      detail="설정에서 Cloud endpoint를 검증하면 자산, AI 분석, PAPER 주문 기능이 열립니다."
      tone="warning"
      actionLabel="설정 열기"
      onAction={onGoSettings}
      actionTestID="dashboard-open-settings"
      testID="home-operational-notice"
    /> : readOnlyError ? <OperationalNotice
      title="현재 PAPER 상태를 불러올 수 없습니다"
      detail="새 판단은 보류됩니다. 연결 상태를 복구한 뒤 다시 확인합니다."
      tone="danger"
      actionLabel="연결 확인"
      onAction={onGoSettings}
      actionTestID="dashboard-open-settings"
      testID="home-operational-notice"
    /> : null}

    <View>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>빠른 이동</Text>
        <Text style={[styles.sectionMeta, { color: theme.colors.textMuted }]}>핵심 기능만 바로 접근</Text>
      </View>
      <View style={[styles.actionGrid, tablet && styles.actionGridTablet]} testID="home-next-action">
        <ActionTile label="MARKET" detail="실시간 업비트 시세와 차트" onPress={() => onNavigate("Markets")} testID="home-action-market" />
        <ActionTile label="AI VIEW" detail="현재 신호와 판단 근거" onPress={() => onNavigate("AiSignal")} testID="home-action-ai" />
        <ActionTile label="PORTFOLIO" detail="계좌·포지션·손익 확인" onPress={() => onNavigate("Portfolio")} testID="home-action-portfolio" />
      </View>
    </View>

    <View style={[styles.safetyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID="safety-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: diagnosticsOpen }}
        onPress={() => setDiagnosticsOpen((current) => !current)}
        style={({ pressed }) => [styles.safetyHeader, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-diagnostics-toggle"
      >
        <View>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SAFETY & RUNTIME</Text>
          <Text style={[styles.safetyTitle, { color: theme.colors.text }]}>운영 상태</Text>
        </View>
        <Text style={[styles.safetyToggle, { color: theme.colors.aiSignalEnd }]}>{diagnosticsOpen ? "닫기" : "보기"}</Text>
      </Pressable>
      <View style={styles.statusStrip}>
        <QuietStatus label={signalReady ? "RISK READY" : "RISK BLOCK"} tone={signalReady ? "success" : "warning"} />
        <QuietStatus label={`LIVE ${liveLabel}`} tone={liveTone} />
        <QuietStatus label="WITHDRAW OFF" tone="success" />
      </View>
      {diagnosticsOpen ? <View style={[styles.diagnostics, { borderTopColor: theme.colors.border }]} testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : disconnected ? "연결 필요" : "대기"} detail={statusLabel} tone={snapshot ? "success" : "warning"} />
        <CompactMetric label="안전 게이트" value={signalReady ? "준비됨" : "차단"} detail="Kill Switch / Risk 보호" tone={signalReady ? "success" : "warning"} />
        <CompactMetric label="AI 분석" value={aiInsightAvailable ? "검증됨" : "대기"} detail="AI는 실행 권한을 직접 갖지 않음" tone={aiInsightAvailable ? "info" : "default"} />
        <CompactMetric label="LIVE capability" value={liveLabel} detail={runtimeLiveEnabled ? "runtime authority active" : "기본 비활성"} tone={runtimeLiveEnabled ? "warning" : "default"} />
      </View> : null}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  topbar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wordmark: { fontSize: 22, lineHeight: 26, fontWeight: "900", letterSpacing: 2.4 },
  topbarMeta: { marginTop: 2, fontSize: 9, lineHeight: 12, fontWeight: "800", letterSpacing: 1.5 },
  kicker: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1.45 },
  heroCard: { borderWidth: 1, borderRadius: 18, padding: 20, gap: 10, overflow: "hidden" },
  heroHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  heroCaption: { marginTop: 3, fontSize: 12, lineHeight: 18 },
  liveBadge: { minHeight: 30, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 999 },
  liveBadgeText: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8 },
  balance: { marginTop: 4, fontSize: 42, lineHeight: 48, fontWeight: "800", letterSpacing: -1.8, fontVariant: ["tabular-nums"] },
  emptyBalance: { paddingVertical: 20, fontSize: 15, lineHeight: 22 },
  pnlRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  pnlValue: { fontSize: 15, lineHeight: 21, fontWeight: "800", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 11, lineHeight: 16 },
  allocationRow: { marginTop: 6, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "stretch", gap: 12 },
  allocationMetric: { flex: 1, gap: 4 },
  metricLabel: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  metricValue: { fontSize: 15, lineHeight: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  metricDivider: { width: StyleSheet.hairlineWidth },
  signalCard: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 14, overflow: "hidden" },
  signalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  signalTitle: { marginTop: 4, fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.5 },
  signalState: { fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.2 },
  signalVisual: { minHeight: 92, justifyContent: "center" },
  thesis: { fontSize: 16, lineHeight: 24, fontWeight: "650" as "600", letterSpacing: -0.15 },
  signalMetaRow: { marginTop: 8, minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  confidence: { fontSize: 14, lineHeight: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  primaryButton: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryButtonText: { fontSize: 14, lineHeight: 20, fontWeight: "900", letterSpacing: -0.15 },
  primaryArrow: { fontSize: 20, lineHeight: 22, fontWeight: "800" },
  sectionHeader: { marginBottom: 10, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  sectionMeta: { fontSize: 10, lineHeight: 14 },
  actionGrid: { gap: 9 },
  actionGridTablet: { flexDirection: "row" },
  actionTile: { minHeight: 84, flex: 1, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 13, justifyContent: "center" },
  actionLabel: { fontSize: 13, lineHeight: 18, fontWeight: "900", letterSpacing: 0.5 },
  actionDetail: { maxWidth: "84%", marginTop: 4, fontSize: 11, lineHeight: 16 },
  actionArrow: { position: "absolute", right: 14, top: 13, fontSize: 16, lineHeight: 18, fontWeight: "800" },
  safetyCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  safetyHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  safetyTitle: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  safetyToggle: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  statusStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  diagnostics: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
});
