import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildHomeStatusRail } from "./homeStatusRail";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { selectHomeMarketData } from "./homeMarketData";
import { freshestObservedAtMs, type WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";
import { StateNotice } from "./intelligenceOs";
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
  refreshing,
  publicMarkets,
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
  const cloudAccount = snapshot?.portfolio?.account ?? null;
  const localAccount = localPortfolio?.account ?? null;
  const account = cloudAccount ?? localAccount;
  const accountSource = snapshot != null ? "CLOUD" : localPortfolio != null ? "LOCAL" : null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const exposure = cloudAccount != null ? cloudExposure(cloudAccount) : localAccount?.assetValue ?? null;
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, investmentPercent);
  const marketRows = [...selectHomeMarketData(publicMarkets, snapshot?.markets ?? [])]
    .sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
    .slice(0, tablet ? 5 : 3);
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
  const posture = disconnected
    ? "PAPER 서버 연결이 필요합니다."
    : readOnlyError
      ? "PAPER 상태를 확인하고 있습니다."
      : decisionSurface.now || "현재 검증된 운용 상태를 확인 중입니다.";
  const why = aiInsightAvailable ? decisionSurface.why : disconnected ? "Cloud PAPER 상태가 연결되기 전에는 판단 근거를 확정하지 않습니다." : decisionSurface.why;
  const riskHigh = rail.risk === "HIGH" || rail.risk === "CRITICAL";
  const riskWarn = rail.risk === "CAUTION" || rail.risk === "ELEVATED";
  const riskColor = riskHigh ? theme.colors.danger : riskWarn ? theme.colors.warning : theme.colors.success;
  const systemColor = disconnected || readOnlyError ? theme.colors.warning : snapshot?.health === "HEALTHY" ? theme.colors.success : theme.colors.info;
  const position = account?.position ?? null;
  const hasPosition = Boolean(position && Number(position.quantity) > 0);
  const openOrders = snapshot?.portfolio?.openOrderCount ?? null;
  const pnlColor = totalPnl == null ? theme.colors.text : totalPnl >= 0 ? theme.colors.success : theme.colors.danger;
  const modeLabel = snapshot?.mode ?? (localPaperActive ? "LOCAL PAPER" : "UNAVAILABLE");
  const connectionLabel = disconnected ? "SETUP REQUIRED" : readOnlyError ? "DEGRADED" : snapshot?.readyForPaperOperations ? "PAPER ACTIVE" : "OBSERVING";

  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView
      contentContainerStyle={[styles.content, { maxWidth: tablet ? 1080 : 720 }]}
      refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topbar} testID="home-master-rail">
        <View style={styles.brandLockup}>
          <View style={[styles.brandDot, { backgroundColor: systemColor }]} />
          <View>
            <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
            <Text style={[styles.brandSub, { color: theme.colors.textMuted }]}>AUTONOMOUS PAPER INTELLIGENCE</Text>
          </View>
        </View>
        <View style={[styles.modePill, { borderColor: systemColor }]}><Text style={[styles.modePillText, { color: systemColor }]}>{connectionLabel}</Text></View>
      </View>

      <View style={styles.statusLine} testID="home-status-rail">
        <Text style={[styles.statusLineText, { color: theme.colors.textMuted }]}>{rail.marketLine} · {rail.systemLine}</Text>
        <View style={styles.statusLineRight}>
          <Text style={[styles.statusRisk, { color: riskColor }]}>RISK {rail.riskLabel}</Text>
          <Text style={[styles.statusBuild, { color: theme.colors.textMuted }]} testID="home-build-source">BUILD {packagedBuildLabel}</Text>
        </View>
      </View>

      <View style={[styles.hero, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.borderStrong }]} testID="home-now">
        <View style={styles.heroHeader}>
          <Text style={[styles.kicker, { color: theme.colors.primary }]}>CURRENT POSTURE</Text>
          <Text style={[styles.heroMode, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE</Text>
        </View>
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{posture}</Text>
        <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]}>{why}</Text>
        <View style={styles.heroFacts}>
          <View style={styles.heroFact}><Text style={[styles.heroFactLabel, { color: theme.colors.textMuted }]}>MODE</Text><Text style={[styles.heroFactValue, { color: theme.colors.text }]}>{modeLabel}</Text></View>
          <View style={styles.heroFact}><Text style={[styles.heroFactLabel, { color: theme.colors.textMuted }]}>AI</Text><Text style={[styles.heroFactValue, { color: theme.colors.info }]}>ZERO AUTHORITY</Text></View>
          <View style={styles.heroFact}><Text style={[styles.heroFactLabel, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.heroFactValue, { color: riskColor }]}>{rail.riskLabel}</Text></View>
        </View>
      </View>

      {disconnected || readOnlyError ? <Pressable accessibilityRole="button" onPress={onGoSettings} testID="home-operational-notice"><StateNotice title={disconnected ? "PAPER 연결 필요" : "PAPER 연결 오류"} detail={`${disconnected ? "Cloud endpoint와 세션을 검증해야 합니다." : readOnlyError ?? "읽기 상태를 확인할 수 없습니다."} · 설정 열기`} tone="warning" /></Pressable> : null}

      <View style={[styles.accountHero, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="account-hero-card">
        <View style={styles.accountPrimary}>
          <Text style={[styles.accountLabel, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text>
          <Text style={[styles.accountValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{krw(account?.equity)}</Text>
          <Text style={[styles.accountPnl, { color: pnlColor }]}>{signedMoney(totalPnl)} total PnL</Text>
        </View>
        <View style={styles.accountSecondary}>
          <View style={styles.miniMetric}><Text style={[styles.miniMetricLabel, { color: theme.colors.textMuted }]}>CASH</Text><Text style={[styles.miniMetricValue, { color: theme.colors.text }]}>{krw(account?.cash)}</Text></View>
          <View style={styles.miniMetric}><Text style={[styles.miniMetricLabel, { color: theme.colors.textMuted }]}>EXPOSURE</Text><Text style={[styles.miniMetricValue, { color: theme.colors.text }]}>{krw(exposure)}</Text></View>
          <View style={styles.miniMetric}><Text style={[styles.miniMetricLabel, { color: theme.colors.textMuted }]}>OPEN ORDERS</Text><Text style={[styles.miniMetricValue, { color: theme.colors.text }]}>{openOrders == null ? "—" : String(openOrders)}</Text></View>
        </View>
      </View>

      <View style={styles.sectionHead}>
        <View><Text style={[styles.kicker, { color: theme.colors.textMuted }]}>WORKSPACE</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>지금 필요한 화면</Text></View>
        <Text style={[styles.sectionHint, { color: theme.colors.textMuted }]}>탭을 찾지 말고 바로 이동</Text>
      </View>

      <View style={[styles.actionGrid, tablet ? styles.actionGridTablet : null]}>
        <Pressable onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.actionTile, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-decision-stage">
          <Text style={[styles.actionIndex, { color: theme.colors.info }]}>01</Text>
          <Text style={[styles.actionTitle, { color: theme.colors.text }]}>시장 관찰</Text>
          <Text style={[styles.actionCopy, { color: theme.colors.textMuted }]}>{marketRows.length === 0 ? "검증된 공개 시장 데이터 대기 중" : `${marketRows.length}개 핵심 시장 움직임 확인`}</Text>
          <View style={styles.marketPreview}>{marketRows.slice(0, 2).map((market) => <View key={market.market} style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>{market.market}</Text><Text style={[styles.previewValue, { color: (market.changeRate ?? 0) > 0 ? theme.colors.success : (market.changeRate ?? 0) < 0 ? theme.colors.danger : theme.colors.text }]}>{signedPercentFromRate(market.changeRate)}</Text></View>)}</View>
          <Text style={[styles.actionLink, { color: theme.colors.info }]}>OBSERVE →</Text>
        </Pressable>

        <Pressable onPress={() => onNavigate("Portfolio")} style={({ pressed }) => [styles.actionTile, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-paper-performance">
          <Text style={[styles.actionIndex, { color: theme.colors.success }]}>02</Text>
          <Text style={[styles.actionTitle, { color: theme.colors.text }]}>PAPER 운용</Text>
          <Text style={[styles.actionCopy, { color: theme.colors.textMuted }]}>{hasPosition ? `${position?.market ?? "PAPER"} position active` : account ? "현재 노출 없음" : "PAPER 계정 대기 중"}</Text>
          <View style={styles.marketPreview}><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>INVESTABLE</Text><Text style={[styles.previewValue, { color: theme.colors.text }]} testID="home-investable-cash">{krw(cashEnvelope?.investableCash)}</Text></View><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>RESERVED</Text><Text style={[styles.previewValue, { color: theme.colors.text }]}>{krw(cashEnvelope?.reservedCash)}</Text></View></View>
          <Text style={[styles.actionLink, { color: theme.colors.success }]}>SUPERVISE →</Text>
        </Pressable>

        <Pressable disabled={disconnected} onPress={onOpenPaperLearning} style={({ pressed }) => [styles.actionTile, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: disconnected ? 0.48 : pressed ? 0.72 : 1 }]} testID="home-paper-learning">
          <Text style={[styles.actionIndex, { color: theme.colors.primary }]}>03</Text>
          <Text style={[styles.actionTitle, { color: theme.colors.text }]}>학습 상태</Text>
          <Text style={[styles.actionCopy, { color: theme.colors.textMuted }]}>{decisionSurface.learning}</Text>
          <Text style={[styles.learningResult, { color: theme.colors.text }]} numberOfLines={2} testID="home-supervisor-learning">{decisionSurface.result}</Text>
          <Text style={[styles.actionLink, { color: theme.colors.primary }]}>EVIDENCE →</Text>
        </Pressable>
      </View>

      <View style={[styles.detailBand, { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }]}>
        <View style={styles.detailLead} testID="ai-card">
          <Text style={[styles.kicker, { color: theme.colors.primary }]}>DECISION BASIS</Text>
          <Text style={[styles.detailTitle, { color: theme.colors.text }]}>왜 지금 이 상태인가</Text>
          <Text style={[styles.detailCopy, { color: theme.colors.textMuted }]}>{why}</Text>
          {aiInsightAvailable ? <Pressable onPress={() => onNavigate("AiSignal")}><Text style={[styles.inlineLink, { color: theme.colors.primary }]}>AI 근거 상세 보기 →</Text></Pressable> : null}
        </View>
        <View style={styles.detailFacts} testID="home-risk-status">
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RISK GATE</Text><Text style={[styles.detailValue, { color: riskColor }]}>{decisionSurface.risk}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RESULT</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{decisionSurface.result}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>SOURCE</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{accountSource ? `${accountSource} PAPER` : "UNAVAILABLE"}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>AUTHORITY</Text><Text style={[styles.detailValue, { color: theme.colors.success }]}>LIVE NONE · AI ZERO</Text></View>
        </View>
      </View>

      <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PUBLIC READ ONLY 데이터는 전략 신호가 아니며, PAPER 결과와 REAL_READ_ONLY 자산은 합산하지 않습니다.</Text>
      <View style={[styles.safetyFooter, { borderTopColor: theme.colors.border }]}><Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 120, gap: 18 },
  topbar: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0, flex: 1 },
  brandDot: { width: 9, height: 9, borderRadius: 999 },
  brand: { fontSize: 19, lineHeight: 22, fontWeight: "900", letterSpacing: 2.2 },
  brandSub: { marginTop: 1, fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1.05 },
  modePill: { minHeight: 29, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  modePillText: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7 },
  statusLine: { minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  statusLineText: { flexShrink: 1, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  statusLineRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusRisk: { fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 0.45 },
  statusBuild: { fontSize: 9, lineHeight: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  hero: { borderWidth: 1, borderRadius: 28, paddingHorizontal: 22, paddingVertical: 24, gap: 13 },
  heroHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  kicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.4 },
  heroMode: { fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.65 },
  heroTitle: { maxWidth: 650, fontSize: 30, lineHeight: 36, fontWeight: "900", letterSpacing: -0.95 },
  heroDetail: { maxWidth: 720, fontSize: 14, lineHeight: 22, fontWeight: "600" },
  heroFacts: { flexDirection: "row", gap: 18, flexWrap: "wrap", paddingTop: 4 },
  heroFact: { gap: 2, minWidth: 86 },
  heroFactLabel: { fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.7 },
  heroFactValue: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
  accountHero: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 18 },
  accountPrimary: { gap: 5 },
  accountLabel: { fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.15 },
  accountValue: { fontSize: 38, lineHeight: 44, fontWeight: "900", letterSpacing: -1.25, fontVariant: ["tabular-nums"] },
  accountPnl: { fontSize: 14, lineHeight: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  accountSecondary: { flexDirection: "row", gap: 18, flexWrap: "wrap" },
  miniMetric: { minWidth: 110, gap: 3 },
  miniMetricLabel: { fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.7 },
  miniMetricValue: { fontSize: 15, lineHeight: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  sectionHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  sectionTitle: { marginTop: 3, fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: -0.45 },
  sectionHint: { maxWidth: 170, textAlign: "right", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  actionGrid: { gap: 12 },
  actionGridTablet: { flexDirection: "row", alignItems: "stretch" },
  actionTile: { flex: 1, minHeight: 184, borderWidth: 1, borderRadius: 22, padding: 17, gap: 8 },
  actionIndex: { fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.25 },
  actionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.35 },
  actionCopy: { minHeight: 36, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  marketPreview: { gap: 4, marginTop: 1 },
  previewRow: { minHeight: 21, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  previewLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800" },
  previewValue: { fontSize: 11, lineHeight: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  learningResult: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  actionLink: { marginTop: "auto", paddingTop: 6, fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 0.85 },
  detailBand: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 20, gap: 20 },
  detailLead: { gap: 7 },
  detailTitle: { fontSize: 20, lineHeight: 26, fontWeight: "900", letterSpacing: -0.35 },
  detailCopy: { maxWidth: 760, fontSize: 13, lineHeight: 21, fontWeight: "600" },
  inlineLink: { marginTop: 3, fontSize: 11, lineHeight: 16, fontWeight: "900" },
  detailFacts: { gap: 0 },
  detailRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  detailLabel: { flexShrink: 0, fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 0.65 },
  detailValue: { flex: 1, textAlign: "right", fontSize: 12, lineHeight: 18, fontWeight: "800" },
  disclaimer: { fontSize: 10, lineHeight: 16, fontWeight: "600" },
  safetyFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, alignItems: "center" },
  safetyText: { fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.15 },
});
