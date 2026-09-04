import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TerrainSignal } from "./components";
import { CompactMetric, InsightPanel, OperationalNotice, QuietStatus } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { getHomeVisualProfile } from "./homeVisualProfile";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { SupervisorProgressPanel } from "./supervisorProgressPanel";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { selectHomeMarketData } from "./homeMarketData";
import type { WatchlistMarket } from "./watchlist";

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

function compactNumber(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function TruthCell({
  label,
  value,
  labelColor,
  valueColor,
  borderColor,
  testID,
  onPress,
  actionLabel,
}: Readonly<{
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
  borderColor: string;
  testID: string;
  onPress?: () => void;
  actionLabel?: string;
}>) {
  const content = <View style={[styles.truthCell, { borderTopColor: borderColor }]} testID={testID}>
    <View style={styles.truthCellHeader}>
      <Text style={[styles.truthLabel, { color: labelColor }]}>{label}</Text>
      {actionLabel ? <Text style={[styles.truthAction, { color: labelColor }]}>{actionLabel}</Text> : null}
    </View>
    <Text style={[styles.truthValue, { color: valueColor }]}>{value}</Text>
  </View>;
  return onPress == null ? content : <Pressable accessibilityRole="button" accessibilityHint={`${label} 세부 정보 보기`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>{content}</Pressable>;
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
  const assetValue = account == null ? null : account.assetValue ?? Math.max(0, account.equity - account.cash);
  const ai = snapshot?.ai ?? null;
  const disconnected = notConfigured != null;
  const runtimeState = snapshot?.operations.runtimeState;
  const heartbeat = snapshot?.operations.heartbeat;
  const marketFeed = selectHomeMarketData(publicMarkets, snapshot?.markets ?? []);
  const marketRows = [...marketFeed]
    .sort((left, right) => Math.abs(right.changeRate ?? 0) - Math.abs(left.changeRate ?? 0))
    .slice(0, tablet ? 5 : 3);
  const marketBreadth = marketFeed.reduce((result, market) => {
    if (market.changeRate == null || market.changeRate === 0) result.flat += 1;
    else if (market.changeRate > 0) result.up += 1;
    else result.down += 1;
    return result;
  }, { up: 0, flat: 0, down: 0 });
  const hasMarketBreadth = marketFeed.length > 0;
  const marketWave = buildChartViewModel({
    market: publicMarket,
    interval: "1m",
    rawCandles: publicCandles === null ? null : [...publicCandles],
    currentPrice: publicCurrentPrice,
    connectionState: publicMarketConnectionState,
    stale: publicMarketStale,
  });
  const marketWaveBars = marketWave.state === "READY" ? marketWave.bars.slice(-20) : [];
  const positionOpen = account != null && account.position.quantity > 0 && Boolean(account.position.market);
  const decisionSurface = buildHomeDecisionSurface({
    runtimeState,
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
  const {
    aiInsightAvailable,
    calibratedConfidence,
    signalReady,
    statusLabel,
    statusTone,
    primaryLabel,
    primaryDetail,
  } = decisionSurface;
  const supervisorWhy = decisionSurface.why;
  const supervisorResult = decisionSurface.result;
  const supervisorRisk = decisionSurface.risk;
  const terrainStrength = signalReady ? 0.92 : snapshot ? 0.45 : 0.25;
  const terrainLabel = aiInsightAvailable ? "NUSA verified signal field" : signalReady ? "NUSA analyzing market" : "NUSA waiting for market connection";
  const terminalSignal = theme.colors.success;
  const counterSignal = theme.colors.danger;
  const terminalBorder = { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface } as const;

  const contentStyle = {
    paddingHorizontal: profile.screen.horizontalPadding,
    paddingTop: profile.screen.topPadding,
    gap: tablet ? 18 : 12,
    paddingBottom: profile.screen.bottomPadding,
    maxWidth: tablet ? Math.max(profile.screen.maxWidth, 980) : profile.screen.maxWidth,
  } as const;

  const runPrimaryAction = () => {
    switch (decisionSurface.primaryAction) {
      case "SETTINGS": return onGoSettings();
      case "PORTFOLIO": return onNavigate("Portfolio");
      case "AI_SIGNAL": return onNavigate("AiSignal");
      case "MARKETS": return onNavigate("Markets");
    }
  };

  const attentionLevel = decisionSurface.attention;
  const attentionColor = attentionLevel === "ACTION REQUIRED"
    ? theme.colors.danger
    : attentionLevel === "WATCH"
      ? terminalSignal
      : theme.colors.textMuted;

  return <ScrollView
    contentContainerStyle={[styles.content, contentStyle]}
    refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.masterRail} testID="home-master-rail">
      <View style={styles.brandLockup}>
        <Text style={[styles.wordmark, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.brandMeta, { color: terminalSignal }]}>AUTONOMOUS INVESTMENT INTELLIGENCE</Text>
      </View>
      <QuietStatus label={statusLabel} tone={statusTone} testID="home-paper-status" />
    </View>

    <View style={[styles.intelligenceHero, { borderColor: attentionLevel === "QUIET" ? theme.colors.borderStrong : attentionColor }]} testID="home-supervisor-summary">
      <View style={styles.heroTopline}>
        <Text style={[styles.kicker, { color: terminalSignal }]}>AI INSIGHT / SIGNAL TERRAIN</Text>
        <Text style={[styles.attentionLabel, { color: attentionColor }]} testID="home-supervisor-attention">{attentionLevel}</Text>
      </View>
      <Text style={[styles.nowLabel, { color: theme.colors.textMuted }]}>NOW</Text>
      <Text style={[styles.nowValue, { color: theme.colors.text }]} testID="home-supervisor-now">{decisionSurface.now}</Text>
      <Text style={[styles.authorityMode, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>

      <View style={styles.heroSignalWrap} testID="ai-card">
        <View style={[styles.heroSignal, { borderColor: theme.colors.border }]} testID="home-decision-stage">
          <View style={[styles.signalAxisH, { backgroundColor: theme.colors.border }]} />
          <View style={[styles.signalAxisV, { backgroundColor: theme.colors.border }]} />
          <View style={[styles.signalPulse, { borderColor: terminalSignal }]} />
          <TerrainSignal variant="symbolic" signalStrength={terrainStrength} accessibilityLabel={terrainLabel} testID="home-signal-trace" />
          <View style={styles.signalAnchors}>
            <Text style={[styles.signalAnchor, { color: theme.colors.textMuted }]}>RISK</Text>
            <Text style={[styles.signalAnchor, { color: terminalSignal }]}>NEUTRAL</Text>
            <Text style={[styles.signalAnchor, { color: theme.colors.textMuted }]}>OPPORTUNITY</Text>
          </View>
        </View>
        <View style={[styles.decisionCopy, { borderTopColor: theme.colors.border }]} testID={aiInsightAvailable ? "home-verified-decision" : "home-pending-decision"}>
          <Text style={[styles.judgement, { color: theme.colors.text }]}>{aiInsightAvailable ? (ai?.thesis ?? "") : disconnected ? "PAPER LINK REQUIRED" : "DECISION HOLD"}</Text>
          <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{aiInsightAvailable ? `EVIDENCE ${ai?.evidenceReferences.length ?? 0} · ${calibratedConfidence ?? "UNCALIBRATED"} · AI READ ONLY · ZERO AUTHORITY` : primaryDetail}</Text>
        </View>
      </View>

      <View style={styles.heroFooter}>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>AI ZERO AUTHORITY · productionMutationAllowed=false · liveAuthority=NONE</Text>
        <Pressable accessibilityRole="button" onPress={runPrimaryAction} style={({ pressed }) => [styles.primaryButton, { borderColor: attentionLevel === "ACTION REQUIRED" ? attentionColor : terminalSignal, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-supervisor-primary-action">
          <Text style={[styles.primaryLabel, { color: attentionLevel === "ACTION REQUIRED" ? attentionColor : terminalSignal }]}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>

    <View style={[styles.truthRail, { borderColor: theme.colors.borderStrong }]}>
      <TruthCell label="WHY" value={supervisorWhy} labelColor={theme.colors.textMuted} valueColor={theme.colors.text} borderColor={theme.colors.border} testID="home-supervisor-why" onPress={aiInsightAvailable ? () => onNavigate("AiSignal") : undefined} actionLabel={aiInsightAvailable ? "EVIDENCE →" : undefined} />
      <TruthCell label="RESULT" value={supervisorResult} labelColor={theme.colors.textMuted} valueColor={theme.colors.text} borderColor={theme.colors.border} testID="home-supervisor-result" onPress={account == null ? undefined : () => onNavigate("Portfolio")} actionLabel={account == null ? undefined : "SUPERVISE →"} />
      <TruthCell label="RISK" value={supervisorRisk} labelColor={attentionColor} valueColor={attentionLevel === "QUIET" ? theme.colors.text : attentionColor} borderColor={theme.colors.border} testID="home-supervisor-risk" />
      <View testID="home-paper-learning">
        <TruthCell label="LEARNING" value={decisionSurface.learning} labelColor={theme.colors.textMuted} valueColor={theme.colors.text} borderColor={theme.colors.border} testID="home-supervisor-learning" onPress={disconnected ? undefined : onOpenPaperLearning} actionLabel={disconnected ? undefined : "EVIDENCE →"} />
      </View>
    </View>

    <SupervisorProgressPanel refreshing={refreshing} />

    <View style={styles.terminalGrid} testID="home-terminal-grid">
      <Pressable onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.terminalPanel, terminalBorder, { opacity: pressed ? 0.72 : 1 }]} testID="home-market-pulse">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>MARKET PULSE</Text>
          <Text style={[styles.panelCode, { color: terminalSignal }]}>UPBIT PUBLIC</Text>
        </View>
        {marketRows.length > 0 ? <View style={styles.marketRows}>
          {marketRows.map((market) => <View key={market.market} style={[styles.marketRow, { borderTopColor: theme.colors.border }]}>
            <View style={styles.marketIdentity}>
              <Text style={[styles.marketSymbol, { color: theme.colors.text }]}>{market.market}</Text>
              <Text style={[styles.micro, { color: theme.colors.textMuted }]}>{new Date(market.observedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
            <View style={styles.marketQuote}>
              <Text style={[styles.marketPrice, { color: theme.colors.text }]}>{krw(market.price)}</Text>
              <Text style={[styles.marketChange, { color: market.changeRate == null ? theme.colors.textMuted : market.changeRate >= 0 ? terminalSignal : theme.colors.danger }]}>{signedPercent(market.changeRate)}</Text>
            </View>
          ))}
        </View> : <View style={styles.unavailableBlock} testID="home-market-unavailable">
          <Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>NO VERIFIED MARKET SNAPSHOT</Text>
          <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>검증된 public ticker가 도착하기 전 가격을 만들지 않습니다.</Text>
        </View>}
        <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>OPEN MARKETS →</Text>
      </Pressable>

      <View style={[styles.terminalPanel, terminalBorder]} testID="home-market-structure">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>MARKET STRUCTURE</Text>
          <Text style={[styles.panelCode, { color: theme.colors.textMuted }]}>TICKER BREADTH</Text>
        </View>
        {hasMarketBreadth ? <>
          <View style={[styles.breadthBar, { backgroundColor: theme.colors.surfaceSunken }]} accessibilityLabel={`market breadth up ${marketBreadth.up}, flat ${marketBreadth.flat}, down ${marketBreadth.down}`}>
            {marketBreadth.up > 0 ? <View style={{ flex: marketBreadth.up, backgroundColor: terminalSignal }} /> : null}
            {marketBreadth.flat > 0 ? <View style={{ flex: marketBreadth.flat, backgroundColor: theme.colors.borderStrong }} /> : null}
            {marketBreadth.down > 0 ? <View style={{ flex: marketBreadth.down, backgroundColor: theme.colors.danger }} /> : null}
          </View>
          <View style={styles.breadthLegend}>
            <Text style={[styles.breadthValue, { color: terminalSignal }]}>UP {marketBreadth.up}</Text>
            <Text style={[styles.breadthValue, { color: theme.colors.textMuted }]}>FLAT {marketBreadth.flat}</Text>
            <Text style={[styles.breadthValue, { color: theme.colors.danger }]}>DOWN {marketBreadth.down}</Text>
          </View>
          <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>ORDER FLOW: UNAVAILABLE · canonical depth feed not present in HOME snapshot</Text>
        </> : <View style={styles.unavailableBlock}>
          <Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>STRUCTURE UNAVAILABLE</Text>
          <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>ticker breadth / order flow 데이터가 없습니다.</Text>
        </View>}
      </View>
    </View>

    <View style={styles.terminalGrid}>
      <View style={[styles.terminalPanel, terminalBorder]} testID="home-paper-performance">
        <View testID="account-hero-card">
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, { color: theme.colors.text }]}>PAPER PERFORMANCE</Text>
            <Text style={[styles.panelCode, { color: terminalSignal }]}>{accountSource ?? "NO LINK"}</Text>
          </View>
          <View style={styles.metricMatrix}>
            <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>EQUITY</Text><Text style={[styles.metricNumber, { color: theme.colors.text }]}>{account ? krw(account.equity) : "—"}</Text></View>
            <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>P&L</Text><Text style={[styles.metricNumber, styles.cashValue, { color: totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? terminalSignal : theme.colors.danger }]}>{totalPnl == null ? "—" : `${totalPnl >= 0 ? "+" : ""}${krw(totalPnl)}`}</Text></View>
            <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>ORDERS</Text><Text style={[styles.metricNumber, { color: theme.colors.text }]}>{heartbeat?.paperOrderCount ?? "—"}</Text></View>
            <View style={[styles.metricTile, { borderColor: theme.colors.border }]}><Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>FILLS</Text><Text style={[styles.metricNumber, { color: theme.colors.text }]}>{heartbeat?.paperFillCount ?? "—"}</Text></View>
          </View>
        </View>
        {marketWave.state === "READY" ? <View style={styles.marketWave} testID="home-market-wave-ready">
          <View style={styles.marketWaveHeader}>
            <Text style={[styles.metricKey, { color: theme.colors.textMuted }]}>MARKET WAVE · {marketWave.market} · 1m</Text>
            <Text style={[styles.marketWavePrice, { color: theme.colors.text }]}>{marketWave.currentPrice == null ? "—" : krw(marketWave.currentPrice)}</Text>
          </View>
          <View style={[styles.marketWaveStrip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken }]} accessibilityLabel={`${marketWave.market} validated one minute candle market wave`}>
            {marketWaveBars.map((bar) => <View key={bar.openTime} style={styles.marketWaveSlot}>
              <View style={[styles.marketWaveWick, { top: `${bar.wickTop}%`, height: `${bar.wickHeight}%`, backgroundColor: bar.up ? terminalSignal : theme.colors.danger }]} />
              <View style={[styles.marketWaveBody, { top: `${bar.bodyTop}%`, height: `${bar.bodyHeight}%`, backgroundColor: bar.up ? terminalSignal : theme.colors.danger }]} />
            </View>)}
          </View>
        </View> : <View style={styles.marketWaveUnavailable} testID="home-market-wave-unavailable">
          <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>MARKET WAVE: UNAVAILABLE · {marketWave.error ?? marketWave.state}</Text>
        </View>}
      </View>

      <View style={[styles.terminalPanel, terminalBorder]} testID="home-context-panel">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>NEWS / ECON</Text>
          <Text style={[styles.panelCode, { color: theme.colors.textMuted }]}>SOURCE</Text>
        </View>
        <View style={styles.unavailableBlock}>
          <Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>NO VERIFIED FEED</Text>
          <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>뉴스·경제지표는 검증된 canonical feed 연결 전까지 명시적으로 비활성화합니다.</Text>
        </View>
      </View>
    </View>

    <View style={styles.terminalGrid}>
      <Pressable onPress={() => onNavigate("Portfolio")} style={({ pressed }) => [styles.terminalPanel, terminalBorder, { opacity: pressed ? 0.72 : 1 }]} testID="home-portfolio-matrix">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>PORTFOLIO / ALLOCATION</Text>
          <Text style={[styles.panelCode, { color: terminalSignal }]}>{accountSource ? `${accountSource} PAPER` : "NO LINK"}</Text>
        </View>
        {account ? <>
          <View style={styles.portfolioRows}>
            <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>CASH</Text><Text style={[styles.dataValue, { color: theme.colors.text }]}>{krw(account.cash)}</Text></View>
            <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>ASSET VALUE</Text><Text style={[styles.dataValue, { color: theme.colors.text }]}>{assetValue == null ? "—" : krw(assetValue)}</Text></View>
            <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>POSITION</Text><Text style={[styles.dataValue, { color: positionOpen ? terminalSignal : theme.colors.textMuted }]}>{positionOpen ? `${account.position.market} · ${compactNumber(account.position.quantity)}` : "NONE"}</Text></View>
          </View>
          {accountSource === "LOCAL" ? <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]} testID="home-local-paper-note">LOCAL PAPER · 실제 계좌/Cloud PAPER와 합산하지 않음</Text> : <Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>CLOUD PAPER · REAL account not blended</Text>}
        </> : <View style={styles.unavailableBlock}><Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>PORTFOLIO UNAVAILABLE</Text><Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>PAPER source가 연결되기 전 자산 값을 만들지 않습니다.</Text></View>}
      </Pressable>

      <View style={[styles.terminalPanel, terminalBorder]} testID="home-capital-limits">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>CAPITAL LIMITS</Text>
          <Text style={[styles.panelCode, { color: theme.colors.textMuted }]}>PAPER ONLY</Text>
        </View>
        {cashEnvelope ? <View style={styles.portfolioRows} testID="home-cash-allocation">
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]} testID="home-investable-cash"><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>DEPLOYABLE {cashEnvelope.investmentPercent}%</Text><Text style={[styles.dataValue, { color: terminalSignal }]}>{krw(cashEnvelope.investableCash)}</Text></View>
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]} testID="home-reserved-cash"><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>RESERVE {cashEnvelope.reservePercent}%</Text><Text style={[styles.dataValue, { color: theme.colors.text }]}>{krw(cashEnvelope.reservedCash)}</Text></View>
        </View> : <View style={styles.unavailableBlock}><Text style={[styles.unavailableTitle, { color: theme.colors.text }]}>LIMITS UNAVAILABLE</Text><Text style={[styles.panelMeta, { color: theme.colors.textMuted }]}>PAPER cash source가 없습니다.</Text></View>}
      </View>
    </View>

    <View style={[styles.riskPanel, { borderColor: counterSignal, backgroundColor: theme.colors.surface }]} testID="home-risk-authority">
      <View testID="safety-card">
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>RISK / AUTHORITY</Text>
          <Text style={[styles.panelCode, { color: counterSignal }]}>FAIL CLOSED</Text>
        </View>
        <View style={styles.riskRows}>
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>PAPER GATE</Text><Text style={[styles.dataValue, { color: snapshot?.readyForPaperOperations ? terminalSignal : theme.colors.warning }]}>{snapshot?.readyForPaperOperations ? "READY" : "BLOCKED"}</Text></View>
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>AI AUTHORITY</Text><Text style={[styles.dataValue, { color: terminalSignal }]}>ZERO</Text></View>
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>LIVE AUTHORITY</Text><Text style={[styles.dataValue, { color: theme.colors.text }]}>NONE</Text></View>
          <View style={[styles.dataRow, { borderTopColor: theme.colors.border }]}><Text style={[styles.dataKey, { color: theme.colors.textMuted }]}>PRODUCTION MUTATION</Text><Text style={[styles.dataValue, { color: theme.colors.text }]}>FALSE</Text></View>
        </View>
      </View>
    </View>

    {disconnected ? <OperationalNotice title="PAPER 연결이 필요합니다" detail="연결 전에는 실제 PAPER 계좌와 판단 데이터를 표시하지 않습니다." tone="warning" actionLabel="PAPER 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}
    {readOnlyError ? <OperationalNotice title="시장 연결을 확인할 수 없습니다" detail="NUSA는 새로운 PAPER 판단을 보류합니다." tone="danger" actionLabel="설정에서 연결" onAction={onGoSettings} actionTestID="dashboard-open-settings" testID="home-operational-notice" /> : null}

    <View style={[styles.secondaryDiagnostics, { borderTopColor: theme.colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: diagnosticsOpen }} onPress={() => setDiagnosticsOpen((open) => !open)} style={({ pressed }) => [styles.diagnosticsToggle, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]} testID="home-diagnostics-toggle">
        <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>SYSTEM / SAFETY</Text><Text style={[styles.diagnosticsToggleLabel, { color: theme.colors.text }]}>{diagnosticsOpen ? "CLOSE" : "OPEN"}</Text>
      </Pressable>
      {diagnosticsOpen ? <View testID="home-secondary-diagnostics">
        <CompactMetric label="PAPER 연결" value={snapshot ? "연결됨" : accountSource === "LOCAL" ? "LOCAL PAPER" : notConfigured ? "연결 필요" : "대기"} detail={statusLabel} tone={snapshot ? "success" : accountSource === "LOCAL" ? "info" : "warning"} />
        <CompactMetric label="Runtime" value={runtimeState ?? "STANDBY"} detail="현재 PAPER runtime 상태" tone={runtimeState === "RUNNING" ? "success" : runtimeState === "HALTED" ? "danger" : "default"} />
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
  masterRail: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 2, paddingBottom: 4 },
  brandLockup: { gap: 1 },
  wordmark: { fontSize: 32, lineHeight: 34, fontWeight: "900", letterSpacing: 2.2 },
  brandMeta: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 1.35 },
  intelligenceHero: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16, gap: 10 },
  heroTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  kicker: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.35 },
  attentionLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.4 },
  nowLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 2.2, marginTop: 4 },
  nowValue: { fontSize: 28, lineHeight: 33, fontWeight: "900", letterSpacing: -0.8, maxWidth: 720 },
  authorityMode: { fontSize: 8, lineHeight: 11, fontWeight: "800", letterSpacing: 0.8 },
  heroSignalWrap: { gap: 0 },
  heroSignal: { height: 228, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", position: "relative", justifyContent: "center" },
  signalAxisH: { position: "absolute", left: 0, right: 0, top: "50%", height: StyleSheet.hairlineWidth },
  signalAxisV: { position: "absolute", top: 0, bottom: 0, left: "50%", width: StyleSheet.hairlineWidth },
  signalPulse: { position: "absolute", width: 104, height: 104, borderRadius: 52, borderWidth: StyleSheet.hairlineWidth, left: "50%", top: "50%", marginLeft: -52, marginTop: -52, opacity: 0.55 },
  signalAnchors: { position: "absolute", left: 10, right: 10, bottom: 8, flexDirection: "row", justifyContent: "space-between" },
  signalAnchor: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 1.1 },
  decisionCopy: { borderTopWidth: 1, paddingTop: 10, gap: 5 },
  judgement: { fontSize: 15, lineHeight: 21, fontWeight: "800", letterSpacing: -0.2 },
  meta: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.25 },
  heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  primaryButton: { minHeight: 48, minWidth: 132, borderWidth: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.05 },
  truthRail: { borderWidth: 1, paddingHorizontal: 11 },
  truthCell: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 9, gap: 4 },
  truthCellHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  truthLabel: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 1.35 },
  truthAction: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.8 },
  truthValue: { fontSize: 10, lineHeight: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  terminalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  terminalPanel: { flexGrow: 1, flexBasis: 154, minHeight: 142, borderWidth: StyleSheet.hairlineWidth, padding: 11, gap: 8 },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelTitle: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 0.7 },
  panelCode: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.8 },
  panelMeta: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.3 },
  micro: { fontSize: 7, lineHeight: 10, fontWeight: "700", fontVariant: ["tabular-nums"] },
  unavailableBlock: { flex: 1, justifyContent: "center", gap: 5, minHeight: 58 },
  unavailableTitle: { fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 0.45 },
  marketRows: { gap: 0 },
  marketRow: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  marketIdentity: { flex: 1, minWidth: 0, gap: 1 },
  marketSymbol: { fontSize: 10, lineHeight: 13, fontWeight: "900", letterSpacing: 0.3 },
  marketQuote: { alignItems: "flex-end", gap: 1 },
  marketPrice: { fontSize: 10, lineHeight: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketChange: { fontSize: 8, lineHeight: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  breadthBar: { height: 18, flexDirection: "row", overflow: "hidden", marginTop: 14 },
  breadthLegend: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  breadthValue: { fontSize: 8, lineHeight: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  metricMatrix: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  metricTile: { width: "48%", minHeight: 54, borderWidth: StyleSheet.hairlineWidth, padding: 7, justifyContent: "space-between" },
  metricKey: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.7 },
  metricNumber: { fontSize: 11, lineHeight: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  cashValue: { fontSize: 15, lineHeight: 19, fontWeight: "800", fontVariant: ["tabular-nums"] },
  marketWave: { gap: 5, paddingTop: 2 },
  marketWaveHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  marketWavePrice: { fontSize: 9, lineHeight: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketWaveStrip: { height: 62, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "stretch", overflow: "hidden", paddingHorizontal: 3 },
  marketWaveSlot: { flex: 1, position: "relative", minWidth: 2 },
  marketWaveWick: { position: "absolute", left: "48%", width: 1 },
  marketWaveBody: { position: "absolute", left: "22%", width: "56%", minHeight: 1 },
  marketWaveUnavailable: { minHeight: 40, justifyContent: "center" },
  portfolioRows: { gap: 0 },
  dataRow: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dataKey: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.65 },
  dataValue: { fontSize: 9, lineHeight: 12, fontWeight: "900", fontVariant: ["tabular-nums"], textAlign: "right" },
  riskPanel: { borderWidth: 1, padding: 11, gap: 8 },
  riskRows: { gap: 0, marginTop: 7 },
  secondaryDiagnostics: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 8 },
  diagnosticsToggle: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  diagnosticsToggleLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1 },
});
