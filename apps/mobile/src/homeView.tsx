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
  const statusLabel = snapshot ? `PAPER · ${signalReady ? "READY" : "점검 필요"}` : notConfigured ? "PAPER · 연결 필요" : "PAPER · 대기";
  const statusTone = snapshot ? healthTone(snapshot.health) : "warning" as const;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = aiInsightAvailable ? "NUSA 검증 분석 신호" : signalReady ? "NUSA 시장 분석 중" : "NUSA 시장 연결 대기";

  const decisionState = aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING";
  const decisionTitle = aiInsightAvailable ? (ai?.thesis ?? "") : blocked ? "시장 연결이 필요합니다" : "판단을 만들고 있습니다";
  const decisionDetail = notConfigured
    ? "PAPER 시장 데이터를 연결하면 NUSA가 분석을 시작합니다."
    : readOnlyError
      ? "현재 연결 상태를 복구한 뒤 시장 판단을 다시 확인합니다."
      : aiInsightAvailable
        ? `근거 ${ai?.evidenceReferences.length ?? 0}개를 검증해 만든 현재 판단입니다.`
        : signalReady
          ? "시장 데이터는 준비됐습니다. 검증 가능한 근거가 모일 때까지 판단을 보류합니다."
          : "시장 상태와 연결 상태를 확인합니다.";
  const primaryLabel = notConfigured ? "PAPER 연결" : readOnlyError ? "다시 확인" : aiInsightAvailable ? "분석 보기" : "시장 보기";
  const runPrimaryAction = () => {
    if (notConfigured || readOnlyError) { onGoSettings(); return; }
    onNavigate(aiInsightAvailable ? "AiSignal" : "Markets");
  };

  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    gap: tablet ? 22 : profile.screen.sectionGap,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? profile.hero.tabletBalanceSize : profile.hero.balanceSize,
    lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : profile.hero.balanceLineHeight,
    letterSpacing: profile.hero.balanceLetterSpacing,
    color: theme.colors.text,
  } as const;

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.topbar}>
      <View>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.topCaption, { color: theme.colors.textMuted }]}>PERSONAL INTELLIGENCE</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <View style={[styles.modeRail, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]}> 
      <View style={[styles.modeDot, { backgroundColor: signalReady ? theme.colors.aiSignalEnd : theme.colors.textMuted }]} />
      <Text style={[styles.modeLabel, { color: theme.colors.text }]}>PAPER</Text>
      <Text style={[styles.modeDivider, { color: theme.colors.borderStrong }]}>/</Text>
      <Text style={[styles.modeMeta, { color: theme.colors.textMuted }]}>AI READ ONLY</Text>
      <View style={styles.modeSpacer} />
      <Text style={[styles.modeMeta, { color: theme.colors.textMuted }]}>LIVE NONE</Text>
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={[styles.equityCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID="account-hero-card">
        <View style={styles.sectionHead}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PORTFOLIO</Text>
          <Pressable accessibilityRole="button" onPress={() => onNavigate("Portfolio")} testID="home-portfolio-shortcut">
            <Text style={[styles.link, { color: theme.colors.info }]}>상세 보기</Text>
          </Pressable>
        </View>
        {disconnected ? <Text style={[styles.placeholder, { color: theme.colors.textMuted }]} testID="home-equity-placeholder">연결 후 표시</Text> : <>
          <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>{account ? krw(account.equity) : "-"}</Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>
              {totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
            </Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>누적 PAPER 손익</Text>
          </View>
        </>}
        {cashEnvelope ? <View style={[styles.cashGrid, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation">
          <View style={styles.cashMetric} testID="home-investable-cash">
            <Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>투자 가능 · {cashEnvelope.investmentPercent}%</Text>
            <Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text>
          </View>
          <View style={[styles.cashDivider, { backgroundColor: theme.colors.border }]} />
          <View style={styles.cashMetric} testID="home-reserved-cash">
            <Text style={[styles.cashLabel, { color: theme.colors.textMuted }]}>보호 현금 · {cashEnvelope.reservePercent}%</Text>
            <Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text>
          </View>
        </View> : null}
      </View>
    </MotionReveal>

    <View testID="ai-card">
      <View style={[styles.decisionCard, { backgroundColor: theme.colors.surface, borderColor: aiInsightAvailable ? theme.colors.aiSignalMid : theme.colors.borderStrong }]} testID="home-decision-stage">
        <View style={styles.sectionHead}>
          <View>
            <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NUSA VIEW</Text>
            <Text style={[styles.decisionState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{decisionState}</Text>
          </View>
          {calibratedConfidence ? <View style={[styles.confidencePill, { backgroundColor: theme.colors.aiSignalSoft }]}>
            <Text style={[styles.confidence, { color: theme.colors.aiSignalEnd }]}>{calibratedConfidence}</Text>
          </View> : null}
        </View>

        <View style={[styles.signalField, { backgroundColor: theme.colors.surfaceSunken }]}>
          <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
        </View>

        <View style={styles.decisionCopy} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
          <Text style={[styles.judgement, { color: theme.colors.text }]}>{decisionTitle}</Text>
          <Text style={[styles.body, { color: theme.colors.textMuted }]}>{decisionDetail}</Text>
          <View style={styles.readOnlyRow}>
            <View style={[styles.readOnlyDot, { backgroundColor: theme.colors.aiSignalEnd }]} />
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>AI ZERO AUTHORITY · READ ONLY</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={runPrimaryAction}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.colors.primary, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
          testID="home-next-action-button"
        >
          <Text style={[styles.primaryLabel, { color: theme.colors.onPrimary }]}>{primaryLabel}</Text>
          <Text style={[styles.primaryArrow, { color: theme.colors.onPrimary }]}>→</Text>
        </Pressable>
      </View>
    </View>

    {disconnected ? <OperationalNotice
      title="PAPER를 연결하면 시장 분석과 모의거래를 시작합니다"
      tone="warning"
      actionLabel="PAPER 연결"
      onAction={onGoSettings}
      actionTestID="dashboard-open-settings"
      testID="home-operational-notice"
    /> : readOnlyError ? <OperationalNotice
      title="시장 연결을 확인할 수 없습니다"
      detail="NUSA는 안전하게 새로운 PAPER 판단을 보류하고 있습니다."
      tone="danger"
      actionLabel="설정에서 연결"
      onAction={onGoSettings}
      actionTestID="dashboard-open-settings"
      testID="home-operational-notice"
    /> : null}

    <View style={[styles.nextStrip, { borderColor: theme.colors.border }]} testID="home-next-action">
      <View style={styles.nextCopy}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text>
        <Text style={[styles.nextTitle, { color: theme.colors.text }]}>{aiInsightAvailable ? "근거 확인" : signalReady ? "시장 관찰" : "연결 점검"}</Text>
      </View>
      <Text style={[styles.nextDetail, { color: theme.colors.textMuted }]}>{decisionDetail}</Text>
    </View>

    <View style={styles.secondaryDiagnostics} testID="safety-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: diagnosticsOpen }}
        onPress={() => setDiagnosticsOpen((open) => !open)}
        style={({ pressed }) => [styles.diagnosticsToggle, { borderColor: theme.colors.border, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-diagnostics-toggle"
      >
        <View>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SYSTEM</Text>
          <Text style={[styles.diagnosticsToggleLabel, { color: theme.colors.text }]}>운영 진단</Text>
        </View>
        <Text style={[styles.link, { color: theme.colors.info }]}>{diagnosticsOpen ? "닫기" : "보기"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View style={styles.diagnosticsBody} testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : notConfigured ? "연결 필요" : "대기"} detail={`PAPER 상태 신호: ${statusLabel}`} tone={snapshot ? "success" : "warning"} />
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
  content: { width:"100%", alignSelf:"center" },
  topbar: { minHeight:50, flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap:16 },
  wordmark: { fontSize:19, lineHeight:23, fontWeight:"800", letterSpacing:2.4 },
  topCaption: { marginTop:2, fontSize:8, lineHeight:11, fontWeight:"700", letterSpacing:1.6 },
  modeRail: { minHeight:38, borderWidth:StyleSheet.hairlineWidth, borderRadius:12, paddingHorizontal:12, flexDirection:"row", alignItems:"center", gap:8 },
  modeDot: { width:6, height:6, borderRadius:9999 },
  modeLabel: { fontSize:10, lineHeight:14, fontWeight:"800", letterSpacing:1.1 },
  modeDivider: { fontSize:11 },
  modeMeta: { fontSize:9, lineHeight:13, fontWeight:"700", letterSpacing:.7 },
  modeSpacer: { flex:1 },
  equityCard: { borderWidth:StyleSheet.hairlineWidth, borderRadius:20, padding:20, gap:10, overflow:"hidden" },
  sectionHead: { flexDirection:"row", alignItems:"flex-start", justifyContent:"space-between", gap:16 },
  kicker: { fontSize:9, lineHeight:13, fontWeight:"800", letterSpacing:1.7 },
  link: { fontSize:11, lineHeight:16, fontWeight:"700" },
  placeholder: { fontSize:26, lineHeight:34, fontWeight:"700", paddingVertical:18 },
  balance: { fontWeight:"800", fontVariant:["tabular-nums"] },
  pnlRow: { minHeight:22, flexDirection:"row", alignItems:"baseline", gap:8, flexWrap:"wrap" },
  pnlValue: { fontSize:14, lineHeight:20, fontWeight:"700", fontVariant:["tabular-nums"] },
  meta: { fontSize:10, lineHeight:15, fontWeight:"600" },
  cashGrid: { flexDirection:"row", alignItems:"stretch", borderTopWidth:StyleSheet.hairlineWidth, paddingTop:14, marginTop:4 },
  cashMetric: { flex:1, gap:4 },
  cashDivider: { width:StyleSheet.hairlineWidth, marginHorizontal:14 },
  cashLabel: { fontSize:10, lineHeight:15, fontWeight:"600" },
  cashValue: { fontSize:15, lineHeight:21, fontWeight:"700", fontVariant:["tabular-nums"] },
  decisionCard: { borderWidth:1, borderRadius:24, padding:18, gap:16, overflow:"hidden" },
  decisionState: { marginTop:3, fontSize:10, lineHeight:14, fontWeight:"800", letterSpacing:1.2 },
  confidencePill: { minWidth:52, minHeight:30, borderRadius:9999, alignItems:"center", justifyContent:"center", paddingHorizontal:10 },
  confidence: { fontSize:12, lineHeight:16, fontWeight:"800", fontVariant:["tabular-nums"] },
  signalField: { minHeight:116, borderRadius:18, paddingHorizontal:8, justifyContent:"center", overflow:"hidden" },
  decisionCopy: { gap:7 },
  judgement: { fontSize:22, lineHeight:30, fontWeight:"700", letterSpacing:-.5 },
  body: { fontSize:12, lineHeight:19, fontWeight:"500" },
  readOnlyRow: { flexDirection:"row", alignItems:"center", gap:7, paddingTop:3 },
  readOnlyDot: { width:5, height:5, borderRadius:9999 },
  primaryButton: { minHeight:52, borderRadius:16, paddingHorizontal:16, flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  primaryLabel: { fontSize:14, lineHeight:20, fontWeight:"800" },
  primaryArrow: { fontSize:20, lineHeight:22, fontWeight:"700" },
  nextStrip: { borderTopWidth:StyleSheet.hairlineWidth, borderBottomWidth:StyleSheet.hairlineWidth, paddingVertical:14, gap:7 },
  nextCopy: { flexDirection:"row", alignItems:"baseline", justifyContent:"space-between", gap:12 },
  nextTitle: { fontSize:13, lineHeight:18, fontWeight:"700" },
  nextDetail: { fontSize:11, lineHeight:17, fontWeight:"500" },
  secondaryDiagnostics: { gap:10 },
  diagnosticsToggle: { minHeight:58, borderWidth:StyleSheet.hairlineWidth, borderRadius:16, paddingHorizontal:14, paddingVertical:10, flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  diagnosticsToggleLabel: { marginTop:2, fontSize:14, lineHeight:20, fontWeight:"700" },
  diagnosticsBody: { gap:8 },
});
