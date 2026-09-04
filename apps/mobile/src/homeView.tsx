import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TerrainSignal } from "./components";
import { OperationalNotice } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { selectHomeMarketData } from "./homeMarketData";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";

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

function krw(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  const percent = value * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

export function HomeView({
  snapshot,
  readOnlyError,
  notConfigured,
  refreshing,
  publicMarkets,
  onRefresh,
  onGoSettings,
  onNavigate,
  onOpenPaperLearning,
}: HomeViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;

  const localPaperActive = snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const account = snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const calibratedConfidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED"
    ? `${Math.round(ai.confidence * 100)}%`
    : "—";
  const marketFeed = selectHomeMarketData(publicMarkets, snapshot?.markets ?? []);
  const marketRows = [...marketFeed]
    .sort((left, right) => Math.abs(right.changeRate ?? 0) - Math.abs(left.changeRate ?? 0))
    .slice(0, 3);

  const positive = theme.colors.success;
  const negative = theme.colors.danger;
  const accent = theme.colors.aiSignalEnd;
  const accentMid = theme.colors.aiSignalMid;
  const surface = theme.colors.surface;
  const border = theme.colors.border;
  const strongBorder = theme.colors.borderStrong;

  const fallbackJudgement = notConfigured
    ? "PAPER 연결이 필요합니다."
    : readOnlyError
      ? "연결 상태를 확인하고 있습니다."
      : "관망이 전략입니다.";
  const judgement = aiInsightAvailable ? (ai?.thesis ?? fallbackJudgement) : fallbackJudgement;
  const aiState = aiInsightAvailable ? "VERIFIED" : "NEUTRAL";
  const terrainStrength = aiInsightAvailable ? 0.95 : snapshot ? 0.58 : 0.34;

  const equity = account?.equity ?? null;
  const dayPnlRate = equity != null && equity !== 0 && totalPnl != null ? totalPnl / equity : null;
  const contentWidth = tablet ? 760 : 520;

  return <ScrollView
    contentContainerStyle={[styles.content, { maxWidth: contentWidth }]}
    refreshControl={<RefreshControl tintColor={accent} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.header} testID="home-master-rail">
      <View style={styles.brandRow}>
        <View style={[styles.brandMark, { borderColor: accent }]}><View style={[styles.brandDot, { backgroundColor: theme.colors.text }]} /></View>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
      </View>
      <View style={[styles.bell, { borderColor: border }]} accessibilityLabel="알림"><Text style={[styles.bellGlyph, { color: theme.colors.textMuted }]}>⌁</Text></View>
    </View>

    <View style={styles.assetBlock} testID="account-hero-card">
      <Text style={[styles.sectionEyebrow, { color: theme.colors.textMuted }]}>총 자산</Text>
      <Text style={[styles.balance, tablet && styles.balanceTablet, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>
        {equity == null ? "—" : krw(equity)}
      </Text>
      <View style={styles.dayRow}>
        <Text style={[styles.dayLabel, { color: theme.colors.textMuted }]}>오늘</Text>
        <Text style={[styles.dayChange, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? positive : negative }]}>
          {signedPercent(dayPnlRate)}
        </Text>
        <Text style={[styles.dayChange, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? positive : negative }]}>
          {totalPnl == null ? "—" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}
        </Text>
      </View>
    </View>

    {readOnlyError ? <OperationalNotice title="PAPER 연결 오류" detail={readOnlyError} tone="danger" actionLabel="설정" onAction={onGoSettings} testID="home-operational-notice" /> : null}
    {notConfigured ? <OperationalNotice title="PAPER 연결 필요" detail="연결 전에는 검증된 PAPER 자산과 AI 판단만 비워 둡니다." tone="warning" actionLabel="연결 설정" onAction={onGoSettings} testID="home-operational-notice" /> : null}

    <Pressable
      accessibilityRole="button"
      accessibilityHint="AI 시그널 상세 보기"
      onPress={() => onNavigate("AiSignal")}
      style={({ pressed }) => [styles.aiCard, { backgroundColor: surface, borderColor: strongBorder, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
      testID="ai-card"
    >
      <View style={styles.aiTopRow}>
        <Text style={[styles.aiKicker, { color: theme.colors.textMuted }]}>NUSA AI 판단</Text>
        <View style={[styles.stateBadge, { borderColor: accent }]}><Text style={[styles.stateText, { color: accent }]}>{aiState}</Text></View>
      </View>
      <Text style={[styles.judgement, { color: theme.colors.text }]} numberOfLines={3}>{judgement}</Text>
      <View style={styles.confidenceRow}>
        <Text style={[styles.confidenceLabel, { color: theme.colors.textMuted }]}>신뢰도</Text>
        <Text style={[styles.confidenceValue, { color: theme.colors.text }]}>{calibratedConfidence}</Text>
        <View style={[styles.confidenceRing, { borderColor: border }]}>
          <View style={[styles.confidenceArc, { borderTopColor: accent, borderRightColor: accent }]} />
        </View>
      </View>
    </Pressable>

    <View style={styles.terrainSection} testID="home-decision-stage">
      <View style={[styles.terrainFrame, { borderColor: border, backgroundColor: theme.colors.surfaceSunken }]}>
        <View style={[styles.horizon, { backgroundColor: border }]} />
        <View style={[styles.beam, { backgroundColor: accentMid }]} />
        <View style={[styles.signalNode, { backgroundColor: theme.colors.text, shadowColor: accent }]} />
        <TerrainSignal
          variant="symbolic"
          signalStrength={terrainStrength}
          accessibilityLabel={aiInsightAvailable ? "NUSA verified market terrain" : "NUSA neutral market terrain"}
          testID="home-signal-trace"
          hero
        />
      </View>
    </View>

    <View style={styles.metricsHeader}>
      <Text style={[styles.metricsTitle, { color: theme.colors.text }]}>주요 지표</Text>
      <Pressable accessibilityRole="button" onPress={() => onNavigate("Markets")}><Text style={[styles.metricsLink, { color: theme.colors.textMuted }]}>시장 보기 →</Text></Pressable>
    </View>

    <View style={styles.metricsGrid} testID="home-market-pulse">
      {[0, 1, 2].map((index) => {
        const market = marketRows[index];
        return <Pressable
          key={market?.market ?? `empty-${index}`}
          accessibilityRole="button"
          onPress={() => onNavigate("Markets")}
          style={({ pressed }) => [styles.metricCard, { borderColor: border, backgroundColor: surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
        >
          <Text style={[styles.metricSymbol, { color: theme.colors.textMuted }]}>{market?.market ?? "—"}</Text>
          <Text style={[styles.metricPrice, { color: theme.colors.text }]}>{market ? krw(market.price) : "—"}</Text>
          <Text style={[styles.metricChange, { color: market?.changeRate == null ? theme.colors.textMuted : market.changeRate >= 0 ? positive : negative }]}>
            {signedPercent(market?.changeRate ?? null)}
          </Text>
        </Pressable>;
      })}
    </View>

    <View style={[styles.safetyRail, { borderTopColor: border }]} testID="safety-card">
      <Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
      <Pressable accessibilityRole="button" onPress={onOpenPaperLearning} testID="home-paper-learning"><Text style={[styles.safetyLink, { color: accent }]}>PAPER 학습 →</Text></Pressable>
    </View>

    <View style={[styles.referenceNav, { borderColor: strongBorder, backgroundColor: surface }]} testID="home-reference-navigation">
      <View style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.text }]}>◆</Text><Text style={[styles.navTextActive, { color: theme.colors.text }]}>홈</Text></View>
      <Pressable onPress={() => onNavigate("Markets")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>⌁</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>마켓</Text></Pressable>
      <Pressable onPress={() => onNavigate("AiSignal")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>◎</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>시그널</Text></Pressable>
      <Pressable onPress={onOpenPaperLearning} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>▣</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>페이퍼</Text></Pressable>
      <Pressable onPress={() => onNavigate("Portfolio")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>♙</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>포트폴리오</Text></Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 42, gap: 14 },
  header: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 24, height: 24, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "flex-start", paddingTop: 4 },
  brandDot: { width: 4, height: 4, borderRadius: 2 },
  wordmark: { fontSize: 22, lineHeight: 26, fontWeight: "800", letterSpacing: 5.2 },
  bell: { width: 34, height: 34, borderWidth: StyleSheet.hairlineWidth, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  bellGlyph: { fontSize: 19, lineHeight: 21, fontWeight: "700" },
  assetBlock: { paddingTop: 4, paddingBottom: 2 },
  sectionEyebrow: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  balance: { marginTop: 2, fontSize: 38, lineHeight: 46, fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  balanceTablet: { fontSize: 54, lineHeight: 62 },
  dayRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 8 },
  dayLabel: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  dayChange: { fontSize: 12, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  aiCard: { borderWidth: 1, borderRadius: 13, padding: 14, gap: 8 },
  aiTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  aiKicker: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 0.7 },
  stateBadge: { minHeight: 22, borderWidth: 1, borderRadius: 11, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  stateText: { fontSize: 9, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7 },
  judgement: { fontSize: 20, lineHeight: 27, fontWeight: "800", letterSpacing: -0.4 },
  confidenceRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 7 },
  confidenceLabel: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  confidenceValue: { fontSize: 18, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
  confidenceRing: { width: 26, height: 26, borderWidth: 3, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  confidenceArc: { position: "absolute", width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderLeftColor: "transparent", borderBottomColor: "transparent", transform: [{ rotate: "38deg" }] },
  terrainSection: { marginTop: 1 },
  terrainFrame: { height: 206, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden", justifyContent: "center", position: "relative" },
  horizon: { position: "absolute", left: 18, right: 18, top: "52%", height: StyleSheet.hairlineWidth },
  beam: { position: "absolute", left: "50%", top: 28, bottom: 24, width: 1, opacity: 0.72 },
  signalNode: { position: "absolute", left: "49.25%", top: 28, width: 6, height: 6, borderRadius: 3, zIndex: 3, shadowOpacity: 0.9, shadowRadius: 12, elevation: 3 },
  metricsHeader: { marginTop: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricsTitle: { fontSize: 15, lineHeight: 22, fontWeight: "800" },
  metricsLink: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  metricsGrid: { flexDirection: "row", gap: 8 },
  metricCard: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 11, gap: 3 },
  metricSymbol: { fontSize: 9, lineHeight: 13, fontWeight: "800" },
  metricPrice: { fontSize: 12, lineHeight: 17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  metricChange: { fontSize: 11, lineHeight: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  safetyRail: { marginTop: 2, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  safetyText: { flex: 1, fontSize: 9, lineHeight: 14, fontWeight: "700", letterSpacing: 0.35 },
  safetyLink: { fontSize: 10, lineHeight: 15, fontWeight: "800" },
  referenceNav: { marginTop: 4, minHeight: 56, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  navItem: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", gap: 2 },
  navIcon: { fontSize: 13, lineHeight: 16, fontWeight: "700" },
  navText: { fontSize: 9, lineHeight: 12, fontWeight: "600" },
  navTextActive: { fontSize: 9, lineHeight: 12, fontWeight: "800" },
});
