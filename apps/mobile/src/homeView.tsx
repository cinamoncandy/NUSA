import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MotionReveal, TerrainSignal } from "./components";
import { OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
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

export function HomeView({
  snapshot,
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

  const account = snapshot?.portfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED"
    ? `${Math.round(ai.confidence * 100)}%`
    : undefined;
  const signalReady = snapshot?.health === "HEALTHY" && snapshot.readyForPaperOperations;
  const statusLabel = snapshot
    ? `PAPER · ${signalReady ? "READY" : "점검 필요"}`
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
    gap: tablet ? 20 : profile.screen.sectionGap,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;
  const balanceStyle = {
    fontSize: tablet ? profile.hero.tabletBalanceSize : profile.hero.balanceSize,
    lineHeight: tablet ? profile.hero.tabletBalanceLineHeight : profile.hero.balanceLineHeight,
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
      <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <MotionReveal testID="home-hero-reveal">
      <View style={styles.equitySection} testID="account-hero-card">
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text>
        <Text style={[styles.balance, balanceStyle]} adjustsFontSizeToFit numberOfLines={1}>
          {account ? krw(account.equity) : "-"}
        </Text>
        <View style={styles.pnlRow}>
          <Text style={[styles.pnlValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>
            {totalPnl == null ? "-" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
          </Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>누적 PAPER 손익</Text>
        </View>
      </View>
    </MotionReveal>

    <View style={[styles.decisionStage, { borderColor: theme.colors.borderStrong }]} testID="home-decision-stage">
      <View style={styles.decisionHeader}>
        <View style={styles.decisionHeaderCopy}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NOW</Text>
          <Text style={[styles.stageTitle, { color: theme.colors.text }]}>NUSA VIEW</Text>
        </View>
        <Text style={[styles.decisionState, { color: aiInsightAvailable ? theme.colors.aiSignalEnd : theme.colors.textMuted }]}>
          {aiInsightAvailable ? "VERIFIED" : signalReady ? "ANALYZING" : "WAITING"}
        </Text>
      </View>

      <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />

      {aiInsightAvailable ? <View style={styles.decisionCopy} testID="home-verified-decision">
        <View style={styles.judgementRow}>
          <Text style={[styles.judgement, { color: theme.colors.text }]}>{ai?.thesis ?? ""}</Text>
          {calibratedConfidence ? <Text style={[styles.confidence, { color: theme.colors.aiSignalEnd }]}>{calibratedConfidence}</Text> : null}
        </View>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>근거 {ai?.evidenceReferences.length ?? 0}개 · AI 분석은 READ ONLY</Text>
      </View> : <View style={styles.decisionCopy} testID="home-pending-decision">
        <Text style={[styles.judgement, { color: theme.colors.text }]}>{blocked ? "시장 연결이 필요합니다" : "판단 보류"}</Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>{primaryDetail}</Text>
      </View>}
    </View>

    {notice ? <OperationalNotice
      title={notice.title}
      detail={notice.detail}
      tone={notice.tone}
      actionLabel="설정"
      onAction={onGoSettings}
      testID="home-operational-notice"
    /> : null}

    <View style={styles.primaryAction} testID="home-next-action">
      <View style={styles.primaryCopy}>
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>NEXT</Text>
        <Text style={[styles.actionDetail, { color: theme.colors.textMuted }]}>{primaryDetail}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={runPrimaryAction}
        style={({ pressed }) => [styles.primaryButton, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        testID="home-next-action-button"
      >
        <Text style={[styles.primaryLabel, { color: theme.colors.text }]}>{primaryLabel}</Text>
      </Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  wordmarkHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wordmark: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: 2.2 },
  equitySection: { gap: 7, paddingTop: 8, paddingBottom: 6 },
  kicker: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.7 },
  balance: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  pnlRow: { minHeight: 22, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  pnlValue: { fontSize: 14, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 11, lineHeight: 16 },
  body: { fontSize: 13, lineHeight: 20 },
  decisionStage: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 16, gap: 10 },
  decisionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  decisionHeaderCopy: { gap: 3 },
  stageTitle: { fontSize: 20, lineHeight: 26, fontWeight: "750", letterSpacing: -0.5 },
  decisionState: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.4 },
  decisionCopy: { gap: 8, paddingTop: 2 },
  judgementRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  judgement: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "700", letterSpacing: -0.25 },
  confidence: { fontSize: 18, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  primaryAction: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 },
  primaryCopy: { flex: 1, minWidth: 0, gap: 4 },
  actionDetail: { fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 48, minWidth: 112, maxWidth: "46%", justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 },
  primaryLabel: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
});
