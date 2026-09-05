import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { formatKRW, formatSignedMoney } from "./numberFormat";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";
import { useUpbitReadOnlyState, type UpbitReadOnlyAccountSnapshot, type UpbitReadOnlyConnectionStatus, type UpbitReadOnlyMonitorStatus } from "./upbitReadOnlyAccount";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";

export type { PortfolioAccountResponse } from "./portfolioViewModel";
function pnlTone(value: number): "success" | "danger" { return value >= 0 ? "success" : "danger"; }
function ErrorState({ theme, message, onRetry }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"]; message: string; onRetry: () => void }>) { return <View style={styles.state} testID="portfolio-error"><View style={styles.stateInner}><InlineNotice title="운용 결과를 표시할 수 없습니다" detail={message} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRetry} /></View></View>; }
export interface PortfolioViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly investmentPercent: number; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; readonly upbitSnapshot?: UpbitReadOnlyAccountSnapshot | null; readonly upbitStatus?: UpbitReadOnlyConnectionStatus; readonly upbitError?: string | null; readonly onOpenPaperLearning?: () => void; }

function monitorTone(status: UpbitReadOnlyMonitorStatus): "success" | "warning" | "danger" | "info" {
  return status === "CONNECTED" ? "success" : status === "AUTH_ERROR" || status === "RELAY_ERROR" ? "danger" : status === "STALE" ? "warning" : "info";
}

function UpbitReadOnlySection({ upbitSnapshot: snapshotProp, upbitStatus: statusProp = "DISCONNECTED", upbitError: errorProp = null }: Readonly<Pick<PortfolioViewProps, "upbitSnapshot" | "upbitStatus" | "upbitError">>) {
  const { theme } = useTheme();
  const live = useUpbitReadOnlyState();
  const snapshot = live.snapshot ?? snapshotProp;
  const status = live.status === "DISCONNECTED" && statusProp !== "DISCONNECTED" ? statusProp : live.status;
  const monitorStatus = live.monitorStatus;
  const error = live.error ?? errorProp;
  const lastSuccessAt = live.lastSuccessAt ?? snapshot?.fetchedAt ?? null;
  const state = status === "LOADING" ? "불러오는 중" : monitorStatus;
  return <NusaCard testID="portfolio-upbit-read-only"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.info }]}>REAL_READ_ONLY · REFERENCE</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>실거래소 읽기 전용 기준선</Text></View><StatusChip label={state} tone={monitorTone(monitorStatus)} /></View>
    {status === "DISCONNECTED" ? <Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>설정에서 Upbit 읽기 전용 연결을 확인하면 실제 계정 잔고를 기준선으로 표시합니다.</Text>
      : status === "LOADING" ? <View style={styles.inlineState}><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>Upbit 계정 잔고를 조회하는 중입니다.</Text></View>
      : status === "ERROR" && !snapshot ? <Text style={[styles.stateMessage, { color: theme.colors.danger }]}>{error ?? "Upbit 잔고를 표시할 수 없습니다."}</Text>
      : snapshot ? <><View style={styles.upbitBalanceGrid}><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>KRW 사용 가능</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{formatKRW(snapshot.cash.available)}</Text></View><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>KRW 잠금</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{formatKRW(snapshot.cash.locked)}</Text></View></View><View style={[styles.divider, { backgroundColor: theme.colors.border }]} />{snapshot.assets.length === 0 ? <Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>보유 디지털 자산 없음</Text> : snapshot.assets.map((asset) => <View key={asset.currency} style={styles.upbitAssetRow} testID={`portfolio-upbit-asset-${asset.currency}`}><View><Text style={[styles.cardTitle, { color: theme.colors.text }]}>{asset.currency}</Text><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>{asset.unitCurrency} 기준 평균 매수가 · {formatKRW(asset.avgBuyPrice)}</Text></View><View style={styles.upbitAssetValues}><Text style={[styles.positionValue, { color: theme.colors.text }]}>{asset.available}</Text><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>잠금 {asset.locked}</Text></View></View>)}<Text style={[styles.upbitFetchedAt, { color: theme.colors.textMuted }]} testID="portfolio-upbit-last-success">마지막 성공 조회: {lastSuccessAt == null ? "없음" : new Date(lastSuccessAt).toLocaleString("ko-KR")} · {monitorStatus} · REAL_READ_ONLY 기준선은 PAPER 결과와 합산하지 않습니다.</Text>{error && monitorStatus !== "CONNECTED" ? <Text style={[styles.stateMessage, { color: monitorStatus === "AUTH_ERROR" || monitorStatus === "RELAY_ERROR" ? theme.colors.danger : theme.colors.textMuted }]} testID="portfolio-upbit-monitor-error">{error}</Text> : null}</>
      : <Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>Upbit 잔고가 없습니다.</Text>}
  </NusaCard>;
}

