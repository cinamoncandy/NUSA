import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TerrainSignal } from "./components";
import { QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildHomeStatusRail } from "./homeStatusRail";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { selectHomeMarketData } from "./homeMarketData";
import { formatKRW, formatSignedPercent } from "./numberFormat";
import { freshestObservedAtMs, type WatchlistMarket } from "./watchlist";

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

function MiniSpark({ values, color, muted }: Readonly<{ values: readonly number[]; color: string; muted: string }>) {
  if (values.length === 0) return <View style={[styles.sparkEmpty, { backgroundColor: muted }]} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = Math.max(1, max - min);
  return <View style={styles.sparkRow} accessibilityRole="image" accessibilityLabel="portfolio sparkline">
    {values.slice(-18).map((value, index) => {
      const height = 8 + ((value - min) / spread) * 24;
      return <View key={`${index}-${value}`} style={[styles.sparkBar, { height, backgroundColor: color }]} />;
    })}
  </View>;
}

function DecisionTile({ label, detail, color, onPress, testID }: Readonly<{ label: string; detail: string; color: string; onPress?: () => void; testID: string }>) {
  const content = <View style={styles.decisionTileInner}>
    <View style={[styles.decisionGlyph, { borderColor: color }]} />
    <Text style={[styles.decisionLabel, { color }]}>{label}</Text>
    <Text style={[styles.decisionDetail, { color }]}>{detail}</Text>
  </View>;
  return onPress == null
    ? <View style={styles.decisionTile} testID={testID}>{content}</View>
    : <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.decisionTile, { opacity: pressed ? 0.72 : 1 }]} testID={testID}>{content}</Pressable>;
}

