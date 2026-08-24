import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { NusaButton, TerrainSignal } from "./components";
import { CompactMetric, InsightPanel, OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { getHomeVisualProfile } from "./homeVisualProfile";

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

function krw(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function healthTone(health: string | undefined): "success" | "warning" | "danger" {
  return health === "HEALTHY" || health === "READY" || health === "ONLINE" || health === "RUNNING" ? "success" : health === "FAIL_CLOSED" || health === "DOWN" ? "danger" : "warning";
}

export function HomeView({ snapshot, investmentPercent, readOnlyError, notConfigured, refreshing, onRefresh, onGoSettings, onNavigate, onOpenPaperLearning }: HomeViewProps) {
  const { width } = useWindowDimensions();
  const { theme, preset } = useTheme();
  const profile = getHomeVisualProfile(preset);
  const tablet = width >= 768;
  const account = snapshot?.portfolio?.account ?? null;
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : undefined;
  const disconnected = notConfigured != null;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const runtimeState = snapshot?.operations.runtimeState;
  const statusLabel = snapshot ? `PAPER · ${runtimeState ?? (signalReady ? "READY" : "CHECK")}` : disconnected ? "PAPER · OFFLINE" : "PAPER · STANDBY";
  const primaryLabel = disconnected ? "CONNECT PAPER" : readOnlyError ? "RECOVER" : aiInsightAvailable ? "OPEN SIGNAL" : "OPEN MARKET";
  const primaryDetail = disconnected ? "PAPER 연결 후 모의계좌와 시장 판단을 표시합니다." : readOnlyError ? "연결 상태를 복구한 뒤 판단을 다시 확인합니다." : aiInsightAvailable ? "검증된 근거와 현재 NUSA 판단을 확인합니다." : "시장 데이터는 읽기 전용으로 분석 중입니다.";
  const runPrimaryAction = () => { if (disconnected || readOnlyError) return onGoSettings(); onNavigate(aiInsightAvailable ? "AiSignal" : "Markets"); };

  return <ScrollView contentContainerStyle={[styles.content, { maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth, paddingHorizontal: profile.screen.horizontalPadding, paddingTop: profile.screen.topPadding, paddingBottom: profile.screen.bottomPadding, gap: profile.screen.sectionGap }]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="home-screen">
    <View style={[styles.v3Banner, { borderColor: theme.colors.aiSignalEnd }]} testID="home-v3-command-surface">
      <View style={styles.v3Topline}><Text style={[styles.v3Mark, { color: theme.colors.aiSignalEnd }]}>NUSA // V3</Text><QuietStatus label={statusLabel} tone={snapshot ? healthTone(snapshot.health) : "warning"} testID="home-paper-status" /></View>
      <Text style={[styles.v3Title, { color: theme.colors.text }]}>COMMAND{`\n`}HOME</Text>
      <Text style={[styles.v3Subtitle, { color: theme.colors.textMuted }]}>PAPER INTELLIGENCE · READ ONLY · ZERO AUTHORITY</Text>
    </View>

    <View style={[styles.equityField, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong }]} testID="account-hero-card">
      <Text style={[styles.sectionIndex, { color: theme.colors.aiSignalEnd }]}>CAPITAL / 01</Text>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>TOTAL PAPER EQUITY</Text>
      <Text style={[styles.equity, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1} testID={disconnected ? "home-equity-placeholder" : undefined}>{disconnected ? "NO LINK" : account ? krw(account.equity) : "—"}</Text>
      <View style={styles.pnlLine}><Text style={[styles.pnl, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.aiSignalEnd : theme.colors.danger }]}>{totalPnl == null ? "P&L —" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text><Text style={[styles.micro, { color: theme.colors.textMuted }]}>CUMULATIVE P&L</Text></View>
      {cashEnvelope ? <View style={[styles.cashStrip, { borderTopColor: theme.colors.border }]} testID="home-cash-allocation"><View style={styles.cashBlock} testID="home-investable-cash"><Text style={[styles.micro, { color: theme.colors.textMuted }]}>DEPLOYABLE {cashEnvelope.investmentPercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.investableCash)}</Text></View><View style={styles.cashBlock} testID="home-reserved-cash"><Text style={[styles.micro, { color: theme.colors.textMuted }]}>RESERVE {cashEnvelope.reservePercent}%</Text><Text style={[styles.cashValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text></View></View> : null}
    </View>

    <View style={[styles.intelligenceField, { borderColor: theme.colors.aiSignalEnd }]} testID="ai-card">
      <View style={styles.signalHeader}><View><Text style={[styles.sectionIndex, { color: theme.colors.aiSignalEnd }]}>INTELLIGENCE / 02</Text><Text style={[styles.signalTitle, { color: theme.colors.text }]}>NUSA DECISION FIELD</Text></View><Text style={[styles.signalState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>{aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "HOLD"}</Text></View>
      <View style={styles.signalCanvas} testID="home-decision-stage"><TerrainSignal variant="symbolic" signalStrength={signalReady ? 0.96 : snapshot ? 0.5 : 0.22} accessibilityLabel="NUSA decision signal field" testID="home-signal-trace" /></View>
      <View style={[styles.decision, { borderTopColor: theme.colors.aiSignalEnd }]} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}><Text style={[styles.decisionText, { color: theme.colors.text }]}>{aiInsightAvailable ? ai?.thesis : disconnected ? "PAPER LINK REQUIRED" : "DECISION HOLD"}</Text><Text style={[styles.micro, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `EVIDENCE ${ai?.evidenceReferences.length ?? 0} · ${calibratedConfidence ?? "UNCALIBRATED"} · AI READ ONLY` : primaryDetail}</Text></View>
    </View>

    <View style={[styles.authorityStrip, { borderColor: theme.colors.borderStrong }]} testID="home-telemetry-grid"><View style={styles.authorityItem}><Text style={[styles.micro, { color: theme.colors.textMuted }]}>RUNTIME</Text><Text style={[styles.authorityValue, { color: theme.colors.text }]}>{runtimeState ?? "STANDBY"}</Text></View><View style={styles.authorityItem}><Text style={[styles.micro, { color: theme.colors.textMuted }]}>AI AUTH</Text><Text style={[styles.authorityValue, { color: theme.colors.aiSignalEnd }]}>ZERO</Text></View><View style={styles.authorityItem}><Text style={[styles.micro, { color: theme.colors.textMuted }]}>LIVE</Text><Text style={[styles.authorityValue, { color: theme.colors.text }]}>NONE</Text></View><View style={styles.authorityItem}><Text style={[styles.micro, { color: theme.colors.textMuted }]}>MUTATION</Text><Text style={[styles.authorityValue, { color: theme.colors.text }]}>FALSE</Text></View></View>

    {disconnected ? <OperationalNotice title="PAPER 연결이 필요합니다" detail="연결 전에는 실제 PAPER 계좌와 판단 데이터를 표시하지 않습니다." tone="warning" actionLabel="PAPER 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}
    {readOnlyError ? <OperationalNotice title="시장 연결을 확인할 수 없습니다" detail="NUSA는 새로운 PAPER 판단을 보류합니다." tone="danger" actionLabel="설정에서 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}

    {!disconnected ? <View style={[styles.actionBar, { borderColor: theme.colors.aiSignalEnd }]} testID="home-next-action"><View style={styles.actionCopy}><Text style={[styles.sectionIndex, { color: theme.colors.aiSignalEnd }]}>NEXT COMMAND</Text><Text style={[styles.actionDetail, { color: theme.colors.textMuted }]}>{primaryDetail}</Text></View><Pressable accessibilityRole="button" onPress={runPrimaryAction} style={[styles.actionButton, { borderColor: theme.colors.aiSignalEnd }]} testID="home-next-action-button"><Text style={[styles.actionLabel, { color: theme.colors.aiSignalEnd }]}>{primaryLabel}</Text></Pressable></View> : null}
    {!disconnected ? <NusaButton label="PAPER 학습 보기" tone="neutral" onPress={onOpenPaperLearning} testID="home-paper-learning" /> : null}

    <View style={[styles.safety, { borderTopColor: theme.colors.border }]} testID="safety-card"><Pressable accessibilityRole="button" accessibilityState={{ expanded: diagnosticsOpen }} onPress={() => setDiagnosticsOpen(v => !v)} style={styles.safetyToggle} testID="home-diagnostics-toggle"><Text style={[styles.sectionIndex, { color: theme.colors.textMuted }]}>SYSTEM / SAFETY</Text><Text style={[styles.actionLabel, { color: theme.colors.text }]}>{diagnosticsOpen ? "CLOSE" : "OPEN"}</Text></Pressable>{diagnosticsOpen ? <View testID="home-secondary-diagnostics"><CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : disconnected ? "연결 필요" : "대기"} detail={statusLabel} tone={snapshot ? "success" : "warning"} /><CompactMetric label="안전 게이트" value={snapshot?.readyForPaperOperations ? "준비됨" : "차단"} detail="PAPER-only · Kill Switch 보호" tone={snapshot?.readyForPaperOperations ? "success" : "warning"} /><CompactMetric label="AI 분석" value={aiInsightAvailable ? "검증됨" : "판단 보류"} detail="AI ZERO AUTHORITY · READ ONLY" tone={aiInsightAvailable ? "info" : "default"} /><CompactMetric label="LIVE 권한" value="NONE" detail="실거래 mutation 없음" /><CompactMetric label="Production mutation" value="false" detail="fail-closed" />{aiInsightAvailable ? <InsightPanel title="NUSA VIEW" thesis={ai?.thesis ?? ""} meta={`근거 ${ai?.evidenceReferences.length ?? 0}개 · READ ONLY`} confidenceLabel={calibratedConfidence} /> : null}</View> : null}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  v3Banner: { borderLeftWidth: 5, borderBottomWidth: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, minHeight: 190, justifyContent: "space-between" },
  v3Topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  v3Mark: { fontSize: 11, fontWeight: "900", letterSpacing: 2.4 },
  v3Title: { fontSize: 54, lineHeight: 50, fontWeight: "900", letterSpacing: -2.4 },
  v3Subtitle: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.5 },
  equityField: { borderWidth: 1, padding: 18, minHeight: 230 },
  sectionIndex: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.7 },
  label: { marginTop: 30, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  equity: { marginTop: 4, fontSize: 48, lineHeight: 56, fontWeight: "900", letterSpacing: -1.8, fontVariant: ["tabular-nums"] },
  pnlLine: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  pnl: { fontSize: 18, lineHeight: 23, fontWeight: "900", fontVariant: ["tabular-nums"] },
  micro: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1 },
  cashStrip: { borderTopWidth: 1, flexDirection: "row", gap: 18, marginTop: 20, paddingTop: 14 },
  cashBlock: { flex: 1, gap: 5 },
  cashValue: { fontSize: 15, fontWeight: "900" },
  intelligenceField: { borderWidth: 2, padding: 14, minHeight: 420 },
  signalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  signalTitle: { marginTop: 5, fontSize: 24, lineHeight: 28, fontWeight: "900" },
  signalState: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  signalCanvas: { height: 270, justifyContent: "center", overflow: "hidden" },
  decision: { borderTopWidth: 2, paddingTop: 14, gap: 8 },
  decisionText: { fontSize: 20, lineHeight: 27, fontWeight: "900" },
  authorityStrip: { borderWidth: 1, flexDirection: "row", flexWrap: "wrap" },
  authorityItem: { width: "50%", minHeight: 70, padding: 11, justifyContent: "space-between" },
  authorityValue: { fontSize: 17, fontWeight: "900" },
  actionBar: { borderWidth: 2, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actionCopy: { flex: 1, gap: 5 },
  actionDetail: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  actionButton: { minWidth: 108, minHeight: 48, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  safety: { borderTopWidth: 1, paddingTop: 8 },
  safetyToggle: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});