function renderPosition(model: PortfolioViewModel, theme: ReturnType<typeof useTheme>["theme"]) {
  if (!model.position) return <View style={styles.emptyPosition} testID="portfolio-empty"><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>PAPER EXPOSURE</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 시장 노출 없음</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>NUSA PAPER 운용은 현재 현금 대기 상태입니다.</Text></View>;
  return <NusaCard testID="portfolio-position"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>PAPER EXPOSURE</Text><Text style={[styles.positionMarket, { color: theme.colors.text }]}>{model.position.market}</Text></View><StatusChip label="PAPER" tone="primary" /></View><View style={styles.positionMetrics}><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>수량</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{model.position.quantity}</Text></View><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>평가가</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{formatKRW(model.position.currentPrice)}</Text></View></View><DataRow label="평균 단가" value={formatKRW(model.position.averagePrice)} /><View style={[styles.divider, { backgroundColor: theme.colors.border }]} /><DataRow label="미실현 손익" value={formatSignedMoney(model.position.unrealizedPnl)} emphasis tone={pnlTone(model.position.unrealizedPnl)} /><DataRow label="실현 손익" value={formatSignedMoney(model.position.realizedPnl)} tone={pnlTone(model.position.realizedPnl)} /></NusaCard>;
}

export function PortfolioView({ snapshot, investmentPercent, error, refreshing, onRefresh, upbitSnapshot = null, upbitStatus = "DISCONNECTED", upbitError = null, onOpenPaperLearning }: PortfolioViewProps) {
  const { theme } = useTheme();
  const localPaperActive = snapshot === null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const effectiveSnapshot = snapshot ?? localPortfolio;
  const usingLocalPaper = snapshot === null && localPortfolio !== null;

  if (effectiveSnapshot === null) return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen"><UpbitReadOnlySection upbitSnapshot={upbitSnapshot} upbitStatus={upbitStatus} upbitError={upbitError} />{upbitStatus === "LOADING" ? <Text style={[styles.stateTitle, { color: theme.colors.text }]}>운용 결과를 불러오는 중</Text> : null}<InlineNotice title={error ? "PAPER 운용 결과를 표시할 수 없습니다" : "PAPER 연결 필요"} detail={error ?? "PAPER 서버에 연결하면 NUSA의 PAPER 평가자산, 손익과 노출을 표시합니다. REAL_READ_ONLY 잔고는 별도 기준선으로 유지됩니다."} tone={error ? "danger" : "warning"} /><NusaButton label="PAPER 다시 불러오기" onPress={onRefresh} /></ScrollView>;
  if (error && !usingLocalPaper) return <ErrorState theme={theme} message={error} onRetry={onRefresh} />;
  let model: PortfolioViewModel;
  try { model = buildPortfolioViewModel(effectiveSnapshot); } catch (validationError) { return <ErrorState theme={theme} message={validationError instanceof Error ? validationError.message : "Portfolio data is invalid."} onRetry={onRefresh} />; }
  const allocation = createCashInvestmentEnvelope(model.cash, investmentPercent);
  const allocationWidth = `${allocation.investmentPercent}%` as `${number}%`;

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen">
    <ScreenHeader eyebrow="NUSA SUPERVISION" title="운용 결과" description="PAPER 결과를 먼저 요약하고, 실제 계정은 REAL_READ_ONLY 기준선으로 분리해 감독합니다." statusLabel={usingLocalPaper ? "LOCAL PAPER" : "PAPER"} statusTone="primary" />
    {usingLocalPaper ? <InlineNotice title="LOCAL PAPER 운용 결과" detail="Cloud 연결 없이 기기 내 LOCAL PAPER 결과를 표시합니다. 실제 주문은 전송되지 않습니다." tone="info" testID="portfolio-local-paper-note" /> : null}

    <NusaCard testID="portfolio-supervisor-summary">
      <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>NUSA OPERATING RESULT</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>현재 PAPER 운용 요약</Text></View><StatusChip label="PAPER RESULT" tone="primary" /></View>
      <DataRow label="PAPER 평가자산" value={formatKRW(model.totalEquity)} />
      <DataRow label="누적 PAPER 손익" value={formatSignedMoney(model.totalPnl)} emphasis tone={pnlTone(model.totalPnl)} />
      <DataRow label="현재 시장 노출" value={formatKRW(model.assetValue)} />
      <DataRow label="보호 현금" value={formatKRW(allocation.reservedCash)} tone="success" />
      <DataRow label="열린 주문" value={String(model.openOrderCount)} />
      <Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 합산하지 않습니다.</Text>
      {onOpenPaperLearning ? <NusaButton label="학습 / 평가 근거 보기" tone="neutral" onPress={onOpenPaperLearning} testID="portfolio-paper-learning" /> : null}
    </NusaCard>

    <UpbitReadOnlySection upbitSnapshot={upbitSnapshot} upbitStatus={upbitStatus} upbitError={upbitError} />

    <View style={styles.allocation} testID="portfolio-allocation-rail"><View style={styles.allocationHeader}><View><Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>PAPER 운용 현금</Text><Text style={[styles.allocationValue, { color: theme.colors.text }]}>{formatKRW(model.cash)}</Text></View><Text style={[styles.allocationPercent, { color: theme.colors.primary }]}>NUSA 투자 한도 {allocation.investmentPercent}%</Text></View><View style={[styles.rail, { backgroundColor: theme.colors.surfaceRaised }]}><View style={[styles.railFill, { width: allocationWidth, backgroundColor: theme.colors.primary }]} /></View><View style={styles.allocationSplit}><View style={styles.splitCell}><Text style={[styles.splitLabel, { color: theme.colors.textMuted }]}>투입 가능</Text><Text testID="portfolio-investable-cash" style={[styles.splitValue, { color: theme.colors.text }]}>{formatKRW(allocation.investableCash)}</Text></View><View style={styles.splitCell}><Text style={[styles.splitLabel, { color: theme.colors.textMuted }]}>보호 현금</Text><Text testID="portfolio-reserved-cash" style={[styles.splitValue, { color: theme.colors.text }]}>{formatKRW(allocation.reservedCash)}</Text></View></View></View>

    {allocation.reservePercent > 0 ? <InlineNotice title={`${allocation.reservePercent}% 보호 현금 유지`} detail={`${formatKRW(allocation.reservedCash)}는 NUSA의 신규 PAPER 매수 한도에서 제외됩니다.`} tone="info" /> : null}

    <View style={styles.detailGrid}><View style={styles.detailCell}>{renderPosition(model, theme)}</View><View style={styles.detailCell}><NusaCard testID="portfolio-account-breakdown"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>PAPER CONTROL</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>운용 한도와 계정 집계</Text></View><StatusChip label="검증됨" tone="info" /></View><DataRow label="전체 현금" value={formatKRW(model.cash)} /><DataRow label="투입 가능" value={formatKRW(allocation.investableCash)} emphasis /><DataRow label="보호 현금" value={formatKRW(allocation.reservedCash)} tone="success" /><DataRow label="시장 노출" value={formatKRW(model.assetValue)} /><DataRow label="열린 주문" value={String(model.openOrderCount)} /></NusaCard></View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 20, paddingTop: 20, gap: 20, paddingBottom: 44, width: "100%", maxWidth: 1080, alignSelf: "center" }, state: { flex: 1, justifyContent: "center", padding: 20, gap: 10, alignItems: "center" }, stateInner: { width: "100%", maxWidth: 720, gap: 12 }, stateTitle: { fontSize: 18, fontWeight: "700" }, stateMessage: { lineHeight: 21, fontSize: 14 }, inlineState: { flexDirection: "row", gap: 10, alignItems: "center" }, heroLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.0 }, allocation: { gap: 10, paddingVertical: 4 }, allocationHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }, allocationValue: { marginTop: 4, fontSize: 23, lineHeight: 29, fontWeight: "800", fontVariant: ["tabular-nums"] }, allocationPercent: { fontSize: 14, fontWeight: "800" }, rail: { height: 7, borderRadius: 999, overflow: "hidden" }, railFill: { height: "100%", borderRadius: 999 }, allocationSplit: { flexDirection: "row", flexWrap: "wrap", gap: 18 }, splitCell: { flexGrow: 1, flexBasis: 140 }, splitLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" }, splitValue: { marginTop: 3, fontSize: 16, lineHeight: 22, fontWeight: "700", fontVariant: ["tabular-nums"] }, upbitBalanceGrid: { flexDirection: "row", gap: 16, flexWrap: "wrap" }, upbitAssetRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center", paddingVertical: 8 }, upbitAssetValues: { alignItems: "flex-end", gap: 2 }, upbitFetchedAt: { marginTop: 10, fontSize: 11, lineHeight: 16 }, detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "stretch" }, detailCell: { flexGrow: 1, flexBasis: 420 }, emptyPosition: { paddingVertical: 16, gap: 5 }, cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }, positionMarket: { fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.6 }, positionMetrics: { flexDirection: "row", gap: 16, marginBottom: 10, flexWrap: "wrap" }, positionMetric: { flexGrow: 1, flexBasis: 130 }, metricLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }, positionValue: { marginTop: 5, fontSize: 18, lineHeight: 23, fontWeight: "700", fontVariant: ["tabular-nums"] }, divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 } });
