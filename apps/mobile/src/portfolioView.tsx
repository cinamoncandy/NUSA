import React, { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";
import type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyConnectionStatus } from "./upbitReadOnlyAccount";
import { getLocalPaperState, subscribeLocalPaper, type LocalPaperState } from "./localPaperStore";

export type { PortfolioAccountResponse } from "./portfolioViewModel";
export interface PortfolioViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly investmentPercent: number; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly upbitSnapshot?: UpbitReadOnlyAccountSnapshot | null; readonly upbitStatus?: UpbitReadOnlyConnectionStatus; readonly upbitError?: string | null; }

function money(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function signedMoney(value: number): string { return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`; }
function pnlTone(value: number): "success" | "danger" { return value >= 0 ? "success" : "danger"; }

function UpbitReadOnlySection({ upbitSnapshot: snapshot, upbitStatus: status = "DISCONNECTED", upbitError: error = null }: Readonly<Pick<PortfolioViewProps, "upbitSnapshot" | "upbitStatus" | "upbitError">>) {
  const { theme } = useTheme();
  const state = status === "LOADING" ? "불러오는 중" : status === "READY" ? "연결됨" : status === "STALE" ? "오래된 데이터" : status === "ERROR" ? "조회 실패" : "연결 필요";
  const tone = status === "READY" ? "success" : status === "ERROR" ? "danger" : "info";
  return <NusaCard testID="portfolio-upbit-read-only"><View style={styles.row}><View><Text style={[styles.eyebrow, { color: theme.colors.info }]}>UPBIT · READ ONLY</Text><Text style={[styles.title, { color: theme.colors.text }]}>실거래소 계정 잔고</Text></View><StatusChip label={state} tone={tone} /></View>
    {status === "LOADING" ? <View style={styles.inline}><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.meta, { color: theme.colors.textMuted }]}>조회 중</Text></View>
      : status === "ERROR" ? <Text style={[styles.meta, { color: theme.colors.danger }]}>{error ?? "Upbit 잔고를 표시할 수 없습니다."}</Text>
      : snapshot ? <><DataRow label="KRW 사용 가능" value={money(snapshot.cash.available)} /><DataRow label="KRW 잠금" value={money(snapshot.cash.locked)} />{snapshot.assets.map((asset) => <View key={asset.currency} style={styles.row} testID={`portfolio-upbit-asset-${asset.currency}`}><Text style={[styles.meta, { color: theme.colors.text }]}>{asset.currency}</Text><Text style={[styles.meta, styles.positionValue, { color: theme.colors.textMuted }]}>{asset.available} · 잠금 {asset.locked}</Text></View>)}<Text style={[styles.meta, { color: theme.colors.textMuted }]}>실제 잔고와 PAPER는 합산하지 않습니다.</Text></>
      : <Text style={[styles.meta, { color: theme.colors.textMuted }]}>설정에서 Upbit 읽기 전용 연결을 확인하면 실제 계정 잔고를 표시합니다.</Text>}
  </NusaCard>;
}

function PositionCard({ model }: Readonly<{ model: PortfolioViewModel }>) {
  const { theme } = useTheme();
  if (!model.position) return <NusaCard testID="portfolio-empty"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>POSITION</Text><Text style={[styles.title, { color: theme.colors.text }]}>열린 포지션 없음</Text><Text style={[styles.meta, { color: theme.colors.textMuted }]}>현재 PAPER 계좌는 현금 상태입니다.</Text></NusaCard>;
  return <NusaCard testID="portfolio-position"><View style={styles.row}><View><Text style={[styles.eyebrow, { color: theme.colors.primary }]}>OPEN POSITION</Text><Text style={[styles.market, { color: theme.colors.text }]}>{model.position.market}</Text></View><StatusChip label="PAPER" tone="primary" /></View><DataRow label="수량" value={String(model.position.quantity)} /><DataRow label="평가가" value={money(model.position.currentPrice)} /><DataRow label="평균 단가" value={money(model.position.averagePrice)} /><DataRow label="미실현 손익" value={signedMoney(model.position.unrealizedPnl)} emphasis tone={pnlTone(model.position.unrealizedPnl)} /><DataRow label="실현 손익" value={signedMoney(model.position.realizedPnl)} tone={pnlTone(model.position.realizedPnl)} /></NusaCard>;
}

export function PortfolioView({ snapshot, investmentPercent, error, refreshing, onRefresh, upbitSnapshot = null, upbitStatus = "DISCONNECTED", upbitError = null }: PortfolioViewProps) {
  const { theme } = useTheme();
  const [localState, setLocalState] = useState<LocalPaperState>(() => getLocalPaperState());
  useEffect(() => subscribeLocalPaper(setLocalState), []);
  const usingLocalPaper = snapshot === null && error === null;
  const effectiveSnapshot = usingLocalPaper ? localState.portfolio : snapshot;

  if (effectiveSnapshot === null) {
    return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen"><UpbitReadOnlySection upbitSnapshot={upbitSnapshot} upbitStatus={upbitStatus} upbitError={upbitError} /><InlineNotice title="PAPER 자산을 표시할 수 없습니다" detail={error ?? "PAPER 상태를 불러올 수 없습니다."} tone="danger" /><NusaButton label="PAPER 다시 불러오기" onPress={onRefresh} /></ScrollView>;
  }

  let model: PortfolioViewModel;
  try { model = buildPortfolioViewModel(effectiveSnapshot); }
  catch (validationError) {
    return <View style={styles.state} testID="portfolio-error"><InlineNotice title="자산 정보를 표시할 수 없습니다" detail={validationError instanceof Error ? validationError.message : "Portfolio data is invalid."} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRefresh} /></View>;
  }

  const allocation = createCashInvestmentEnvelope(model.cash, investmentPercent);
  const allocationWidth = `${allocation.investmentPercent}%` as `${number}%`;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={usingLocalPaper ? () => undefined : onRefresh} />} testID="portfolio-screen">
    <ScreenHeader eyebrow="MY ISLAND" title="자산" description="총자산, 손익과 현재 포지션을 한눈에 확인합니다." statusLabel={usingLocalPaper ? "LOCAL PAPER" : "PAPER"} statusTone="primary" />
    <UpbitReadOnlySection upbitSnapshot={upbitSnapshot} upbitStatus={upbitStatus} upbitError={upbitError} />
    {usingLocalPaper ? <InlineNotice title="LOCAL PAPER 자산" detail="TRADE와 같은 가상 원장을 표시합니다. 실제 Upbit 잔고와 합산하지 않습니다." tone="success" testID="portfolio-local-paper-source" /> : error ? <InlineNotice title="Cloud PAPER 상태 확인 필요" detail={error} tone="warning" /> : null}

    <View style={styles.hero} testID="portfolio-summary"><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>총 평가자산</Text><Text style={[styles.heroValue, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{money(model.totalEquity)}</Text><Text style={[styles.heroPnl, { color: model.totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.totalPnl)} 누적 손익</Text></View>
    <View style={styles.metrics}><MetricTile label="실현 손익" value={signedMoney(model.realizedPnl)} detail="확정 손익" tone={pnlTone(model.realizedPnl)} testID="portfolio-realized-pnl" /><MetricTile label="미실현 손익" value={signedMoney(model.unrealizedPnl)} detail="평가 손익" tone={pnlTone(model.unrealizedPnl)} testID="portfolio-unrealized-pnl" /><MetricTile label="포지션 평가액" value={money(model.assetValue)} detail={`${model.openOrderCount}개 열린 주문`} tone="default" /></View>

    <View style={[styles.panel, { borderColor: theme.colors.border }]} testID="portfolio-allocation-rail"><View style={styles.row}><View><Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>현금</Text><Text style={[styles.allocationValue, { color: theme.colors.text }]}>{money(model.cash)}</Text></View><Text style={[styles.splitValue, { color: theme.colors.primary }]}>{allocation.investmentPercent}% 투자 가능</Text></View><View style={[styles.rail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><DataRow label="주문 가능" value={money(allocation.investableCash)} emphasis testID="portfolio-investable-cash" /><DataRow label="보호 현금" value={money(allocation.reservedCash)} tone="success" testID="portfolio-reserved-cash" /></View>

    <View style={styles.details}><View style={styles.detail}><PositionCard model={model} /></View><View style={styles.detail}><NusaCard testID="portfolio-account-breakdown"><Text style={[styles.title, { color: theme.colors.text }]}>계정 전체 집계</Text><DataRow label="전체 현금" value={money(model.cash)} /><DataRow label="포지션 평가액" value={money(model.assetValue)} /><DataRow label="열린 주문" value={String(model.openOrderCount)} /></NusaCard></View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44, gap: 20, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 12 }, hero: { gap: 5, paddingVertical: 6 }, heroValue: { fontSize: 42, lineHeight: 49, fontWeight: "800", letterSpacing: -1.8, fontVariant: ["tabular-nums"] }, heroPnl: { fontSize: 15, lineHeight: 21, fontWeight: "700", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, inline: { flexDirection: "row", alignItems: "center", gap: 8 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, details: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, detail: { flexGrow: 1, flexBasis: 420 }, panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 10 }, rail: { height: 7, borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.1 }, title: { fontSize: 16, lineHeight: 22, fontWeight: "800" }, market: { fontSize: 24, lineHeight: 30, fontWeight: "800" }, allocationValue: { marginTop: 4, fontSize: 23, lineHeight: 29, fontWeight: "800", fontVariant: ["tabular-nums"] }, splitValue: { fontSize: 16, lineHeight: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }, positionValue: { fontVariant: ["tabular-nums"] }, meta: { fontSize: 12, lineHeight: 18 },
});