function PanelTitle({ title, action, color }: Readonly<{ title: string; action?: string; color: string }>) {
  return <View style={styles.panelTitleRow}>
    <Text style={[styles.panelTitle, { color }]}>{title}</Text>
    {action ? <Text style={[styles.panelAction, { color }]}>{action}</Text> : null}
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
  const tablet = width >= 768;
  const localPaperActive = snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const account = snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const accountSource = snapshot != null ? "CLOUD" : localPortfolio != null ? "LOCAL" : null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const equity = account?.equity ?? null;
  const dayPnlRate = equity != null && equity !== 0 && totalPnl != null ? totalPnl / equity : null;
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const marketFeed = selectHomeMarketData(publicMarkets, snapshot?.markets ?? []);
  const marketRows = [...marketFeed].sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0)).slice(0, tablet ? 5 : 3);
  const ai = snapshot?.ai ?? null;
  const disconnected = notConfigured != null;
  const decisionSurface = buildHomeDecisionSurface({
    runtimeState: snapshot?.operations.runtimeState,
    health: snapshot?.health,
    readyForPaperOperations: snapshot?.readyForPaperOperations ?? false,
    disconnected,
    readOnlyError: readOnlyError != null,
    accountSource,
    paperEquity: account?.equity,
    paperTotalPnl: totalPnl,
    aiThesis: ai?.status === "AVAILABLE" ? ai.thesis : null,
    aiEvidenceCount: ai?.status === "AVAILABLE" ? ai.evidenceReferences.length : 0,
    aiCalibrationStatus: ai?.calibrationStatus,
    aiConfidence: ai?.confidence,
  });
  const chart = buildChartViewModel({
    market: publicMarket,
    interval: "1m",
    rawCandles: publicCandles === null ? null : [...publicCandles],
    currentPrice: publicCurrentPrice,
    connectionState: publicMarketConnectionState,
    stale: publicMarketStale,
  });
  const sparkValues = chart.state === "READY" ? chart.bars.slice(-18).map((bar) => bar.close) : [];
  const aiInsightAvailable = decisionSurface.aiInsightAvailable && !disconnected && readOnlyError == null;
  const terminal = theme.colors.success;
  const danger = theme.colors.danger;
  const muted = theme.colors.textMuted;
  const panel = theme.colors.surface;
  const border = theme.colors.borderStrong;
  const softBorder = theme.colors.border;
  const rail = buildHomeStatusRail({
    paperState: snapshot == null ? (notConfigured ? "NOT_CONFIGURED" : "UNAVAILABLE") : snapshot.health === "HEALTHY" ? "READY" : snapshot.health === "DEGRADED" ? "DEGRADED" : "DOWN",
    paperMode: snapshot?.mode ?? null,
    killSwitchActive: snapshot?.dashboard.killSwitchActive ?? null,
    snapshotGeneratedAtMs: snapshot?.generatedAt ?? null,
    feedStale: publicMarketStale,
    feedObservedAtMs: freshestObservedAtMs(marketRows),
    nowMs: Date.now(),
    hasDailyPnlBasis: false,
  });
  const riskTone = rail.risk === "HIGH" || rail.risk === "CRITICAL" ? danger : rail.risk === "CAUTION" || rail.risk === "ELEVATED" ? theme.colors.warning : muted;
  const terrainStrength = decisionSurface.signalReady ? 0.92 : snapshot ? 0.52 : 0.28;
  const fallbackJudgement = notConfigured
    ? "PAPER 연결이 필요합니다."
    : readOnlyError
      ? "연결 상태를 확인하고 있습니다."
      : "지금은 관망이 유리합니다.";
  const judgement = aiInsightAvailable ? (ai?.thesis ?? fallbackJudgement) : fallbackJudgement;
  const riskColor = rail.risk === "HIGH" || rail.risk === "CRITICAL" ? danger : rail.risk === "CAUTION" || rail.risk === "ELEVATED" ? theme.colors.warning : terminal;
  const position = account?.position;
  const terrainLabels = [0, 1, 2].map((index) => {
    const market = marketRows[index];
    return market == null ? "검증된 신호 없음" : `${market.market} · ${formatSignedPercent(market.changeRate)}`;
  });

  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView
      contentContainerStyle={[styles.content, { maxWidth: tablet ? 980 : 620 }]}
      refreshControl={<RefreshControl tintColor={terminal} refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.masterRail} testID="home-master-rail">
        <View style={styles.brandRow}>
          <View style={[styles.brandOrb, { borderColor: terminal }]} />
          <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
          <View style={styles.brandMetaWrap}>
            <Text style={[styles.brandMeta, { color: muted }]}>AUTONOMOUS</Text>
            <Text style={[styles.brandMeta, { color: muted }]}>INVESTMENT</Text>
            <Text style={[styles.brandMeta, { color: muted }]}>INTELLIGENCE</Text>
          </View>
        </View>
        <QuietStatus label={decisionSurface.statusLabel} tone={decisionSurface.statusTone} testID="home-paper-status" />
      </View>

      <View style={styles.statusRail} testID="home-status-rail">
        <Text style={[styles.statusLine, { color: theme.colors.text }]}>{rail.marketLine} · {rail.systemLine}</Text>
        <Text style={[styles.statusLine, { color: riskTone }]}>위험 {rail.riskLabel}</Text>
        {rail.freshnessLabel === null ? null : <Text style={[styles.statusLine, { color: muted }]}>{rail.freshnessLabel} 업데이트</Text>}
      </View>

      <View style={[styles.assetHero, { backgroundColor: panel, borderColor: border }]} testID="account-hero-card">
        <View style={styles.assetTopRow}>
          <View>
            <Text style={[styles.sectionLabel, { color: muted }]}>총 자산</Text>
            <Text style={[styles.assetValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{equity == null ? "—" : formatKRW(equity)}</Text>
            <View style={styles.dayRow}>
              <Text style={[styles.dayLabel, { color: muted }]}>{rail.pnlBasisLabel}</Text>
              <Text style={[styles.dayValue, { color: totalPnl == null ? muted : totalPnl >= 0 ? terminal : danger }]}>{formatSignedPercent(dayPnlRate)}</Text>
              <Text style={[styles.dayValue, { color: totalPnl == null ? muted : totalPnl >= 0 ? terminal : danger }]}>{totalPnl == null ? "—" : `${totalPnl >= 0 ? "+" : ""}${formatKRW(totalPnl)}`}</Text>
            </View>
          </View>
          <View style={styles.sparkWrap}>
            <MiniSpark values={sparkValues} color={terminal} muted={softBorder} />
            <View style={styles.periodRow}><Text style={[styles.periodActive, { color: terminal, borderColor: terminal }]}>1D</Text><Text style={[styles.periodText, { color: muted }]}>1W</Text><Text style={[styles.periodText, { color: muted }]}>1M</Text><Text style={[styles.periodText, { color: muted }]}>ALL</Text></View>
          </View>
        </View>
      </View>

      {disconnected || readOnlyError ? <Pressable onPress={onGoSettings} style={[styles.connectionAction, { borderColor: theme.colors.warning, backgroundColor: panel }]} testID="home-operational-notice">
        <Text style={[styles.connectionTitle, { color: theme.colors.warning }]}>{disconnected ? "PAPER 연결 필요" : "PAPER 연결 오류"}</Text>
        <Text style={[styles.connectionDetail, { color: muted }]}>설정 열기 ›</Text>
      </Pressable> : null}

      <View style={[styles.aiInsightCard, { backgroundColor: panel, borderColor: terminal }]} testID="ai-card">
        <View style={styles.panelTitleRow}>
          <Text style={[styles.aiInsightTitle, { color: terminal }]}>✦ AI INSIGHT</Text>
          <View style={[styles.neutralBadge, { borderColor: terminal }]}><Text style={[styles.neutralText, { color: terminal }]}>MARKET · {aiInsightAvailable ? "VERIFIED" : "NEUTRAL"}</Text></View>
        </View>
        <Text style={[styles.insightHeadline, { color: theme.colors.text }]}>{judgement}</Text>
        <Text style={[styles.insightBody, { color: muted }]}>{decisionSurface.why}</Text>
        <View style={styles.decisionGrid}>
          <DecisionTile label="NOW" detail={decisionSurface.now} color={terminal} testID="home-supervisor-now" />
          <DecisionTile label="WHY" detail={decisionSurface.why} color={theme.colors.primary} onPress={aiInsightAvailable ? () => onNavigate("AiSignal") : undefined} testID="home-supervisor-why" />
          <DecisionTile label="RESULT" detail={decisionSurface.result} color={terminal} onPress={account == null ? undefined : () => onNavigate("Portfolio")} testID="home-supervisor-result" />
          <DecisionTile label="RISK" detail={decisionSurface.risk} color={riskColor} testID="home-supervisor-risk" />
          <View nativeID="home-supervisor-learning" testID="home-paper-learning"><DecisionTile label="LEARNING" detail={decisionSurface.learning} color={theme.colors.primary} onPress={disconnected ? undefined : onOpenPaperLearning} testID="home-supervisor-learning" /></View>
        </View>
      </View>

      <View style={[styles.signalCard, { backgroundColor: panel, borderColor: border }]} testID="home-decision-stage">
        <PanelTitle title="◎  SIGNAL TERRAIN" action="전체 신호 보기 ›" color={terminal} />
        <View style={styles.signalBody}>
          <View style={styles.terrainWrap}>
            <View style={[styles.radarRingLarge, { borderColor: softBorder }]} />
            <View style={[styles.radarRingMid, { borderColor: theme.colors.primary }]} />
            <View style={[styles.radarAxisH, { backgroundColor: softBorder }]} />
            <View style={[styles.radarAxisV, { backgroundColor: softBorder }]} />
            <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel="NUSA AI signal terrain" testID="home-signal-trace" />
            <View style={[styles.radarDot, styles.radarDotTop, { backgroundColor: terminal }]} />
            <View style={[styles.radarDot, styles.radarDotRight, { backgroundColor: theme.colors.primary }]} />
            <View style={[styles.radarDot, styles.radarDotLeft, { backgroundColor: danger }]} />
            <Text style={[styles.radarLabel, styles.radarTopLabel, { color: theme.colors.text }]}>{terrainLabels[0]}</Text>
            <Text style={[styles.radarLabel, styles.radarRightLabel, { color: theme.colors.text }]}>{terrainLabels[1]}</Text>
            <Text style={[styles.radarLabel, styles.radarLeftLabel, { color: theme.colors.text }]}>{terrainLabels[2]}</Text>
          </View>
          <View style={[styles.topSignals, { borderColor: softBorder }]}>
            <Text style={[styles.topSignalsTitle, { color: muted }]}>TOP SIGNALS</Text>
            {marketRows.length === 0 ? <Text style={[styles.marketEmpty, { color: muted }]}>검증된 시그널 없음</Text> : marketRows.map((market) => <View key={market.market} style={styles.signalRow}>
              <Text style={[styles.signalMarket, { color: theme.colors.text }]} numberOfLines={1}>{market.market}</Text>
              <Text style={[styles.signalChange, { color: market.changeRate == null ? muted : market.changeRate >= 0 ? terminal : danger }]}>{formatSignedPercent(market.changeRate)}</Text>
            </View>)}
          </View>
        </View>
      </View>

      <Pressable onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.marketPulse, { backgroundColor: panel, borderColor: border, opacity: pressed ? 0.76 : 1 }]} testID="home-market-pulse">
        <PanelTitle title="⌁  MARKET PULSE" action="자세히 보기 ›" color={terminal} />
        <Text style={[styles.marketPulseMeta, { color: muted }]}>실시간 시장 흐름 · UPBIT PUBLIC</Text>
        <View style={styles.marketPulseGrid}>
          {marketRows.length === 0 ? <Text style={[styles.marketEmpty, { color: muted }]}>NO VERIFIED MARKET SNAPSHOT</Text> : marketRows.map((market) => <View key={market.market} style={[styles.marketTile, { borderColor: softBorder }]}>
            <Text style={[styles.marketName, { color: muted }]}>{market.market}</Text>
            <Text style={[styles.marketPrice, { color: theme.colors.text }]}>{formatKRW(market.price)}</Text>
            <Text style={[styles.marketMove, { color: market.changeRate == null ? muted : market.changeRate >= 0 ? terminal : danger }]}>{formatSignedPercent(market.changeRate)}</Text>
          </View>)}
        </View>
      </Pressable>

      <View style={styles.lowerGrid} testID="home-terminal-grid">
        <Pressable onPress={onOpenPaperLearning} style={({ pressed }) => [styles.lowerPanel, { backgroundColor: panel, borderColor: border, opacity: pressed ? 0.76 : 1 }]}>
          <PanelTitle title="◔  PAPER PERFORMANCE" action="자세히 보기 ›" color={terminal} />
          <Text style={[styles.bigMetric, { color: totalPnl == null ? muted : totalPnl >= 0 ? terminal : danger }]}>{formatSignedPercent(dayPnlRate)}</Text>
          <Text style={[styles.metricSub, { color: muted }]}>{rail.pnlBasisLabel} · {totalPnl == null ? "PAPER 결과 없음" : `${totalPnl >= 0 ? "+" : ""}${formatKRW(totalPnl)}`}</Text>
          <Text style={[styles.microMetric, { color: muted }]} testID="home-investable-cash">투자가능 {cashEnvelope == null ? "—" : formatKRW(cashEnvelope.investableCash)}</Text>
          <Text style={[styles.microMetric, { color: muted }]} testID="home-reserved-cash">예비자금 {cashEnvelope == null ? "—" : formatKRW(cashEnvelope.reservedCash)}</Text>
        </Pressable>

        <Pressable onPress={() => onNavigate("Portfolio")} style={({ pressed }) => [styles.lowerPanel, { backgroundColor: panel, borderColor: border, opacity: pressed ? 0.76 : 1 }]}>
          <PanelTitle title="◈  PORTFOLIO" action="자세히 보기 ›" color={terminal} />
          <View style={styles.portfolioRow}><View style={[styles.portfolioDot, { backgroundColor: terminal }]} /><Text style={[styles.portfolioLabel, { color: theme.colors.text }]}>CASH</Text><Text style={[styles.portfolioValue, { color: theme.colors.text }]}>{account == null ? "—" : formatKRW(account.cash)}</Text></View>
          <View style={styles.portfolioRow}><View style={[styles.portfolioDot, { backgroundColor: theme.colors.primary }]} /><Text style={[styles.portfolioLabel, { color: theme.colors.text }]}>ASSET</Text><Text style={[styles.portfolioValue, { color: theme.colors.text }]}>{position?.market ?? "—"}</Text></View>
          <View style={styles.portfolioRow}><View style={[styles.portfolioDot, { backgroundColor: softBorder }]} /><Text style={[styles.portfolioLabel, { color: theme.colors.text }]}>SOURCE</Text><Text style={[styles.portfolioValue, { color: muted }]}>{accountSource ?? "NONE"}</Text></View>
        </Pressable>

        <View style={[styles.lowerPanel, { backgroundColor: panel, borderColor: border }]} testID="safety-card">
          <PanelTitle title="⬡  RISK STATUS" color={terminal} />
          <View style={styles.riskRow}><View style={[styles.healthDot, { backgroundColor: riskColor }]} /><Text style={[styles.healthText, { color: theme.colors.text }]}>위험 {rail.riskLabel}</Text></View>
          <View style={[styles.riskTrack, { backgroundColor: softBorder }]}><View style={[styles.riskFill, { backgroundColor: riskColor, width: rail.risk === "CRITICAL" || rail.risk === "HIGH" ? "84%" : rail.risk === "CAUTION" || rail.risk === "ELEVATED" ? "58%" : "32%" }]} /></View>
          <Text style={[styles.safetyText, { color: muted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
        </View>

        <Pressable onPress={onOpenPaperLearning} style={({ pressed }) => [styles.lowerPanel, { backgroundColor: panel, borderColor: border, opacity: pressed ? 0.76 : 1 }]}>
          <PanelTitle title="▤  LEARNING" action="자세히 보기 ›" color={terminal} />
          <Text style={[styles.learningHeadline, { color: theme.colors.text }]}>변동성은 기회이자 위험이다.</Text>
          <Text style={[styles.learningBody, { color: muted }]} numberOfLines={3}>{decisionSurface.learning}</Text>
        </Pressable>
      </View>
    </ScrollView>

    <View style={[styles.referenceNav, { backgroundColor: theme.colors.background, borderTopColor: softBorder }]} testID="home-reference-navigation">
      <View style={styles.navItem}><Text style={[styles.navIconActive, { color: terminal }]}>◆</Text><Text style={[styles.navTextActive, { color: theme.colors.text }]}>홈</Text></View>
      <Pressable onPress={() => onNavigate("Markets")} style={styles.navItem}><Text style={[styles.navIcon, { color: muted }]}>⌁</Text><Text style={[styles.navText, { color: muted }]}>관찰</Text></Pressable>
      <Pressable onPress={() => onNavigate("AiSignal")} style={styles.navItem}><Text style={[styles.navIcon, { color: muted }]}>◎</Text><Text style={[styles.navText, { color: muted }]}>시그널</Text></Pressable>
      <Pressable onPress={onOpenPaperLearning} style={styles.navItem}><Text style={[styles.navIcon, { color: muted }]}>▣</Text><Text style={[styles.navText, { color: muted }]}>페이퍼</Text></Pressable>
      <Pressable onPress={() => onNavigate("Portfolio")} style={styles.navItem}><Text style={[styles.navIcon, { color: muted }]}>◔</Text><Text style={[styles.navText, { color: muted }]}>포트폴리오</Text></Pressable>
      <Pressable onPress={onGoSettings} style={styles.navItem}><Text style={[styles.navIcon, { color: muted }]}>•••</Text><Text style={[styles.navText, { color: muted }]}>더보기</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 },
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 118, gap: 16 },
  masterRail: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  brandOrb: { width: 38, height: 38, borderRadius: 20, borderWidth: 2 },
  wordmark: { fontSize: 30, lineHeight: 34, fontWeight: "900", letterSpacing: 5 },
  brandMetaWrap: { gap: 1 },
  brandMeta: { fontSize: 8, lineHeight: 10, fontWeight: "800", letterSpacing: 1.8 },
  statusRail: { minHeight: 30, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  statusLine: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  assetHero: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 18 },
  assetTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  sectionLabel: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  assetValue: { marginTop: 6, fontSize: 40, lineHeight: 46, fontWeight: "900", letterSpacing: -1.8, fontVariant: ["tabular-nums"] },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  dayLabel: { fontSize: 13, fontWeight: "700" },
  dayValue: { fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  sparkWrap: { width: "42%", alignItems: "stretch", gap: 8 },
  sparkRow: { height: 42, flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 2 },
  sparkBar: { width: 3, borderRadius: 2 },
  sparkEmpty: { height: 1, width: "100%", marginTop: 22 },
  periodRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, alignItems: "center" },
  periodActive: { fontSize: 10, fontWeight: "900", borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  periodText: { fontSize: 10, fontWeight: "800", opacity: 0.58 },
  aiInsightCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 12 },
  panelTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  aiInsightTitle: { fontSize: 16, lineHeight: 20, fontWeight: "900", letterSpacing: 1.2 },
  neutralBadge: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, paddingVertical: 5 },
  neutralText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  insightHeadline: { fontSize: 27, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8 },
  insightBody: { fontSize: 13, lineHeight: 20, fontWeight: "600" },
  decisionGrid: { flexDirection: "row", gap: 8 },
  decisionTile: { flex: 1, minHeight: 104, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent", overflow: "hidden" },
  decisionTileInner: { flex: 1, padding: 10, justifyContent: "space-between", alignItems: "center" },
  decisionGlyph: { width: 22, height: 22, borderWidth: 2, borderRadius: 11 },
  decisionLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  decisionDetail: { opacity: 0.58, fontSize: 8, lineHeight: 11, textAlign: "center" },
  signalCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 12 },
  panelTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900", letterSpacing: 0.8 },
  panelAction: { opacity: 0.5, fontSize: 10, fontWeight: "700" },
  signalBody: { flexDirection: "row", gap: 14, minHeight: 250 },
  terrainWrap: { flex: 1.6, minHeight: 250, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  radarRingLarge: { position: "absolute", width: 210, height: 210, borderRadius: 105, borderWidth: StyleSheet.hairlineWidth },
  radarRingMid: { position: "absolute", width: 132, height: 132, borderRadius: 66, borderWidth: StyleSheet.hairlineWidth },
  radarAxisH: { position: "absolute", width: "90%", height: StyleSheet.hairlineWidth },
  radarAxisV: { position: "absolute", width: StyleSheet.hairlineWidth, height: "86%" },
  radarDot: { position: "absolute", width: 10, height: 10, borderRadius: 5 },
  radarDotTop: { top: 38, left: "49%" },
  radarDotRight: { top: 94, right: 40 },
  radarDotLeft: { bottom: 58, left: 34 },
  radarLabel: { position: "absolute", fontSize: 9, lineHeight: 12, fontWeight: "800" },
  radarTopLabel: { top: 18, left: "52%" },
  radarRightLabel: { top: 78, right: 4 },
  radarLeftLabel: { bottom: 30, left: 4 },
  topSignals: { width: "34%", borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, alignSelf: "center", gap: 10 },
  topSignalsTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  signalRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  signalMarket: { flex: 1, fontSize: 11, fontWeight: "800" },
  signalChange: { fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketPulse: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 12 },
  marketPulseMeta: { fontSize: 11, fontWeight: "700" },
  marketPulseGrid: { flexDirection: "row", gap: 8 },
  marketTile: { flex: 1, minHeight: 92, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10, justifyContent: "space-between" },
  marketName: { fontSize: 9, fontWeight: "800" },
  marketPrice: { fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketMove: { fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketEmpty: { fontSize: 10, fontWeight: "800" },
  lowerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  lowerPanel: { width: "48.5%", minHeight: 155, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 9 },
  bigMetric: { fontSize: 28, lineHeight: 34, fontWeight: "900", fontVariant: ["tabular-nums"] },
  metricSub: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  microMetric: { fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] },
  portfolioRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  portfolioDot: { width: 9, height: 9, borderRadius: 5 },
  portfolioLabel: { flex: 1, fontSize: 10, fontWeight: "800" },
  portfolioValue: { fontSize: 10, fontWeight: "900", fontVariant: ["tabular-nums"] },
  riskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  healthDot: { width: 10, height: 10, borderRadius: 5 },
  healthText: { fontSize: 11, fontWeight: "900" },
  riskTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  riskFill: { height: "100%", borderRadius: 4 },
  safetyText: { fontSize: 8, lineHeight: 11, fontWeight: "800" },
  learningHeadline: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  learningBody: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  connectionAction: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  connectionTitle: { fontSize: 12, fontWeight: "900" },
  connectionDetail: { fontSize: 10, fontWeight: "700" },
  referenceNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 86, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingBottom: 8, paddingTop: 8 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  navIconActive: { fontSize: 17, fontWeight: "900" },
  navIcon: { fontSize: 16, fontWeight: "700" },
  navTextActive: { fontSize: 9, fontWeight: "900" },
  navText: { fontSize: 9, fontWeight: "700" },
});
