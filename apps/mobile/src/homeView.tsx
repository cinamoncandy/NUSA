import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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

function PremiumTerrain({ accent, accentMid, accentStart, muted, border, strength }: Readonly<{ accent: string; accentMid: string; accentStart: string; muted: string; border: string; strength: number }>) {
  const shift = Math.round((strength - 0.5) * 22);
  return <View accessible accessibilityRole="image" accessibilityLabel="NUSA AI signal terrain" style={[styles.terrainCanvas, { borderColor: border }]} testID="home-signal-trace">
    <View style={[styles.gridLine, styles.gridTop, { backgroundColor: border }]} />
    <View style={[styles.gridLine, styles.gridMid, { backgroundColor: border }]} />
    <View style={[styles.gridLine, styles.gridLow, { backgroundColor: border }]} />
    <View style={[styles.glowDisc, styles.glowDiscOuter, { borderColor: accentStart, left: `${46 + shift / 4}%` }]} />
    <View style={[styles.glowDisc, styles.glowDiscInner, { borderColor: accentMid, left: `${49 + shift / 4}%` }]} />
    <View style={[styles.meshBand, styles.meshBandOne, { backgroundColor: muted }]} />
    <View style={[styles.meshBand, styles.meshBandTwo, { backgroundColor: accentStart }]} />
    <View style={[styles.meshBand, styles.meshBandThree, { backgroundColor: accentMid }]} />
    <View style={[styles.meshBand, styles.meshBandFour, { backgroundColor: muted }]} />
    <View style={[styles.signalBeam, { backgroundColor: accent, left: `${54 + shift / 3}%` }]} />
    <View style={[styles.signalHalo, { borderColor: accent, left: `${54 + shift / 3}%` }]} />
    <View style={[styles.signalDot, { backgroundColor: accent, shadowColor: accent, left: `${54 + shift / 3}%` }]} />
    <View style={[styles.signalTip, { backgroundColor: accent, left: `${54 + shift / 3}%` }]} />
  </View>;
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
  const equity = account?.equity ?? null;
  const dayPnlRate = equity != null && equity !== 0 && totalPnl != null ? totalPnl / equity : null;
  const ai = snapshot?.ai ?? null;
  const aiInsightAvailable = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const confidence = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "—";
  const confidenceWidth: `${number}%` = aiInsightAvailable && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "34%";
  const marketRows = [...selectHomeMarketData(publicMarkets, snapshot?.markets ?? [])]
    .sort((left, right) => Math.abs(right.changeRate ?? 0) - Math.abs(left.changeRate ?? 0))
    .slice(0, 3);

  const accent = theme.colors.aiSignalEnd;
  const accentMid = theme.colors.aiSignalMid;
  const accentStart = theme.colors.aiSignalStart;
  const surface = theme.colors.surface;
  const raised = theme.colors.surfaceRaised;
  const border = theme.colors.border;
  const strongBorder = theme.colors.borderStrong;
  const muted = theme.colors.terrain;
  const positive = theme.colors.success;
  const negative = theme.colors.danger;
  const fallbackJudgement = readOnlyError ? "연결 상태를 확인하고 있습니다." : notConfigured ? "관망이 전략입니다." : "관망이 전략입니다.";
  const judgement = aiInsightAvailable ? (ai?.thesis ?? fallbackJudgement) : fallbackJudgement;
  const terrainStrength = aiInsightAvailable ? 0.92 : snapshot ? 0.62 : 0.45;
  const contentWidth = tablet ? 760 : 560;

  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView
      contentContainerStyle={[styles.content, { maxWidth: contentWidth }]}
      refreshControl={<RefreshControl tintColor={accent} refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header} testID="home-master-rail">
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <View style={styles.headerRight}>
          <View style={[styles.liveDot, { backgroundColor: accentMid }]} />
          <Text style={[styles.modeLabel, { color: theme.colors.textMuted }]}>PAPER</Text>
          <View style={[styles.bell, { borderColor: border }]}><Text style={[styles.bellGlyph, { color: theme.colors.text }]}>⌁</Text></View>
        </View>
      </View>

      <View style={styles.assetBlock} testID="account-hero-card">
        <Text style={[styles.sectionEyebrow, { color: theme.colors.textMuted }]}>총 자산</Text>
        <Text style={[styles.balance, tablet && styles.balanceTablet, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{equity == null ? "—" : krw(equity)}</Text>
        <View style={styles.dayRow}>
          <Text style={[styles.dayLabel, { color: theme.colors.textMuted }]}>오늘</Text>
          <Text style={[styles.dayChange, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? positive : negative }]}>{signedPercent(dayPnlRate)}</Text>
          <Text style={[styles.dayChange, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? positive : negative }]}>{totalPnl == null ? "—" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text>
        </View>
      </View>

      {notConfigured || readOnlyError ? <Pressable onPress={onGoSettings} style={[styles.connectionStrip, { borderColor: border, backgroundColor: surface }]} testID="home-operational-notice">
        <View style={[styles.connectionDot, { backgroundColor: notConfigured ? theme.colors.warning : negative }]} />
        <View style={styles.connectionCopy}>
          <Text style={[styles.connectionTitle, { color: theme.colors.text }]}>{notConfigured ? "PAPER 연결 필요" : "PAPER 연결 확인"}</Text>
          <Text style={[styles.connectionDetail, { color: theme.colors.textMuted }]} numberOfLines={1}>{notConfigured ? "연결 전에는 검증된 PAPER 자산만 비워 둡니다." : "읽기 전용 연결 상태를 확인합니다."}</Text>
        </View>
        <Text style={[styles.connectionAction, { color: theme.colors.text }]}>설정</Text>
      </Pressable> : null}

      <Pressable onPress={() => onNavigate("AiSignal")} style={({ pressed }) => [styles.aiCard, { backgroundColor: raised, borderColor: strongBorder, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="ai-card">
        <View style={styles.aiTopRow}>
          <Text style={[styles.aiKicker, { color: theme.colors.textMuted }]}>NUSA AI 판단</Text>
          <View style={[styles.stateBadge, { borderColor: accent }]}><Text style={[styles.stateText, { color: accent }]}>{aiInsightAvailable ? "VERIFIED" : "NEUTRAL"}</Text></View>
        </View>
        <Text style={[styles.judgement, { color: theme.colors.text }]} numberOfLines={2}>{judgement}</Text>
        <View style={styles.confidenceRow}>
          <Text style={[styles.confidenceLabel, { color: theme.colors.textMuted }]}>신뢰도</Text>
          <Text style={[styles.confidenceValue, { color: theme.colors.text }]}>{confidence}</Text>
          <View style={[styles.confidenceTrack, { backgroundColor: border }]}><View style={[styles.confidenceFill, { backgroundColor: accent, width: confidenceWidth }]} /></View>
        </View>
      </Pressable>

      <View style={styles.terrainSection} testID="home-decision-stage">
        <PremiumTerrain accent={accent} accentMid={accentMid} accentStart={accentStart} muted={muted} border={border} strength={terrainStrength} />
      </View>

      <View style={styles.metricsHeader}>
        <Text style={[styles.metricsTitle, { color: theme.colors.text }]}>주요 지표</Text>
        <Pressable onPress={() => onNavigate("Markets")}><Text style={[styles.metricsLink, { color: theme.colors.textMuted }]}>시장 보기</Text></Pressable>
      </View>
      <View style={styles.metricsGrid} testID="home-market-pulse">
        {[0, 1, 2].map((index) => {
          const market = marketRows[index];
          return <Pressable key={market?.market ?? `empty-${index}`} onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.metricCard, { borderColor: border, backgroundColor: surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}>
            <Text style={[styles.metricSymbol, { color: theme.colors.textMuted }]} numberOfLines={1}>{market?.market ?? "—"}</Text>
            <Text style={[styles.metricPrice, { color: theme.colors.text }]}>{market ? krw(market.price) : "—"}</Text>
            <Text style={[styles.metricChange, { color: market?.changeRate == null ? theme.colors.textMuted : market.changeRate >= 0 ? positive : negative }]}>{signedPercent(market?.changeRate ?? null)}</Text>
          </Pressable>;
        })}
      </View>

      <View style={[styles.safetyRail, { borderTopColor: border }]} testID="safety-card">
        <Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
        <Pressable nativeID="home-supervisor-learning" onPress={onOpenPaperLearning} testID="home-paper-learning"><Text style={[styles.safetyLink, { color: accent }]}>PAPER 학습 →</Text></Pressable>
      </View>
    </ScrollView>

    <View style={[styles.referenceNav, { borderTopColor: border, backgroundColor: theme.colors.navSurface }]} testID="home-reference-navigation">
      <View style={styles.navItem}><Text style={[styles.navIconActive, { color: theme.colors.text }]}>◆</Text><Text style={[styles.navTextActive, { color: theme.colors.text }]}>홈</Text></View>
      <Pressable onPress={() => onNavigate("Markets")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>⌁</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>마켓</Text></Pressable>
      <Pressable onPress={() => onNavigate("AiSignal")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>◎</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>시그널</Text></Pressable>
      <Pressable onPress={onOpenPaperLearning} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>▣</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>페이퍼</Text></Pressable>
      <Pressable onPress={() => onNavigate("Portfolio")} style={styles.navItem}><Text style={[styles.navIcon, { color: theme.colors.textMuted }]}>♙</Text><Text style={[styles.navText, { color: theme.colors.textMuted }]}>포트폴리오</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 },
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 104, gap: 18 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: { fontSize: 27, lineHeight: 32, fontWeight: "900", letterSpacing: 4.4 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  modeLabel: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1.2 },
  bell: { width: 32, height: 32, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  bellGlyph: { fontSize: 17, fontWeight: "700" },
  assetBlock: { paddingTop: 4, paddingBottom: 4 },
  sectionEyebrow: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  balance: { marginTop: 4, fontSize: 42, lineHeight: 50, fontWeight: "900", letterSpacing: -1.8, fontVariant: ["tabular-nums"] },
  balanceTablet: { fontSize: 56, lineHeight: 64 },
  dayRow: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 9 },
  dayLabel: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  dayChange: { fontSize: 13, lineHeight: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  connectionStrip: { minHeight: 58, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  connectionCopy: { flex: 1, gap: 2 },
  connectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  connectionDetail: { fontSize: 11, lineHeight: 16, fontWeight: "500" },
  connectionAction: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  aiCard: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 18, gap: 12 },
  aiTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  aiKicker: { fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.6 },
  stateBadge: { minHeight: 30, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  stateText: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 0.9 },
  judgement: { fontSize: 26, lineHeight: 34, fontWeight: "900", letterSpacing: -0.9 },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  confidenceLabel: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  confidenceValue: { minWidth: 28, fontSize: 15, lineHeight: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  confidenceTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.9 },
  confidenceFill: { height: 4, borderRadius: 2 },
  terrainSection: { marginTop: 2 },
  terrainCanvas: { height: 250, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, overflow: "hidden", position: "relative" },
  gridLine: { position: "absolute", left: "5%", right: "5%", height: StyleSheet.hairlineWidth, opacity: 0.48 },
  gridTop: { top: "28%" }, gridMid: { top: "50%" }, gridLow: { top: "72%" },
  meshBand: { position: "absolute", height: 3, borderRadius: 2, opacity: 0.72 },
  meshBandOne: { width: "54%", left: "6%", top: "33%", transform: [{ rotate: "7deg" }] },
  meshBandTwo: { width: "66%", left: "10%", top: "45%", transform: [{ rotate: "-9deg" }] },
  meshBandThree: { width: "72%", left: "18%", top: "61%", transform: [{ rotate: "10deg" }] },
  meshBandFour: { width: "86%", left: "6%", top: "76%", transform: [{ rotate: "-3deg" }] },
  glowDisc: { position: "absolute", borderWidth: 1, borderRadius: 999, opacity: 0.46 },
  glowDiscOuter: { width: 150, height: 150, top: 50, marginLeft: -75 },
  glowDiscInner: { width: 92, height: 92, top: 79, marginLeft: -46, opacity: 0.7 },
  signalBeam: { position: "absolute", width: 2, top: 46, bottom: 42, marginLeft: -1, opacity: 0.72 },
  signalHalo: { position: "absolute", width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, top: 96, marginLeft: -29, opacity: 0.7 },
  signalDot: { position: "absolute", width: 24, height: 24, borderRadius: 12, top: 113, marginLeft: -12, shadowOpacity: 0.8, shadowRadius: 14, elevation: 6 },
  signalTip: { position: "absolute", width: 9, height: 9, borderRadius: 5, top: 42, marginLeft: -4.5, shadowOpacity: 0.9, shadowRadius: 8, elevation: 4 },
  metricsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  metricsTitle: { fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: -0.5 },
  metricsLink: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  metricsGrid: { flexDirection: "row", gap: 10 },
  metricCard: { flex: 1, minHeight: 104, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 13, justifyContent: "space-between" },
  metricSymbol: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  metricPrice: { fontSize: 16, lineHeight: 21, fontWeight: "900", fontVariant: ["tabular-nums"] },
  metricChange: { fontSize: 12, lineHeight: 17, fontWeight: "900", fontVariant: ["tabular-nums"] },
  safetyRail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  safetyText: { flex: 1, fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 0.35 },
  safetyLink: { fontSize: 11, lineHeight: 16, fontWeight: "900" },
  referenceNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 82, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5 },
  navIconActive: { fontSize: 18, lineHeight: 20 },
  navIcon: { fontSize: 17, lineHeight: 20 },
  navTextActive: { fontSize: 10, lineHeight: 14, fontWeight: "900" },
  navText: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
});