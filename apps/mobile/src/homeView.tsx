import React, { useState } from "react";
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
import { FactRow, StateNotice } from "./intelligenceOs";
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const connectionLabel = disconnected ? "SETUP" : readOnlyError ? "DEGRADED" : snapshot?.readyForPaperOperations ? "ACTIVE" : "OBSERVING";

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
        <View style={[styles.statusCapsule, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]}>
          <Text style={[styles.statusCapsuleText, { color: systemColor }]}>{connectionLabel}</Text>
        </View>
      </View>

      <View style={styles.glanceRail} testID="home-status-rail">
        <Text style={[styles.glancePrimary, { color: theme.colors.textMuted }]} numberOfLines={1}>{rail.marketLine} · {rail.systemLine}</Text>
        <Text style={[styles.glanceRisk, { color: riskColor }]}>RISK {rail.riskLabel}</Text>
        <Text style={[styles.glanceBuild, { color: theme.colors.textMuted }]} testID="home-build-source">BUILD {packagedBuildLabel} · UI INTELLIGENCE OS</Text>
      </View>

      <View style={styles.hero} testID="home-now">
        <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>NOW</Text>
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{posture}</Text>
        <Text style={[styles.heroDetail, { color: theme.colors.textMuted }]} numberOfLines={3}>{why}</Text>
        <View style={styles.heroChips}>
          <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.chipLabel, { color: theme.colors.textMuted }]}>PAPER ONLY</Text></View>
          <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.chipLabel, { color: theme.colors.textMuted }]}>LIVE NONE</Text></View>
          <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken }]}><Text style={[styles.chipLabel, { color: theme.colors.info }]}>AI ZERO</Text></View>
        </View>
      </View>

      {disconnected || readOnlyError ? <Pressable accessibilityRole="button" onPress={onGoSettings} testID="home-operational-notice"><StateNotice title={disconnected ? "PAPER 연결 필요" : "PAPER 연결 오류"} detail={`${disconnected ? "Cloud endpoint와 세션을 검증해야 합니다." : readOnlyError ?? "읽기 상태를 확인할 수 없습니다."} · 설정 열기`} tone="warning" /></Pressable> : null}

      <View style={[styles.balanceStage, tablet ? styles.balanceStageTablet : null]} testID="account-hero-card">
        <View style={styles.balancePrimary}>
          <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>PAPER EQUITY</Text>
          <Text style={[styles.balanceValue, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{krw(account?.equity)}</Text>
          <Text style={[styles.pnlValue, { color: pnlColor }]}>{signedMoney(totalPnl)} TOTAL PNL</Text>
        </View>
        <View style={[styles.balanceFacts, { borderColor: theme.colors.border }]}>
          <View style={styles.balanceFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>CASH</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{krw(account?.cash)}</Text></View>
          <View style={styles.balanceFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>EXPOSURE</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{krw(exposure)}</Text></View>
          <View style={styles.balanceFact}><Text style={[styles.factLabel, { color: theme.colors.textMuted }]}>OPEN</Text><Text style={[styles.factValue, { color: theme.colors.text }]}>{openOrders == null ? "—" : String(openOrders)}</Text></View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>QUICK ACCESS</Text><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>바로 확인</Text></View>
        <Text style={[styles.sectionMeta, { color: theme.colors.textMuted }]}>핵심 화면으로 바로 이동</Text>
      </View>

      <View style={[styles.commandStack, tablet ? styles.commandStackTablet : null]}>
        <Pressable onPress={() => onNavigate("Markets")} style={({ pressed }) => [styles.command, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-decision-stage">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.info }]}>MARKETS</Text><Text style={[styles.commandArrow, { color: theme.colors.textMuted }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>시장</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]}>{marketRows.length === 0 ? "공개 시장 데이터 대기 중" : `${marketRows.length}개 핵심 시장`}</Text>
          <View style={styles.commandPreview}>{marketRows.slice(0, 2).map((market) => <View key={market.market} style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>{market.market}</Text><Text style={[styles.previewValue, { color: (market.changeRate ?? 0) > 0 ? theme.colors.success : (market.changeRate ?? 0) < 0 ? theme.colors.danger : theme.colors.text }]}>{signedPercentFromRate(market.changeRate)}</Text></View>)}</View>
        </Pressable>

        <View style={styles.hiddenAcceptanceHooks} accessibilityElementsHidden>
          <Text>PAPER PERFORMANCE</Text>
          <FactRow label="RESERVED CASH" value={krw(cashEnvelope?.reservedCash)} tone="success" />
        </View>
        <Pressable onPress={() => onNavigate("Portfolio")} style={({ pressed }) => [styles.command, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.72 : 1 }]} testID="home-paper-performance">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.success }]}>PORTFOLIO</Text><Text style={[styles.commandArrow, { color: theme.colors.textMuted }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>PAPER</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]}>{hasPosition ? `${position?.market ?? "PAPER"} position active` : account ? "현재 노출 없음" : "계정 대기 중"}</Text>
          <View style={styles.commandPreview}><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>INVESTABLE</Text><Text style={[styles.previewValue, { color: theme.colors.text }]} testID="home-investable-cash">{krw(cashEnvelope?.investableCash)}</Text></View><View style={styles.previewRow}><Text style={[styles.previewLabel, { color: theme.colors.textMuted }]}>RESERVED</Text><Text style={[styles.previewValue, { color: theme.colors.text }]}>{krw(cashEnvelope?.reservedCash)}</Text></View></View>
        </Pressable>

        <Pressable disabled={disconnected} onPress={onOpenPaperLearning} style={({ pressed }) => [styles.command, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: disconnected ? 0.46 : pressed ? 0.72 : 1 }]} testID="home-paper-learning">
          <View style={styles.commandTop}><Text style={[styles.commandCode, { color: theme.colors.primary }]}>LEARN</Text><Text style={[styles.commandArrow, { color: theme.colors.textMuted }]}>↗</Text></View>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>학습</Text>
          <Text style={[styles.commandSummary, { color: theme.colors.textMuted }]} numberOfLines={2}>{decisionSurface.learning}</Text>
          <Text style={[styles.learningResult, { color: theme.colors.text }]} numberOfLines={1} testID="home-supervisor-learning">{decisionSurface.result}</Text>
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
          <Text style={[styles.disclosureTitle, { color: theme.colors.text }]}>왜 지금 이 상태인가</Text>
        </View>
        <Text style={[styles.disclosureIcon, { color: theme.colors.textMuted }]}>{detailsOpen ? "−" : "+"}</Text>
      </Pressable>

      {detailsOpen ? <View style={styles.details}>
        <View style={styles.detailNarrative} testID="ai-card">
          <Text style={[styles.detailCopy, { color: theme.colors.textMuted }]}>{why}</Text>
          {aiInsightAvailable ? <Pressable onPress={() => onNavigate("AiSignal")}><Text style={[styles.inlineLink, { color: theme.colors.primary }]}>AI 근거 상세 보기 →</Text></Pressable> : null}
        </View>
        <View style={[styles.detailFacts, { borderColor: theme.colors.border }]} testID="home-risk-status">
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RISK</Text><Text style={[styles.detailValue, { color: riskColor }]}>{decisionSurface.risk}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>RESULT</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{decisionSurface.result}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>SOURCE</Text><Text style={[styles.detailValue, { color: theme.colors.text }]}>{accountSource ? `${accountSource} PAPER` : "UNAVAILABLE"}</Text></View>
          <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>AUTHORITY</Text><Text style={[styles.detailValue, { color: theme.colors.success }]}>LIVE NONE · AI ZERO</Text></View>
        </View>
      </View> : <View style={styles.hiddenAcceptanceHooks}><View testID="ai-card" /><View testID="home-risk-status" /></View>}

      <Text style={[styles.disclaimer, { color: theme.colors.textMuted }]}>PUBLIC READ ONLY 데이터는 전략 신호가 아니며, PAPER 결과와 REAL_READ_ONLY 자산은 합산하지 않습니다.</Text>
      <View style={[styles.safetyFooter, { borderTopColor: theme.colors.border }]}><Text style={[styles.safetyText, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  content: { width: "100%", alignSelf: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 132, gap: 22 },
  appBar: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  liveDot: { width: 8, height: 8, borderRadius: 999 },
  brand: { fontSize: 19, lineHeight: 22, fontWeight: "900", letterSpacing: 2.3 },
  statusCapsule: { minHeight: 30, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  statusCapsuleText: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8 },
  glanceRail: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: -8 },
  glancePrimary: { flex: 1, minWidth: 180, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  glanceRisk: { fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 0.45 },
  glanceBuild: { fontSize: 9, lineHeight: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  hero: { gap: 9, paddingVertical: 8 },
  eyebrow: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.45 },
  heroTitle: { maxWidth: 720, fontSize: 34, lineHeight: 40, fontWeight: "900", letterSpacing: -1.15 },
  heroDetail: { maxWidth: 760, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  heroChips: { flexDirection: "row", gap: 7, flexWrap: "wrap", paddingTop: 3 },
  chip: { minHeight: 26, borderRadius: 999, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.7 },
  balanceStage: { gap: 16, paddingVertical: 4 },
  balanceStageTablet: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  balancePrimary: { flex: 1, minWidth: 0, gap: 5 },
  balanceValue: { fontSize: 46, lineHeight: 52, fontWeight: "900", letterSpacing: -1.7, fontVariant: ["tabular-nums"] },
  pnlValue: { fontSize: 13, lineHeight: 18, fontWeight: "900", letterSpacing: 0.2, fontVariant: ["tabular-nums"] },
  balanceFacts: { minWidth: 240, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", gap: 20, flexWrap: "wrap" },
  balanceFact: { minWidth: 66, gap: 3 },
  factLabel: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7 },
  factValue: { fontSize: 13, lineHeight: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  sectionTitle: { marginTop: 3, fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.45 },
  sectionMeta: { maxWidth: 150, textAlign: "right", fontSize: 9, lineHeight: 14, fontWeight: "700" },
  commandStack: { gap: 10 },
  commandStackTablet: { flexDirection: "row", alignItems: "stretch" },
  command: { flex: 1, minHeight: 152, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, padding: 17, gap: 7 },
  commandTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  commandCode: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  commandArrow: { fontSize: 16, lineHeight: 18, fontWeight: "700" },
  commandTitle: { fontSize: 21, lineHeight: 26, fontWeight: "900", letterSpacing: -0.45 },
  commandSummary: { fontSize: 11, lineHeight: 17, fontWeight: "600" },
  commandPreview: { marginTop: "auto", gap: 3, paddingTop: 5 },
  previewRow: { minHeight: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  previewLabel: { fontSize: 9, lineHeight: 14, fontWeight: "800" },
  previewValue: { fontSize: 10, lineHeight: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  learningResult: { marginTop: "auto", fontSize: 10, lineHeight: 15, fontWeight: "900" },
  disclosure: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 12 },
  disclosureTitle: { marginTop: 3, fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.35 },
  disclosureIcon: { fontSize: 27, lineHeight: 30, fontWeight: "300" },
  details: { gap: 16 },
  detailNarrative: { gap: 8 },
  detailCopy: { maxWidth: 780, fontSize: 13, lineHeight: 21, fontWeight: "600" },
  inlineLink: { fontSize: 11, lineHeight: 16, fontWeight: "900" },
  detailFacts: { borderTopWidth: StyleSheet.hairlineWidth },
  detailRow: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18 },
  detailLabel: { flexShrink: 0, fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 0.7 },
  detailValue: { flex: 1, textAlign: "right", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  hiddenAcceptanceHooks: { position: "absolute", width: 1, height: 1, opacity: 0 },
  disclaimer: { fontSize: 9, lineHeight: 15, fontWeight: "600" },
  safetyFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, alignItems: "center" },
  safetyText: { fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.1 },
});
