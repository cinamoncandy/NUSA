import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";
import type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyConnectionStatus } from "./upbitReadOnlyAccount";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { AuthorityRail, FactRow, IntelligenceSection, MetricStrip, ScreenLead, StateNotice } from "./intelligenceOs";

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

  return <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={[styles.content, { maxWidth: tablet ? 1080 : 720 }]} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false} testID="portfolio-screen">
    <AuthorityRail detail="PAPER CAPITAL · REAL ACCOUNT SEPARATE · LIVE NONE" status={model ? (usingLocalPaper ? "LOCAL PAPER" : "PAPER READY") : error ? "DEGRADED" : "UNAVAILABLE"} tone={model ? "success" : "warning"} testID="portfolio-authority-rail" />
    <ScreenLead eyebrow="PORTFOLIO" title="PAPER 자산과 결과" detail="Equity와 누적 손익을 먼저 보고, 자본 배분·노출·회계 근거를 아래에서 확인합니다." badge="PORTFOLIO" badgeTone="primary" />
    {error ? <StateNotice title="PAPER PORTFOLIO DEGRADED" detail={error} tone="danger" /> : null}
    {!model ? <StateNotice title="PAPER DATA UNAVAILABLE" detail="PAPER 서버에 연결하거나 LOCAL PAPER 결과가 생성되면 자산과 손익을 표시합니다. UNKNOWN 값을 0으로 표시하지 않습니다." tone="warning" /> : null}
    <MetricStrip testID="portfolio-supervisor-summary" items={[{ label: "PAPER EQUITY", value: money(model?.totalEquity) }, { label: "TOTAL PNL", value: signedMoney(model?.totalPnl), tone: model == null ? "neutral" : model.totalPnl >= 0 ? "success" : "danger" }, { label: "CASH", value: money(model?.cash) }, { label: "EXPOSURE", value: money(model?.assetValue) }]} />
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

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 120, gap: 18, width: "100%", alignSelf: "center" }, columns: { flexDirection: "row", alignItems: "stretch", gap: 22 }, stack: { gap: 18 }, column: { flex: 1, minWidth: 0 }, allocationRail: { height: 8, borderRadius: 999, overflow: "hidden" }, allocationFill: { height: "100%", borderRadius: 999 }, note: { fontSize: 11, lineHeight: 17 }, footer: { textAlign: "center", fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.05, paddingTop: 4 } });
