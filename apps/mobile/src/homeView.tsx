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
import { AuthorityRail, FactRow, IntelligenceSection, MetricStrip, ScreenLead, StateNotice } from "./intelligenceOs";

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
  const riskTone = rail.risk === "HIGH" || rail.risk === "CRITICAL" ? "danger" as const : rail.risk === "CAUTION" || rail.risk === "ELEVATED" ? "warning" as const : "success" as const;
  const systemTone = disconnected || readOnlyError ? "warning" as const : snapshot?.health === "HEALTHY" ? "success" as const : "warning" as const;
  const position = account?.position ?? null;
  const hasPosition = Boolean(position && Number(position.quantity) > 0);
  const openOrders = snapshot?.portfolio?.openOrderCount ?? (localPortfolio ? localPortfolio.account.openOrders.length : null);

  return <View style={[styles.shell, { backgroundColor: theme.colors.background }]} testID="home-screen">
    <ScrollView contentContainerStyle={[styles.content, { maxWidth: tablet ? 980 : 680 }]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
      <AuthorityRail detail="AUTONOMOUS INVESTMENT INTELLIGENCE · LIVE NONE · AI ZERO AUTHORITY" status={disconnected ? "NOT CONFIGURED" : readOnlyError ? "DEGRADED" : decisionSurface.statusLabel} tone={systemTone} testID="home-master-rail" />
      <View style={styles.statusRail} testID="home-status-rail">
        <Text style={[styles.statusText, { color: theme.colors.textMuted }]}>{rail.marketLine} · {rail.systemLine}</Text>
        <Text style={[styles.statusTextStrong, { color: riskTone === "danger" ? theme.colors.danger : riskTone === "warning" ? theme.colors.warning : theme.colors.success }]}>RISK {rail.riskLabel}</Text>
        {rail.freshnessLabel ? <Text style={[styles.statusText, { color: theme.colors.textMuted }]}>{rail.freshnessLabel}</Text> : null}
      </View>
      <ScreenLead eyebrow="NOW" title={posture} detail={why} badge={disconnected ? "SETUP REQUIRED" : snapshot?.readyForPaperOperations ? "PAPER ACTIVE" : "OBSERVING"} badgeTone={disconnected ? "warning" : snapshot?.readyForPaperOperations ? "success" : "info"} testID="home-now" />
      {disconnected || readOnlyError ? <Pressable accessibilityRole="button" onPress={onGoSettings} testID="home-operational-notice"><StateNotice title={disconnected ? "PAPER 연결 필요" : "PAPER 연결 오류"} detail={`${disconnected ? "Cloud endpoint와 세션을 검증해야 합니다." : readOnlyError ?? "읽기 상태를 확인할 수 없습니다."} · 설정 열기`} tone="warning" /></Pressable> : null}
      <MetricStrip testID="account-hero-card" items={[{ label: "EQUITY", value: krw(account?.equity) }, { label: "TOTAL PNL", value: signedMoney(totalPnl), tone: totalPnl == null ? "neutral" : totalPnl >= 0 ? "success" : "danger" }, { label: "CASH", value: krw(account?.cash) }, { label: "EXPOSURE", value: krw(exposure) }]} />
      <View style={[styles.twoColumn, tablet ? styles.twoColumnTablet : null]}>
        <IntelligenceSection title="판단 근거" kicker="WHY · AI INSIGHT" tone="primary" testID="ai-card" style={tablet ? styles.half : undefined} actionLabel={aiInsightAvailable ? "근거 보기" : undefined} onAction={aiInsightAvailable ? () => onNavigate("AiSignal") : undefined}>
          <Text style={[styles.primaryCopy, { color: theme.colors.text }]}>{why}</Text><FactRow label="NOW" value={decisionSurface.now} /><FactRow label="RESULT" value={decisionSurface.result} /><FactRow label="AI AUTHORITY" value="ZERO AUTHORITY" tone="info" />
        </IntelligenceSection>
        <IntelligenceSection title="리스크 게이트" kicker="RISK STATUS" tone={riskTone} testID="home-risk-status" style={tablet ? styles.half : undefined}>
          <Text style={[styles.primaryCopy, { color: theme.colors.text }]}>{decisionSurface.risk}</Text><FactRow label="RISK" value={rail.riskLabel} tone={riskTone} /><FactRow label="PAPER MODE" value={snapshot?.mode ?? (localPaperActive ? "LOCAL PAPER" : "UNAVAILABLE")} /><FactRow label="LIVE AUTHORITY" value="NONE" tone="success" />
        </IntelligenceSection>
      </View>
      <IntelligenceSection title="검증된 관찰" kicker="SIGNAL TERRAIN" tone="info" testID="home-decision-stage" actionLabel="시장 보기" onAction={() => onNavigate("Markets")}>
        {marketRows.length === 0 ? <StateNotice title="NO QUALIFIED SIGNAL" detail="검증된 공개 시장 관찰 데이터가 아직 없습니다. 신호를 임의 생성하지 않습니다." tone="info" /> : marketRows.map((market) => <FactRow key={market.market} label={market.market} value={signedPercentFromRate(market.changeRate)} note={market.price == null ? "가격 UNAVAILABLE" : krw(market.price)} tone={(market.changeRate ?? 0) > 0 ? "success" : (market.changeRate ?? 0) < 0 ? "danger" : "neutral"} />)}
        <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PUBLIC READ ONLY · 시장 관찰은 전략 신호나 주문 권한으로 자동 승격되지 않습니다.</Text>
      </IntelligenceSection>
      <IntelligenceSection title="PAPER 운용 결과" kicker="PAPER PERFORMANCE" tone="success" testID="home-paper-performance" actionLabel="포트폴리오" onAction={() => onNavigate("Portfolio")}>
        <FactRow label="POSITION" value={hasPosition ? `${position?.market ?? "PAPER"} · ${position?.quantity ?? "—"}` : account ? "NO EXPOSURE" : "UNAVAILABLE"} /><FactRow label="OPEN ORDERS" value={openOrders == null ? "—" : String(openOrders)} /><FactRow label="INVESTABLE CASH" value={krw(cashEnvelope?.investableCash)} /><FactRow label="RESERVED CASH" value={krw(cashEnvelope?.reservedCash)} tone="success" /><Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>{accountSource ? `${accountSource} PAPER source` : "PAPER source unavailable"} · REAL_READ_ONLY 자산과 합산하지 않습니다.</Text>
      </IntelligenceSection>
      <IntelligenceSection title="다음 학습 상태" kicker="LEARNING" tone="primary" testID="home-paper-learning" actionLabel="근거 보기" onAction={disconnected ? undefined : onOpenPaperLearning}>
        <Text style={[styles.primaryCopy, { color: theme.colors.text }]}>{decisionSurface.learning}</Text><FactRow label="LEARNING" value={decisionSurface.learning} testID="home-supervisor-learning" /><FactRow label="RESULT BASIS" value={decisionSurface.result} />
      </IntelligenceSection>
      <View style={[styles.safetyFooter, { borderTopColor: theme.colors.border }]}><Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({ shell: { flex: 1 }, content: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 120, gap: 16 }, statusRail: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingHorizontal: 2 }, statusText: { fontSize: 10, lineHeight: 15, fontWeight: "700" }, statusTextStrong: { fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 0.5 }, twoColumn: { gap: 16 }, twoColumnTablet: { flexDirection: "row", alignItems: "stretch" }, half: { flex: 1 }, primaryCopy: { fontSize: 15, lineHeight: 23, fontWeight: "700" }, disclaimer: { fontSize: 10, lineHeight: 16 }, safetyFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, alignItems: "center" }, safetyText: { fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.15 } });
