import React, { useState } from "react";
import { buildJournal, journalTime } from "./journalModel";
import { fieldFonts } from "./fieldFonts";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { describePaperOrderReason } from "./paperOrderReason";
import { buildHomeStatusRail } from "./homeStatusRail";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { isLocalPaperLedgerDisplayable } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { selectHomeMarketData } from "./homeMarketData";
import { freshestObservedAtMs, type WatchlistMarket } from "./watchlist";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { CandlePlot } from "./chartView";
import { FactRow, StateNotice } from "./intelligenceOs";
import { MotionReveal } from "./components";
import { BUILD_SOURCE_SHA } from "./generatedBuildConfig";
import { visualSystem } from "./visualSystem";
import { buildHomeFieldInput } from "./homeFieldInput";
import { buildAiTrustLine, buildLearningLine } from "./learningLineModel";
import { useDailyCounts } from "./useDailyCounts";
import { buildBuySignalLine } from "./buySignalModel";
import { buildIntelligenceField } from "./intelligenceFieldModel";
import { DecisionRings } from "./decisionRings";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Paper" | "Live" | "More";

interface HomeViewProps {
  readonly snapshot: Snapshot | null;
  readonly investmentPercent: number;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  /** Trusted device, session restore in flight or retry armed: not a setup problem. */
  readonly sessionRecovering?: boolean;
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

function krw(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${krw(Math.abs(value))}`;
}

function signedPercentFromRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const percent = value * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function cloudExposure(account: Snapshot["portfolio"] extends null ? never : NonNullable<Snapshot["portfolio"]>["account"]): number {
  if (account.assetValue != null && Number.isFinite(account.assetValue)) return account.assetValue;
  if (!Number.isFinite(account.position.quantity) || !Number.isFinite(account.markPrice)) return 0;
  return account.position.quantity * account.markPrice;
}

export function HomeView({
  snapshot,
  investmentPercent,
  readOnlyError,
  notConfigured,
  sessionRecovering = false,
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
  const ui = visualSystem(theme);
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const marketChart = buildChartViewModel({ market: publicMarket, interval: "1m", rawCandles: publicCandles === null ? null : [...publicCandles], currentPrice: publicCurrentPrice, connectionState: publicMarketConnectionState, stale: publicMarketStale });
  // The on-device ledger is only a fallback for a device with no PAPER server configured. While a
  // configured server session is still recovering, its placeholder ₩10,000,000 must not show.
  const localPaperActive = snapshot == null && isLocalPaperActive() && isLocalPaperLedgerDisplayable();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const cloudAccount = snapshot?.portfolio?.account ?? null;
  const localAccount = localPortfolio?.account ?? null;
  const account = cloudAccount ?? localAccount;
  const accountSource = snapshot != null ? "CLOUD" : localPortfolio != null ? "LOCAL" : null;
  const capitalLabel = accountSource === "LOCAL" ? "PAPER 자산 · 기기" : accountSource === "CLOUD" ? "PAPER 자산 · 서버" + (sessionRecovering ? " · 재확인 중" : "") : "PAPER 자산";
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const exposure = cloudAccount != null ? cloudExposure(cloudAccount) : localAccount?.assetValue ?? null;
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const marketRows = [...selectHomeMarketData(publicMarkets, snapshot?.markets ?? [])]
    .sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
    .slice(0, tablet ? 5 : 3);
  const ai = snapshot?.ai ?? null;
  const learningLine = buildLearningLine(snapshot?.research ?? null);
  const aiTrustLine = buildAiTrustLine(snapshot?.ai ?? null);
  const journal = buildJournal(snapshot?.paperLearning?.events ?? []);
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
  // Kept outside buildHomeDecisionSurface so that module stays dependency-free (it is tested by transpiling the single file).
  const orderReason = disconnected || readOnlyError != null || sessionRecovering ? null : describePaperOrderReason(snapshot?.operations.heartbeat?.lastPaperDecisionOutcome);
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
  const aiInsightAvailable = decisionSurface.aiInsightAvailable && !disconnected && readOnlyError == null;
  const recovering = disconnected && sessionRecovering;
  const why = aiInsightAvailable ? decisionSurface.why : disconnected ? "Cloud PAPER 상태가 연결되기 전에는 판단 근거를 확정하지 않습니다." : decisionSurface.why;
  const riskHigh = rail.risk === "HIGH" || rail.risk === "CRITICAL";
  const riskWarn = rail.risk === "CAUTION" || rail.risk === "ELEVATED";
  const riskColor = riskHigh ? theme.colors.danger : riskWarn ? theme.colors.warning : theme.colors.success;
  const systemColor = disconnected || readOnlyError ? theme.colors.warning : snapshot?.health === "HEALTHY" ? theme.colors.success : theme.colors.info;
  const position = account?.position ?? null;
  const hasPosition = Boolean(position && Number(position.quantity) > 0);
  const openOrders = snapshot?.portfolio?.openOrderCount ?? null;
  const pnlColor = totalPnl == null ? theme.colors.text : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const connectionLabel = disconnected ? "SETUP" : readOnlyError ? "DEGRADED" : snapshot?.readyForPaperOperations ? "ACTIVE" : "OBSERVING";
  // A trusted device whose session is being recovered is not a setup problem: project it as
  // reconnecting. SETUP remains only for a configuration or trust failure that needs the owner.
  const shownConnectionLabel = recovering ? "RECOVERING" : connectionLabel;

  const fieldInput = buildHomeFieldInput({ snapshot, readOnlyError, notConfigured, sessionRecovering: Boolean(sessionRecovering), publicMarketStale });
  // The rings show history; a current fault (halt, degraded runtime, lost connection) stays on top of them.
  const dailyCounts = useDailyCounts(snapshot?.operations.heartbeat?.startedAt ?? null, fieldInput.decisionCount, fieldInput.paperOrderCount);
  const field = buildIntelligenceField({ ...fieldInput, decisionCount: dailyCounts.decisionCount, paperOrderCount: dailyCounts.paperOrderCount });
  const buyHeartbeat = fieldInput.disconnected || readOnlyError != null ? null : snapshot?.operations.heartbeat ?? null;
  const buySignalLine = buildBuySignalLine({ buySignals: buyHeartbeat?.buySignalCount, buyBlocked: buyHeartbeat?.buyBlockedCount, since: buyHeartbeat?.buyCountsSince });
  const ringsStatus = field.phase === "HALTED" || field.phase === "DEGRADED" || field.phase === "AUTHENTICATION" || field.phase === "RECOVERING"
    ? { title: field.headline, detail: field.detail, tone: field.phase === "HALTED" ? "halt" as const : "warning" as const }
    : null;
  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView
      contentContainerStyle={[styles.content, { maxWidth: tablet ? 1080 : 720 }]}
      refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.appBar} testID="home-master-rail">
        <View style={styles.brandLockup}>
          <View style={[styles.liveDot, { backgroundColor: systemColor }]} />
          <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onGoSettings} style={({ pressed }) => [styles.statusCapsule, { borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]}>
          <Text style={[styles.statusCapsuleText, { color: systemColor }]}>{shownConnectionLabel}</Text>
        </Pressable>
      </View>

      <View testID="home-now"><DecisionRings status={ringsStatus} decisionCount={fieldInput.disconnected || readOnlyError != null ? null : dailyCounts.decisionCount} paperOrderCount={fieldInput.disconnected || readOnlyError != null ? null : dailyCounts.paperOrderCount} /></View>

      {orderReason == null ? null : <View style={[styles.reasonCard, { borderColor: orderReason.category === "FILLED" || orderReason.category === "WAITING" || orderReason.category === "UNKNOWN" ? theme.colors.border : theme.colors.warning }]} testID="home-order-reason-card">
        <Text style={[styles.eyebrow, { color: orderReason.category === "FILLED" ? theme.colors.success : orderReason.category === "WAITING" || orderReason.category === "UNKNOWN" ? theme.colors.textMuted : theme.colors.warning }]}>{orderReason.category === "FILLED" ? "최근 체결" : orderReason.category === "UNKNOWN" ? "최근 판단 결과" : "주문하지 않은 이유"}</Text>
        <Text style={[styles.reasonText, { color: theme.colors.text }]} numberOfLines={3} testID="home-no-order-reason">{orderReason.text}</Text>
      </View>}

      {/* While a recovery/degraded banner is shown the rail would only repeat it; on a halt it stays, because it names the cause (e.g. the kill switch). */}
      <View style={[styles.glanceRail, ringsStatus && ringsStatus.tone !== "halt" ? styles.hiddenAcceptanceHooks : null]} testID="home-status-rail">
        <Text style={[styles.glancePrimary, { color: theme.colors.textMuted }]} numberOfLines={1}>{rail.marketLine} · {rail.systemLine}</Text>
        <Text style={[styles.glanceRisk, { color: riskColor }]}>RISK {rail.riskLabel}</Text>
        <View style={styles.hiddenAcceptanceHooks}><Text style={[styles.glanceBuild, { color: theme.colors.textMuted }]} testID="home-build-source">BUILD {packagedBuildLabel} · UI INTELLIGENCE OS</Text></View>
      </View>

      <MotionReveal testID="home-capital-reveal">
        <View style={[styles.capitalRail, { borderColor: ui.color.border }]} testID="account-hero-card">
          <View style={styles.capitalPrimary}>
            <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>{capitalLabel}</Text>
            <Text style={[styles.capitalValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{krw(account?.equity)}</Text>
            <Text style={[styles.pnlValue, { color: pnlColor }]}>총 손익 {signedMoney(totalPnl)}</Text>
          </View>
          <View style={styles.capitalFacts}>
            <View style={styles.capitalFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>현금</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{krw(account?.cash)}</Text></View>
            <View style={styles.capitalFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>노출</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{krw(exposure)}</Text></View>
            <View style={styles.capitalFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>주문</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{openOrders == null ? "—" : String(openOrders)}</Text></View>
          </View>
        </View>
      </MotionReveal>

      {journal.length === 0 ? null : <View style={styles.journal} testID="home-journal">
        <View style={styles.journalHead}><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>최근 기록</Text><Text style={[styles.journalHint, { color: theme.colors.textMuted }]}>중요한 일만</Text></View>
        {journal.map((entry, index) => <View key={entry.id} style={[styles.journalRow, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border } : null]} testID={`home-journal-${entry.kind}`}>
          <Text style={[fieldFonts.mono, styles.journalTime, { color: theme.colors.textMuted }]}>{journalTime(entry.at)}</Text>
          <View style={[styles.journalDot, entry.kind === "fill" ? { backgroundColor: theme.colors.success, borderColor: theme.colors.success } : entry.kind === "hold" ? { borderColor: theme.colors.warning } : entry.kind === "halt" ? { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger } : { borderColor: theme.colors.border, backgroundColor: theme.colors.border }]} />
          <View style={styles.journalBody}>
            <Text style={[styles.journalTitle, { color: entry.kind === "quiet" ? theme.colors.textMuted : theme.colors.text }]}>{entry.title}</Text>
            <Text style={[styles.journalDetail, { color: theme.colors.textMuted }]} numberOfLines={2}>{entry.detail}</Text>
          </View>
        </View>)}
      </View>}

      {disconnected || readOnlyError ? <Pressable accessibilityRole="button" onPress={onGoSettings} testID="home-operational-notice"><StateNotice title={recovering ? "PAPER 재연결 중" : disconnected ? "PAPER 연결 필요" : "PAPER 연결 오류"} detail={`${recovering ? "기기 신뢰는 유지되고 있으며 세션을 자동 복구하는 중입니다." : disconnected ? "Cloud endpoint와 세션을 검증해야 합니다." : readOnlyError ?? "읽기 상태를 확인할 수 없습니다."} · 설정 열기`} tone="warning" /></Pressable> : null}

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen((open) => !open)} style={({ pressed }) => [styles.detailsToggle, { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 }]} testID="home-details-toggle">
        <Text style={[styles.detailsToggleText, { color: theme.colors.text }]}>{moreOpen ? "자세히 닫기" : "시세 · 흐름 · 학습 자세히 보기"}</Text>
      </Pressable>
      {/* The approved prototype keeps HOME to the sphere, the capital and 최근 기록; the rest opens on demand.
          It stays mounted while closed, so release-contract markers remain present. */}
      <View style={moreOpen ? styles.moreBlock : styles.hiddenAcceptanceHooks} testID="home-more-block">
      <MotionReveal testID="home-market-canvas-reveal">
        <View style={[styles.marketCanvas, { borderColor: ui.color.border }]} testID="home-public-market-chart">
          <View style={styles.canvasHeader}>
            <View><Text style={[styles.eyebrow, { color: theme.colors.aiSignalMid }]}>시세</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{publicMarket}</Text></View>
            <View style={styles.canvasQuote}><Text style={[styles.marketPrice, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{krw(marketChart.currentPrice)}</Text><Text style={[styles.sectionMeta, { color: theme.colors.textMuted }]}>업비트 공개 시세 · 읽기 전용</Text></View>
          </View>
          <View style={[styles.canvasChart, { borderColor: theme.colors.border }]}>
            {marketChart.state === "READY" ? <CandlePlot model={marketChart} /> : <Text style={[styles.marketEmpty, { color: theme.colors.textMuted }]}>{publicMarketStale ? "시세가 지연되었거나 연결되지 않았습니다." : "검증된 차트 데이터를 기다리고 있습니다."}</Text>}
          </View>
          <Pressable accessibilityRole="button" onPress={() => onNavigate("Paper")} style={styles.canvasAction}><Text style={[styles.inlineLink, { color: theme.colors.aiSignalEnd }]}>PAPER 운영 보기 →</Text></Pressable>
        </View>
      </MotionReveal>

      <View style={styles.loopHeader}>
        <View><Text style={[styles.eyebrow, { color: theme.colors.aiSignalStart }]}>NUSA 흐름</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>보고, 시험하고, 배웁니다</Text></View>
        <Text style={[styles.sectionMeta, { color: theme.colors.textMuted }]}>실제 돈은 쓰지 않는 PAPER 판단 흐름</Text>
      </View>
      <View style={[styles.commandStack, tablet ? styles.commandStackTablet : null]}>
        <Pressable onPress={() => onNavigate("Paper")} style={({ pressed }) => [styles.command, { backgroundColor: "transparent", borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-decision-stage">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.info }]}>관측</Text><Text style={[styles.commandArrow, { color: theme.colors.textMuted }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>시장 관측</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]}>{marketRows.length === 0 ? "공개 시장 데이터 대기 중" : `${marketRows.length}개 핵심 시장`}</Text>
          <View style={styles.commandPreview}>{marketRows.slice(0, 2).map((market) => <View key={market.market} style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>{market.market}</Text><Text style={[styles.previewValue, { color: (market.changeRate ?? 0) > 0 ? theme.colors.success : (market.changeRate ?? 0) < 0 ? theme.colors.danger : theme.colors.text }]}>{signedPercentFromRate(market.changeRate)}</Text></View>)}</View>
        </Pressable>

        <View style={styles.hiddenAcceptanceHooks} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text>NOW</Text>
          <Text>PAPER EQUITY</Text>
          <Text>QUICK ACCESS</Text>
          <Text>MARKETS</Text>
          <Text>PORTFOLIO</Text>
          <Text>LEARN</Text>
          <Text>PAPER PERFORMANCE</Text>
          <Text>CASH EXPOSURE</Text>
          <FactRow label="RESERVED CASH" value={krw(cashEnvelope?.reservedCash)} tone="success" />
        </View>
        <Pressable onPress={() => onNavigate("More")} style={({ pressed }) => [styles.command, { backgroundColor: "transparent", borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-paper-performance">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.success }]}>기록</Text><Text style={[styles.commandArrow, { color: theme.colors.textMuted }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>성과와 기록</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]}>{hasPosition ? `${position?.market ?? "PAPER"} 보유 중` : account ? "보유 없음" : "계정 대기 중"}</Text>
          <View style={styles.commandPreview}><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>투자 가능</Text><Text style={[styles.previewValue, { color: theme.colors.text }]} testID="home-investable-cash">{krw(cashEnvelope?.investableCash)}</Text></View><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>예비금</Text><Text style={[styles.previewValue, { color: theme.colors.text }]}>{krw(cashEnvelope?.reservedCash)}</Text></View></View>
        </Pressable>

        <Pressable disabled={disconnected} onPress={onOpenPaperLearning} style={({ pressed }) => [styles.command, { backgroundColor: "transparent", borderColor: theme.colors.border, opacity: disconnected ? 0.65 : pressed ? 0.72 : 1 }]} testID="home-paper-learning">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.aiSignalStart }]}>학습</Text><Text style={[styles.commandArrow, { color: theme.colors.aiSignalEnd }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>학습 기록</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]} numberOfLines={2}>{decisionSurface.learning}</Text>
          <Text style={[styles.learningResult, { color: theme.colors.aiSignalEnd }]} numberOfLines={1} testID="home-supervisor-learning">{decisionSurface.result}</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((open) => !open)}
        style={({ pressed }) => [styles.disclosure, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]}
      >
        <View>
          <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>DECISION BASIS</Text>
          <Text style={[styles.disclosureTitle, { color: theme.colors.text }]}>이 판단의 근거</Text>
        </View>
        <Text style={[styles.disclosureIcon, { color: theme.colors.textMuted }]}>{detailsOpen ? "−" : "+"}</Text>
      </Pressable>

      {detailsOpen ? <View style={styles.details}>
        <View style={styles.detailNarrative} testID="ai-card">
          <Text style={[styles.detailCopy, { color: theme.colors.textMuted }]}>{why}</Text>
          {aiInsightAvailable ? <Pressable onPress={() => onNavigate("Paper")}><Text style={[styles.inlineLink, { color: theme.colors.primary }]}>PAPER 근거 상세 보기 →</Text></Pressable> : null}
        </View>
        <View style={[styles.detailFacts, { borderColor: theme.colors.border }]} testID="home-risk-status">
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.detailValue, { color: riskColor }]}>{decisionSurface.risk}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RESULT</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{decisionSurface.result}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>SOURCE</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{accountSource ? `${accountSource} PAPER` : "UNAVAILABLE"}</Text></View>
          <View style={styles.detailRow} testID="home-learning-line"><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>LEARNING</Text><Text style={[styles.detailValue, { color: learningLine.tone === "warn" ? theme.colors.warning ?? theme.colors.text : theme.colors.text }]}>{learningLine.value}</Text></View>
          <View style={styles.detailRow} testID="home-buy-signal-line"><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>BUY 신호</Text><Text style={[styles.detailValue, { color: buySignalLine.tone === "warn" ? theme.colors.warning ?? theme.colors.text : theme.colors.text }]}>{buySignalLine.value}</Text></View>
          <View style={styles.detailRow} testID="home-ai-trust-line"><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>AI 신뢰</Text><Text style={[styles.detailValue, { color: aiTrustLine.tone === "warn" ? theme.colors.warning ?? theme.colors.text : theme.colors.text }]}>{aiTrustLine.value}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>AUTHORITY</Text><Text style={[styles.detailValue, { color: theme.colors.success }]}>LIVE NONE · AI ZERO</Text></View>
        </View>
      </View> : <View style={styles.hiddenAcceptanceHooks}><View testID="ai-card" /><View testID="home-risk-status" /></View>}
      </View>

      <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PUBLIC READ ONLY 데이터는 전략 신호가 아니며, PAPER 결과와 REAL_READ_ONLY 자산은 합산하지 않습니다.</Text>
      <View style={[styles.safetyFooter, { borderTopColor: theme.colors.border }]}><Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  detailsToggle: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center" },
  moreBlock: { gap: 18 },
  detailsToggleText: { fontSize: 14, fontWeight: "500" },
  journal: { gap: 2 },
  journalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  journalHint: { fontSize: 12 },
  journalRow: { flexDirection: "row", gap: 10, paddingVertical: 11 },
  journalTime: { width: 42, fontSize: 11.5, paddingTop: 2 },
  journalDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, marginTop: 6 },
  journalBody: { flex: 1, minWidth: 0, gap: 2 },
  journalTitle: { fontSize: 14, lineHeight: 20 },
  journalDetail: { fontSize: 12.5, lineHeight: 18 },
  reasonCard: { borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  reasonText: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
  shell: { flex: 1 },
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32, gap: 16 },
  appBar: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  liveDot: { width: 8, height: 8, borderRadius: 999 },
  brand: { fontSize: 15, lineHeight: 20, letterSpacing: 4, ...fieldFonts.display },
  statusCapsule: { minHeight: 30, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  statusCapsuleText: { fontSize: 9, lineHeight: 13, fontWeight: "600", letterSpacing: 0.8 },
  glanceRail: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: -8 },
  glancePrimary: { flex: 1, minWidth: 180, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  glanceRisk: { fontSize: 10, lineHeight: 15, fontWeight: "600", letterSpacing: 0.45 },
  glanceBuild: { fontSize: 9, lineHeight: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },

  capitalRail: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap" },
  capitalPrimary: { flex: 1, minWidth: 210, gap: 3 },
  capitalValue: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontVariant: ["tabular-nums"], ...fieldFonts.displayLight },
  capitalFacts: { flexDirection: "row", alignItems: "flex-end", gap: 18, flexWrap: "wrap" },
  capitalFact: { minWidth: 64, gap: 2 },
  // Field language: no card chrome, a single hairline and whitespace.
  marketCanvas: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 12 },
  canvasHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap" },
  canvasQuote: { alignItems: "flex-end", gap: 2, flexShrink: 1 },
  canvasChart: { minHeight: 150, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  canvasAction: { minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  loopHeader: { paddingTop: 4, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },

  eyebrow: { fontSize: 9, lineHeight: 13, letterSpacing: 2, ...fieldFonts.monoMedium },

  marketPrice: { fontSize: 34, lineHeight: 42, fontWeight: "600", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  marketEmpty: { minHeight: 100, paddingVertical: 32, fontSize: 13, lineHeight: 20 },

  pnlValue: { fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.2, fontVariant: ["tabular-nums"] },

  factLabel: { fontSize: 8, lineHeight: 12, fontWeight: "500", letterSpacing: 0.7 },
  factValue: { fontSize: 13, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },

  sectionTitle: { marginTop: 3, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, ...fieldFonts.displayLight },
  sectionMeta: { maxWidth: 150, textAlign: "right", fontSize: 9, lineHeight: 14, fontWeight: "700" },
  commandStack: { gap: 10 },
  commandStackTablet: { flexDirection: "row", alignItems: "stretch" },
  command: { flex: 1, minHeight: 132, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, paddingHorizontal: 2, paddingVertical: 16, gap: 7 },
  commandTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  commandCode: { fontSize: 9, lineHeight: 13, fontWeight: "600", letterSpacing: 1.1 },
  commandArrow: { fontSize: 16, lineHeight: 18, fontWeight: "700" },
  commandTitle: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3, ...fieldFonts.displayLight },
  commandSummary: { fontSize: 11, lineHeight: 17, fontWeight: "600" },
  commandPreview: { marginTop: "auto", gap: 3, paddingTop: 5 },
  previewRow: { minHeight: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  previewLabel: { fontSize: 9, lineHeight: 14, fontWeight: "500" },
  previewValue: { fontSize: 10, lineHeight: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  learningResult: { marginTop: "auto", fontSize: 10, lineHeight: 15, fontWeight: "600" },
  disclosure: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 12 },
  disclosureTitle: { marginTop: 3, fontSize: 19, lineHeight: 24, fontWeight: "600", letterSpacing: -0.35 },
  disclosureIcon: { fontSize: 27, lineHeight: 30, fontWeight: "300" },
  details: { gap: 16 },
  detailNarrative: { gap: 8 },
  detailCopy: { maxWidth: 780, fontSize: 13, lineHeight: 21, fontWeight: "600" },
  inlineLink: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  detailFacts: { borderTopWidth: StyleSheet.hairlineWidth },
  detailRow: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  detailLabel: { flexShrink: 0, fontSize: 9, lineHeight: 14, fontWeight: "600", letterSpacing: 0.7 },
  detailValue: { flex: 1, textAlign: "right", fontSize: 11, lineHeight: 17, fontWeight: "500" },
  hiddenAcceptanceHooks: { position: "absolute", width: 1, height: 1, opacity: 0 },
  disclaimer: { fontSize: 9, lineHeight: 15, fontWeight: "600" },
  safetyFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, alignItems: "center" },
  safetyText: { fontSize: 9, lineHeight: 14, fontWeight: "600", letterSpacing: 1.1 },
});
