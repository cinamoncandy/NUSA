import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";
import type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyConnectionStatus } from "./upbitReadOnlyAccount";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { AuthorityRail, FactRow, IntelligenceSection, MetricStrip, StateNotice } from "./intelligenceOs";

export type { PortfolioAccountResponse } from "./portfolioViewModel";
export interface PortfolioViewProps {
  readonly snapshot: PortfolioAccountResponse | null;
  readonly investmentPercent: number;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly upbitSnapshot?: UpbitReadOnlyAccountSnapshot | null;
  readonly upbitStatus?: UpbitReadOnlyConnectionStatus;
  readonly upbitError?: string | null;
  readonly onOpenPaperLearning?: () => void;
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}
function signedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${money(Math.abs(value))}`;
}
function buildModel(snapshot: PortfolioAccountResponse | null): PortfolioViewModel | null {
  if (snapshot == null) return null;
  try { return buildPortfolioViewModel(snapshot); } catch { return null; }
}

function PortfolioHero({ model, usingLocalPaper }: Readonly<{ model: PortfolioViewModel | null; usingLocalPaper: boolean }>) {
  const { theme } = useTheme();
  const total = model?.totalEquity ?? null;
  const cashShare = model != null && total != null && total > 0 ? Math.max(0, Math.min(100, (model.cash / total) * 100)) : 0;
  const exposureShare = model != null && total != null && total > 0 ? Math.max(0, Math.min(100, (model.assetValue / total) * 100)) : 0;

  return <View style={[styles.portfolioHero, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.borderStrong }]} testID="portfolio-master-hero">
    <View style={styles.portfolioHeroTop}>
      <View>
        <Text style={[styles.portfolioHeroEyebrow, { color: theme.colors.primary }]}>PAPER PORTFOLIO</Text>
        <Text style={[styles.portfolioHeroMeta, { color: theme.colors.textMuted }]}>{model == null ? "PAPER DATA UNAVAILABLE" : `${usingLocalPaper ? "LOCAL PAPER" : "CLOUD PAPER"} · VERIFIED ACCOUNTING`}</Text>
      </View>
      <Text style={[styles.portfolioHeroSource, { color: theme.colors.textMuted }]}>LIVE NONE</Text>
    </View>
    <View style={styles.portfolioHeroNumbers}>
      <View style={styles.portfolioHeroPrimary}>
        <Text style={[styles.portfolioHeroValue, { color: theme.colors.text }]}>{money(model?.totalEquity)}</Text>
        <Text style={[styles.portfolioHeroLabel, { color: theme.colors.textMuted }]}>TOTAL EQUITY</Text>
      </View>
      <View style={styles.portfolioHeroSecondary}>
        <Text style={[styles.portfolioHeroSecondaryValue, { color: model == null ? theme.colors.textMuted : model.totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model?.totalPnl)}</Text>
        <Text style={[styles.portfolioHeroLabel, { color: theme.colors.textMuted }]}>TOTAL P&L</Text>
      </View>
    </View>
    <View style={styles.allocationField} testID="portfolio-allocation-field">
      <View style={[styles.allocationGlow, styles.allocationGlowPurple, { backgroundColor: theme.colors.neonPurple }]} />
      <View style={[styles.allocationGlow, styles.allocationGlowBlue, { backgroundColor: theme.colors.neonBlue }]} />
      <View style={[styles.allocationGlow, styles.allocationGlowTeal, { backgroundColor: theme.colors.neonTeal }]} />
      <View style={styles.allocationFigure}>
        <Text style={[styles.allocationPercent, { color: theme.colors.text }]}>{model == null ? "—" : `${Math.round(exposureShare)}%`}</Text>
        <Text style={[styles.allocationFigureLabel, { color: theme.colors.textMuted }]}>MARKET EXPOSURE</Text>
      </View>
      <View style={styles.allocationFigureSecondary}>
        <Text style={[styles.allocationPercentSecondary, { color: theme.colors.aiSignalEnd }]}>{model == null ? "—" : `${Math.round(cashShare)}%`}</Text>
        <Text style={[styles.allocationFigureLabel, { color: theme.colors.textMuted }]}>CASH</Text>
      </View>
    </View>
    <View style={[styles.composition, { borderTopColor: theme.colors.border }]} testID="portfolio-composition">
      <View style={styles.compositionHead}>
        <Text style={[styles.compositionTitle, { color: theme.colors.text }]}>ALLOCATION</Text>
        <Text style={[styles.compositionMeta, { color: theme.colors.textMuted }]}>CURRENT VERIFIED SNAPSHOT</Text>
      </View>
      <View style={[styles.compositionRail, { backgroundColor: theme.colors.surfaceRaised }]}>
        <View style={[styles.compositionCash, { width: `${cashShare}%` as `${number}%`, backgroundColor: theme.colors.primary }]} />
        <View style={[styles.compositionExposure, { width: `${exposureShare}%` as `${number}%`, backgroundColor: theme.colors.info }]} />
      </View>
      <View style={styles.compositionLegend}>
        <Text style={[styles.compositionLegendText, { color: theme.colors.textMuted }]}>CASH {money(model?.cash)}</Text>
        <Text style={[styles.compositionLegendText, { color: theme.colors.textMuted }]}>EXPOSURE {money(model?.assetValue)}</Text>
      </View>
      <Text style={[styles.historyUnavailable, { color: theme.colors.textMuted }]}>EQUITY HISTORY UNAVAILABLE IN CURRENT CANONICAL PROJECTION · NO SYNTHETIC CURVE</Text>
    </View>
  </View>;
}

export function PortfolioView({ snapshot, investmentPercent, error, refreshing, onRefresh, upbitSnapshot = null, upbitStatus = "DISCONNECTED", upbitError = null, onOpenPaperLearning }: PortfolioViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const localPaperActive = snapshot === null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const effectiveSnapshot = snapshot ?? localPortfolio;
  const usingLocalPaper = snapshot === null && localPortfolio !== null;
  const model = buildModel(effectiveSnapshot);
  const allocation = model == null ? null : createCashInvestmentEnvelope(model.cash, investmentPercent);
  const position = model?.position ?? null;
  const upbitConnected = upbitStatus === "READY" && upbitSnapshot != null && upbitError == null;

  return <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={[styles.content, { maxWidth: tablet ? 980 : 720 }]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false} testID="portfolio-screen">
    <AuthorityRail detail="PAPER CAPITAL · REAL ACCOUNT SEPARATE · LIVE NONE" status={model ? (usingLocalPaper ? "LOCAL PAPER" : "PAPER READY") : error ? "DEGRADED" : "UNAVAILABLE"} tone={model ? "success" : "warning"} testID="portfolio-authority-rail" />
    <View style={[styles.commandHero, { borderColor: theme.colors.border }]} testID="portfolio-command-hero">
      <View style={styles.commandHeader}>
        <View style={styles.commandTitleWrap}>
          <Text style={[styles.commandEyebrow, { color: theme.colors.primary }]}>PAPER CAPITAL · VERIFIED ACCOUNTING</Text>
          <Text style={[styles.commandTitle, { color: theme.colors.text }]}>EQUITY / P&L</Text>
          <Text style={[styles.commandDetail, { color: theme.colors.textMuted }]}>PAPER 자본과 노출을 먼저 보고 REAL_READ_ONLY 기준선은 별도로 확인합니다.</Text>
        </View>
        <View style={[styles.commandBadge, { borderColor: model ? theme.colors.primary : theme.colors.warning }]}>
          <View style={[styles.commandDot, { backgroundColor: model ? theme.colors.primary : theme.colors.warning }]} />
          <Text style={[styles.commandBadgeText, { color: model ? theme.colors.primary : theme.colors.warning }]}>{model ? (usingLocalPaper ? "LOCAL PAPER" : "PAPER READY") : error ? "DEGRADED" : "UNAVAILABLE"}</Text>
        </View>
      </View>
      <PortfolioHero model={model} usingLocalPaper={usingLocalPaper} />
      <MetricStrip testID="portfolio-supervisor-summary" items={[{ label: "PAPER EQUITY", value: money(model?.totalEquity) }, { label: "TOTAL PNL", value: signedMoney(model?.totalPnl), tone: model == null ? "neutral" : model.totalPnl >= 0 ? "success" : "danger" }, { label: "CASH", value: money(model?.cash) }, { label: "EXPOSURE", value: money(model?.assetValue) }]} />
      <View style={[styles.truthRail, { borderTopColor: theme.colors.border }]}>
        <Text style={[styles.truthText, { color: theme.colors.textMuted }]}>PAPER RESULT = CANONICAL</Text>
        <Text style={[styles.truthText, { color: theme.colors.textMuted }]}>REAL_READ_ONLY = REFERENCE ONLY</Text>
      </View>
    </View>
    {error ? <StateNotice title="PAPER PORTFOLIO DEGRADED" detail={error} tone="danger" /> : null}
    {!model ? <StateNotice title="PAPER DATA UNAVAILABLE" detail="PAPER 서버에 연결하거나 LOCAL PAPER 결과가 생성되면 자산과 손익을 표시합니다. UNKNOWN 값을 0으로 표시하지 않습니다." tone="warning" /> : null}
    <View style={tablet ? styles.columns : styles.stack}>
    {model && allocation ? <IntelligenceSection style={tablet ? styles.column : undefined} title="자본 배분" kicker="CAPITAL" tone="primary" testID="portfolio-allocation-rail">
      <FactRow label="INVESTMENT LIMIT" value={`${allocation.investmentPercent}%`} /><FactRow label="INVESTABLE CASH" value={money(allocation.investableCash)} testID="portfolio-investable-cash" /><FactRow label="PROTECTED CASH" value={money(allocation.reservedCash)} tone="success" testID="portfolio-reserved-cash" />
      <View style={[styles.allocationRail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.allocationFill, { backgroundColor: theme.colors.primary, width: `${allocation.investmentPercent}%` as `${number}%` }]} /></View><Text style={[styles.note, { color: theme.colors.textMuted }]}>보호 현금은 신규 PAPER 매수 한도에서 제외됩니다.</Text>
    </IntelligenceSection> : null}
    <IntelligenceSection style={tablet ? styles.column : undefined} title="현재 노출" kicker="PAPER EXPOSURE" tone={position ? "info" : "neutral"} testID={position ? "portfolio-position" : "portfolio-empty"}>
      {position ? <><FactRow label="MARKET" value={position.market} /><FactRow label="QUANTITY" value={String(position.quantity)} /><FactRow label="AVERAGE PRICE" value={money(position.averagePrice)} /><FactRow label="CURRENT PRICE" value={money(position.currentPrice)} /><FactRow label="UNREALIZED PNL" value={signedMoney(position.unrealizedPnl)} tone={position.unrealizedPnl >= 0 ? "success" : "danger"} /><FactRow label="REALIZED PNL" value={signedMoney(position.realizedPnl)} tone={position.realizedPnl >= 0 ? "success" : "danger"} /></> : <StateNotice title="NO EXPOSURE" detail={model ? "현재 PAPER 시장 노출이 없습니다. 현금 대기 상태입니다." : "포지션 데이터를 확인할 수 없습니다."} tone="info" />}
    </IntelligenceSection>
    </View>
    <View style={tablet ? styles.columns : styles.stack}>
    <IntelligenceSection style={tablet ? styles.column : undefined} title="PAPER 회계" kicker="ACCOUNTING" tone="success" testID="portfolio-account-breakdown">
      <FactRow label="OPEN ORDERS" value={model == null ? "—" : String(model.openOrderCount)} /><FactRow label="MARKET EXPOSURE" value={money(model?.assetValue)} /><FactRow label="PAPER RESULT" value={signedMoney(model?.totalPnl)} tone={model == null ? "neutral" : model.totalPnl >= 0 ? "success" : "danger"} />
      {onOpenPaperLearning ? <NusaButton label="학습 / 평가 근거 보기" tone="neutral" onPress={onOpenPaperLearning} testID="portfolio-paper-learning" /> : null}
    </IntelligenceSection>
    <IntelligenceSection style={tablet ? styles.column : undefined} title="실계좌 기준선" kicker="REAL ACCOUNT · READ ONLY" tone="info" testID="portfolio-upbit-read-only">
      <FactRow label="CONNECTION" value={String(upbitStatus)} tone={upbitConnected ? "success" : upbitError ? "danger" : "neutral"} /><FactRow label="KRW AVAILABLE" value={money(upbitSnapshot?.cash.available)} /><FactRow label="KRW LOCKED" value={money(upbitSnapshot?.cash.locked)} /><FactRow label="ASSETS" value={upbitSnapshot ? String(upbitSnapshot.assets.length) : "—"} />
      {upbitError ? <StateNotice title="REAL_READ_ONLY DEGRADED" detail={upbitError} tone="warning" testID="portfolio-upbit-monitor-error" /> : null}
      <Text style={[styles.note, { color: theme.colors.textMuted }]}>REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다.</Text>
    </IntelligenceSection>
    </View>
    <Text style={[styles.footer, { color: theme.colors.textMuted }]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 96, gap: 18, width: "100%", alignSelf: "center" }, commandHero: { paddingTop: 12, paddingBottom: 16, gap: 14 }, commandHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }, commandTitleWrap: { flex: 1, minWidth: 0 }, commandEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.25 }, commandTitle: { marginTop: 3, fontSize: 18, lineHeight: 23, fontWeight: "900", letterSpacing: 0.8 }, commandDetail: { marginTop: 6, maxWidth: 680, fontSize: 10, lineHeight: 16 }, commandBadge: { minHeight: 32, maxWidth: 154, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 }, commandDot: { width: 6, height: 6, borderRadius: 6 }, commandBadgeText: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 0.45 }, truthRail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }, truthText: { fontSize: 7, lineHeight: 10, fontWeight: "800", letterSpacing: 0.7 }, portfolioHero: { borderWidth: 1, borderRadius: 24, overflow: "hidden" }, portfolioHeroTop: { minHeight: 62, paddingHorizontal: 18, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, portfolioHeroEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 1.15 }, portfolioHeroMeta: { marginTop: 3, fontSize: 9, lineHeight: 13, fontWeight: "700" }, portfolioHeroSource: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8 }, portfolioHeroNumbers: { flexDirection: "row", alignItems: "flex-end", gap: 18, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18 }, portfolioHeroPrimary: { flex: 1.6, minWidth: 0 }, portfolioHeroSecondary: { flex: 1, minWidth: 0 }, portfolioHeroValue: { fontSize: 38, lineHeight: 44, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] }, portfolioHeroSecondaryValue: { fontSize: 17, lineHeight: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }, portfolioHeroLabel: { marginTop: 4, fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.85 }, allocationField: { height: 210, position: "relative", overflow: "hidden", justifyContent: "center", paddingHorizontal: 22, backgroundColor: "#050710" },
  allocationGlow: { position: "absolute", width: 190, height: 190, borderRadius: 190, opacity: 0.12 },
  allocationGlowPurple: { left: -70, top: -48 },
  allocationGlowBlue: { left: "30%", top: 32, opacity: 0.09 },
  allocationGlowTeal: { right: -72, bottom: -52, opacity: 0.1 },
  allocationFigure: { alignSelf: "flex-start" },
  allocationFigureSecondary: { position: "absolute", right: 22, bottom: 30, alignItems: "flex-end" },
  allocationPercent: { fontSize: 54, lineHeight: 58, fontWeight: "700", letterSpacing: -2.2, fontVariant: ["tabular-nums"] },
  allocationPercentSecondary: { fontSize: 30, lineHeight: 34, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  allocationFigureLabel: { marginTop: 5, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.1 },
  composition: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 }, compositionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, compositionTitle: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8 }, compositionMeta: { fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.45 }, compositionRail: { height: 12, borderRadius: 999, overflow: "hidden", flexDirection: "row", marginTop: 12 }, compositionCash: { height: "100%" }, compositionExposure: { height: "100%" }, compositionLegend: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, compositionLegendText: { fontSize: 8, lineHeight: 12, fontWeight: "800" }, historyUnavailable: { marginTop: 8, fontSize: 7, lineHeight: 11, fontWeight: "700", letterSpacing: 0.35 }, columns: { flexDirection: "row", alignItems: "stretch", gap: 16 }, stack: { gap: 14 }, column: { flex: 1, minWidth: 0 }, allocationRail: { height: 8, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, note: { fontSize: 11, lineHeight: 17 }, footer: { textAlign: "center", fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.05, paddingTop: 4 } });
