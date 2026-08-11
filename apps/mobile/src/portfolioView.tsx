import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, StatusChip } from "./components";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { useTheme } from "./ThemeProvider";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";

export type { PortfolioAccountResponse } from "./portfolioViewModel";

function money(value: number): string { return `₩${Math.round(value).toLocaleString("ko-KR")}`; }
function signedMoney(value: number): string { return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`; }
function pnlTone(value: number): "success" | "danger" { return value >= 0 ? "success" : "danger"; }

function LoadingState({ theme }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"] }>) {
  return <View style={styles.state} testID="portfolio-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>자산 정보를 불러오는 중</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>검증된 PAPER 계정 집계를 기다리고 있습니다.</Text></View>;
}

function ErrorState({ theme, message, onRetry }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"]; message: string; onRetry: () => void }>) {
  return <View style={styles.state} testID="portfolio-error"><View style={styles.stateInner}><InlineNotice title="자산 정보를 표시할 수 없습니다" detail={message} tone="danger" /><NusaButton label="다시 불러오기" onPress={onRetry} /></View></View>;
}

export interface PortfolioViewProps { readonly snapshot: PortfolioAccountResponse | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void; }

function renderPosition(model: PortfolioViewModel, theme: ReturnType<typeof useTheme>["theme"]) {
  if (!model.position) return <NusaCard testID="portfolio-empty"><View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>POSITION</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>열린 포지션 없음</Text></View><StatusChip label="현금 대기" tone="neutral" /></View><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>현재 PAPER 계좌는 현금 상태입니다. 다음 주문 전까지 포지션 위험이 없습니다.</Text></NusaCard>;
  return <NusaCard testID="portfolio-position" raised>
    <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.primary }]}>OPEN POSITION</Text><Text style={[styles.positionMarket, { color: theme.colors.text }]}>{model.position.market}</Text></View><StatusChip label="PAPER" tone="primary" /></View>
    <View style={styles.positionMetrics}><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>수량</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{model.position.quantity}</Text></View><View style={styles.positionMetric}><Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>현재 평가가</Text><Text style={[styles.positionValue, { color: theme.colors.text }]}>{money(model.position.currentPrice)}</Text></View></View>
    <DataRow label="평균 단가" value={money(model.position.averagePrice)} />
    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <DataRow label="미실현 손익" value={signedMoney(model.position.unrealizedPnl)} emphasis tone={pnlTone(model.position.unrealizedPnl)} />
    <DataRow label="실현 손익" value={signedMoney(model.position.realizedPnl)} tone={pnlTone(model.position.realizedPnl)} />
  </NusaCard>;
}

export function PortfolioView({ snapshot, error, refreshing, onRefresh }: PortfolioViewProps) {
  const { theme } = useTheme();
  if (error) return <ErrorState theme={theme} message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <LoadingState theme={theme} />;

  let model: PortfolioViewModel;
  try { model = buildPortfolioViewModel(snapshot); }
  catch (validationError) { return <ErrorState theme={theme} message={validationError instanceof Error ? validationError.message : "Portfolio data is invalid."} onRetry={onRefresh} />; }

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen">
    <ScreenHeader eyebrow="PAPER PORTFOLIO" title="자산" description="계정 전체 평가액과 손익, 열린 PAPER 포지션을 한눈에 확인합니다." statusLabel="PAPER" statusTone="primary" />
    <View style={styles.hero} testID="portfolio-summary"><Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>총 평가자산</Text><Text style={[styles.heroValue, { color: theme.colors.text }]} adjustsFontSizeToFit numberOfLines={1}>{money(model.totalEquity)}</Text><Text style={[styles.heroPnl, { color: model.totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.totalPnl)} 누적 손익</Text></View>
    <View style={styles.metricGrid}>
      <MetricTile label="현금" value={money(model.cash)} detail="주문 가능 PAPER 현금" tone="primary" testID="portfolio-cash" />
      <MetricTile label="실현 손익" value={signedMoney(model.realizedPnl)} detail="확정된 PAPER 손익" tone={pnlTone(model.realizedPnl)} testID="portfolio-realized-pnl" />
      <MetricTile label="미실현 손익" value={signedMoney(model.unrealizedPnl)} detail="열린 포지션 평가 손익" tone={pnlTone(model.unrealizedPnl)} testID="portfolio-unrealized-pnl" />
    </View>
    <InlineNotice title="검증된 계정 집계" detail="총 평가자산·현금·손익은 PAPER 서버가 제공한 계정 집계값만 표시합니다. 추정값이나 가짜 잔고를 만들지 않습니다." tone="info" />
    <View style={styles.detailGrid}><View style={styles.detailCell}>{renderPosition(model, theme)}</View><View style={styles.detailCell}><NusaCard testID="portfolio-allocation">
      <View style={styles.cardHeader}><View><Text style={[styles.cardEyebrow, { color: theme.colors.textMuted }]}>ACCOUNT BREAKDOWN</Text><Text style={[styles.cardTitle, { color: theme.colors.text }]}>계정 구성</Text></View><StatusChip label="검증됨" tone="info" /></View>
      <DataRow label="현금" value={money(model.cash)} />
      <DataRow label="포지션 평가액" value={money(model.assetValue)} />
      <DataRow label="열린 주문" value={String(model.openOrderCount)} />
    </NusaCard></View></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 16, paddingBottom: 36, width: "100%", maxWidth: 1080, alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 10, alignItems: "center" },
  stateInner: { width: "100%", maxWidth: 720, gap: 12 },
  stateTitle: { fontSize: 18, fontWeight: "700" }, stateMessage: { lineHeight: 21, fontSize: 14 },
  hero: { paddingVertical: 8, gap: 5 }, heroLabel: { fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.8 }, heroValue: { fontSize: 42, lineHeight: 49, fontWeight: "800", letterSpacing: -1.8, fontVariant: ["tabular-nums"] }, heroPnl: { fontSize: 15, lineHeight: 21, fontWeight: "700", fontVariant: ["tabular-nums"] },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "stretch" }, detailCell: { flexGrow: 1, flexBasis: 420 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }, cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 }, cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  positionMarket: { fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.6 }, positionMetrics: { flexDirection: "row", gap: 16, marginBottom: 10 }, positionMetric: { flex: 1 }, metricLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }, positionValue: { marginTop: 5, fontSize: 18, lineHeight: 23, fontWeight: "700", fontVariant: ["tabular-nums"] }, divider: { height: 1, marginVertical: 12 },
});