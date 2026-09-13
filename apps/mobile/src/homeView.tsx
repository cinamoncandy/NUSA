import React, { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";

interface HomeViewProps {
  readonly snapshot: Snapshot | null;
  readonly investmentPercent: number;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  readonly refreshing: boolean;
  readonly publicMarket: string;
  readonly publicMarkets: readonly WatchlistMarket[] | null;
  readonly publicCandles: readonly PublicCandle[] | null;
  readonly publicCurrentPrice: number | null;
  readonly publicMarketConnectionState: string;
  readonly publicMarketStale: boolean;
  readonly onRefresh: () => void;
  readonly onGoSettings: () => void;
  readonly onNavigate: (destination: HomeDestination) => void;
  readonly onOpenPaperLearning: () => void;
}

const packagedBuildLabel = /^[0-9a-f]{40}$/i.test(BUILD_SOURCE_SHA) ? BUILD_SOURCE_SHA.slice(0, 8) : "DEV";

function ageLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "확인 불가";
  const delta = Math.max(0, Date.now() - value);
  if (delta < 1_000) return "방금";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}초 전`;
  return `${Math.floor(delta / 60_000)}분 전`;
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function probability(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function RuntimeActivityTrace({ active, color, mutedColor }: Readonly<{ active: boolean; color: string; mutedColor: string }>) {
  return <View style={[styles.activityTrack, { backgroundColor: mutedColor }]} accessibilityLabel={active ? "PAPER runtime is running" : "PAPER runtime is not running"}>
    <View style={[styles.activitySignal, { backgroundColor: color, opacity: active ? 0.8 : 0.28 }]} />
  </View>;
}

function Row({ label, value, valueColor, borderColor }: Readonly<{ label: string; value: string; valueColor: string; borderColor: string }>) {
  const { theme } = useTheme();
  return <View style={[styles.row, { borderBottomColor: borderColor }]}>
    <Text style={[styles.rowLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={2}>{value}</Text>
  </View>;
}

export function HomeView({
  snapshot,
  investmentPercent,
  readOnlyError,
  notConfigured,
  refreshing,
  publicMarket,
  publicMarkets,
  publicCandles,
  publicCurrentPrice,
  publicMarketConnectionState,
  publicMarketStale,
  onRefresh,
  onGoSettings,
  onNavigate,
  onOpenPaperLearning,
}: HomeViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const ai = snapshot?.ai ?? null;
  const runtime = snapshot?.operations ?? null;
  const disconnected = notConfigured != null;
  const unavailable = disconnected || readOnlyError != null || snapshot == null;
  const runtimeActive = runtime?.runtimeState === "RUNNING" && runtime.transport === "ONLINE";
  const runtimeTone = unavailable ? theme.colors.warning : runtimeActive ? theme.colors.text : theme.colors.textMuted;
  const aiAvailable = !unavailable && ai?.status === "AVAILABLE";
  const calibrated = aiAvailable && ai.calibrationStatus === "CALIBRATED";
  const observedMarketCount = publicMarkets?.length ?? 0;
  const candleCount = publicCandles?.length ?? 0;
  const publicState = publicMarketStale ? "STALE" : observedMarketCount > 0 || publicCurrentPrice != null ? "OBSERVED" : "UNAVAILABLE";
  const heartbeatAt = runtime?.heartbeat?.lastHeartbeatAt ?? runtime?.updatedAt ?? null;
  const lastModelRun = ai?.lastModelRun ?? null;
  const evidencePreview = aiAvailable ? ai.evidenceReferences.slice(0, 2) : [];
  const counterPreview = aiAvailable ? ai.counterEvidence.slice(0, 2) : [];
  const disagreementCount = aiAvailable ? ai.disagreements.length : 0;
  const account = snapshot?.portfolio?.account ?? null;
  const authority = "LIVE NONE · MUTATION FALSE · AI ZERO AUTHORITY";

  const primaryStatement = useMemo(() => {
    if (disconnected) return "PAPER 연결이 없어 판단을 확정하지 않습니다.";
    if (readOnlyError != null) return "관측 오류로 현재 판단을 확정하지 않습니다.";
    if (ai?.status === "AVAILABLE" && ai.thesis) return ai.thesis;
    if (ai?.status === "INCOMPLETE") return "AI 근거가 불완전해 판단을 보류합니다.";
    return "현재 검증 가능한 AI 판단이 없습니다.";
  }, [ai?.status, ai?.thesis, disconnected, readOnlyError]);

  const stateLabel = disconnected ? "UNAVAILABLE" : readOnlyError != null ? "ERROR" : ai?.status ?? "UNAVAILABLE";
  const operationalLabel = unavailable ? "관측 불가" : `${runtime?.runtimeState ?? "UNKNOWN"} · ${runtime?.transport ?? "UNKNOWN"}`;

  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView
      contentContainerStyle={[styles.content, compact ? styles.contentCompact : null]}
      refreshControl={<RefreshControl tintColor={theme.colors.textMuted} refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.appBar} testID="home-master-rail">
        <View>
          <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
          <Text style={[styles.micro, { color: theme.colors.textMuted }]}>AI TRADING INTELLIGENCE</Text>
        </View>
        <View style={[styles.authorityPill, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]}>
          <Text style={[styles.authorityPillText, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
        </View>
      </View>

      <View style={[styles.runtimeStrip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="home-status-rail">
        <View style={styles.runtimeTopLine}>
          <View style={styles.runtimeIdentity}>
            <View style={[styles.stateDot, { backgroundColor: runtimeTone }]} />
            <Text style={[styles.runtimeState, { color: theme.colors.text }]}>{operationalLabel}</Text>
          </View>
          <Text style={[styles.micro, { color: theme.colors.textMuted }]}>{ageLabel(heartbeatAt)}</Text>
        </View>
        <RuntimeActivityTrace active={runtimeActive} color={theme.colors.text} mutedColor={theme.colors.border} />
        <View style={styles.runtimeMetadata}>
          <Text style={[styles.micro, { color: theme.colors.textMuted }]}>STAGE {runtime?.pipelineStage || "UNAVAILABLE"}</Text>
          <Text style={[styles.micro, { color: theme.colors.textMuted }]}>MARKET {publicState}</Text>
        </View>
      </View>

      <View style={styles.intelligenceDocument} testID="home-intelligence-reveal">
        <View style={styles.sectionIndex}><Text style={[styles.indexText, { color: theme.colors.textMuted }]}>01</Text><View style={[styles.indexRule, { backgroundColor: theme.colors.border }]} /></View>
        <View style={styles.documentBody} testID="home-now">
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>판단 상태 · {stateLabel}</Text>
          <Text style={[styles.statement, { color: theme.colors.text }]}>{primaryStatement}</Text>
          <Text style={[styles.provenance, { color: theme.colors.textMuted }]}>마지막 AI 관측 {ageLabel(lastModelRun)} · {ai?.learningProvenance ?? "UNKNOWN"}</Text>
        </View>
      </View>

      <View style={styles.intelligenceDocument}>
        <View style={styles.sectionIndex}><Text style={[styles.indexText, { color: theme.colors.textMuted }]}>02</Text><View style={[styles.indexRule, { backgroundColor: theme.colors.border }]} /></View>
        <View style={styles.documentBody}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>근거</Text>
          {!aiAvailable ? <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>검증된 AI projection이 없어 근거를 표시하지 않습니다.</Text> : <>
            <Row label="FOR" value={`${ai.evidenceReferences.length} verified refs`} valueColor={theme.colors.text} borderColor={theme.colors.border} />
            {evidencePreview.map((item) => <Text key={item} style={[styles.evidenceLine, { color: theme.colors.textMuted }]}>+ {item}</Text>)}
            <Row label="AGAINST" value={`${ai.counterEvidence.length} counter items`} valueColor={theme.colors.text} borderColor={theme.colors.border} />
            {counterPreview.map((item, index) => <Text key={`${index}:${item}`} style={[styles.evidenceLine, { color: theme.colors.textMuted }]}>− {item}</Text>)}
            <Row label="DISAGREEMENT" value={disagreementCount === 0 ? "없음" : `${disagreementCount}건`} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          </>}
          <Pressable accessibilityRole="button" onPress={() => onNavigate("AiSignal")} style={styles.textAction} testID="home-ai-detail-action">
            <Text style={[styles.textActionLabel, { color: theme.colors.text }]}>판단 근거 상세 보기  →</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.intelligenceDocument}>
        <View style={styles.sectionIndex}><Text style={[styles.indexText, { color: theme.colors.textMuted }]}>03</Text><View style={[styles.indexRule, { backgroundColor: theme.colors.border }]} /></View>
        <View style={styles.documentBody}>
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>불확실성 / 검증</Text>
          <Text style={[styles.uncertainty, { color: theme.colors.text }]}>{aiAvailable ? ai.uncertainty || "명시된 불확실성 없음" : "판단 근거가 유효하지 않아 confidence를 표시하지 않습니다."}</Text>
          <Row label="CALIBRATION" value={ai?.calibrationStatus ?? "UNKNOWN"} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="CONFIDENCE" value={calibrated ? probability(ai.confidence) : "표시 안 함"} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="CRITIC" value={ai?.criticSeverity ?? "UNAVAILABLE"} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="SCENARIO" value={ai?.scenarioRobustnessState ?? "NOT_EVALUATED"} valueColor={theme.colors.text} borderColor={theme.colors.border} />
        </View>
      </View>

      {disconnected || readOnlyError != null ? <View style={styles.intelligenceDocument} testID="home-operational-notice">
        <View style={styles.sectionIndex}><Text style={[styles.indexText, { color: theme.colors.warning }]}>04</Text><View style={[styles.indexRule, { backgroundColor: theme.colors.border }]} /></View>
        <View style={styles.documentBody}>
          <Text style={[styles.kicker, { color: theme.colors.warning }]}>조치 필요</Text>
          <Text style={[styles.uncertainty, { color: theme.colors.text }]}>{disconnected ? "Cloud PAPER 연결을 검증해야 합니다." : readOnlyError}</Text>
          <Pressable accessibilityRole="button" onPress={onGoSettings} style={[styles.actionButton, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.actionButtonText, { color: theme.colors.text }]}>PAPER 연결 상태 확인</Text>
          </Pressable>
        </View>
      </View> : null}

      <View style={[styles.contextPanel, { borderColor: theme.colors.border }]} testID="home-market-canvas-reveal">
        <View testID="home-public-market-chart">
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>OBSERVATION CONTEXT</Text>
          <Row label="PUBLIC MARKET" value={`${publicMarket} · ${publicState}`} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="FEED" value={`${publicMarketConnectionState || "UNKNOWN"} · ${observedMarketCount} markets · ${candleCount} observations`} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="CURRENT PRICE" value={publicCurrentPrice == null ? "—" : money(publicCurrentPrice)} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Pressable accessibilityRole="button" onPress={() => onNavigate("Markets")} style={styles.textAction}><Text style={[styles.textActionLabel, { color: theme.colors.text }]}>시장 관측 열기  →</Text></Pressable>
        </View>
      </View>

      <View style={[styles.contextPanel, { borderColor: theme.colors.border }]} testID="home-capital-reveal">
        <View testID="account-hero-card">
          <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>PAPER CONTEXT · SECONDARY</Text>
          <Row label="EQUITY" value={money(account?.equity)} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="CASH" value={money(account?.cash)} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <Row label="ALLOCATION POLICY" value={Number.isFinite(investmentPercent) ? `${investmentPercent}%` : "—"} valueColor={theme.colors.text} borderColor={theme.colors.border} />
          <View style={styles.secondaryActions} testID="home-supervisor-learning">
            <Pressable accessibilityRole="button" onPress={() => onNavigate("Portfolio")} style={styles.textAction}><Text style={[styles.textActionLabel, { color: theme.colors.text }]}>PAPER 자산  →</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onOpenPaperLearning} style={styles.textAction} testID="home-paper-learning"><Text style={[styles.textActionLabel, { color: theme.colors.text }]}>학습 근거  →</Text></Pressable>
          </View>
        </View>
      </View>

      <View style={[styles.footerTruth, { borderTopColor: theme.colors.border }]} testID="home-loop">
        <Text style={[styles.footerAuthority, { color: theme.colors.textMuted }]}>{authority}</Text>
        <Text style={[styles.micro, { color: theme.colors.textMuted }]} testID="home-build-source">BUILD {packagedBuildLabel} · projection truth only</Text>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 48, gap: 22 },
  contentCompact: { paddingHorizontal: 16, gap: 18 },
  appBar: { minHeight: 50, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  brand: { fontSize: 20, fontWeight: "800", letterSpacing: 1.6 },
  micro: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7, lineHeight: 15 },
  authorityPill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  authorityPillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  runtimeStrip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 10 },
  runtimeTopLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  runtimeIdentity: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  runtimeState: { fontSize: 12, fontWeight: "700", letterSpacing: 0.25 },
  activityTrack: { height: 1, width: "100%", overflow: "hidden" },
  activitySignal: { height: 1, width: "100%" },
  runtimeMetadata: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  intelligenceDocument: { flexDirection: "row", alignItems: "stretch", gap: 14 },
  sectionIndex: { width: 24, alignItems: "center" },
  indexText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  indexRule: { width: 1, flex: 1, minHeight: 28, marginTop: 8 },
  documentBody: { flex: 1, minWidth: 0, paddingBottom: 4 },
  kicker: { fontSize: 10, fontWeight: "700", letterSpacing: 1.05, marginBottom: 10 },
  statement: { fontSize: 25, lineHeight: 34, fontWeight: "600", letterSpacing: -0.55, marginBottom: 12 },
  provenance: { fontSize: 11, lineHeight: 17 },
  emptyText: { fontSize: 14, lineHeight: 22, marginBottom: 6 },
  row: { minHeight: 42, paddingVertical: 9, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { flexShrink: 0, fontSize: 10, fontWeight: "700", letterSpacing: 0.72, lineHeight: 18 },
  rowValue: { flex: 1, textAlign: "right", fontSize: 12, fontWeight: "600", lineHeight: 18 },
  evidenceLine: { fontSize: 11, lineHeight: 17, paddingTop: 6 },
  uncertainty: { fontSize: 15, lineHeight: 23, fontWeight: "500", marginBottom: 8 },
  textAction: { minHeight: 40, justifyContent: "center", paddingVertical: 8 },
  textActionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.12 },
  actionButton: { marginTop: 6, minHeight: 46, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionButtonText: { fontSize: 13, fontWeight: "700" },
  contextPanel: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
  secondaryActions: { flexDirection: "row", gap: 22, flexWrap: "wrap" },
  footerTruth: { marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 4 },
  footerAuthority: { fontSize: 9, lineHeight: 14, fontWeight: "700", letterSpacing: 0.6 },
});