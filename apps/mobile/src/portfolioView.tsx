import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { buildPortfolioViewModel, type PortfolioAccountResponse, type PortfolioViewModel } from "./portfolioViewModel";

export type { PortfolioAccountResponse } from "./portfolioViewModel";

function money(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function LoadingState({ theme }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"] }>) {
  return <View style={styles.state} testID="portfolio-loading"><ActivityIndicator color={theme.colors.primary} /><Text style={[styles.stateTitle, { color: theme.colors.text }]}>자산 정보를 불러오는 중</Text></View>;
}

function ErrorState({ theme, message, onRetry }: Readonly<{ theme: ReturnType<typeof useTheme>["theme"]; message: string; onRetry: () => void }>) {
  return <View style={styles.state} testID="portfolio-error"><NusaCard><Text style={[styles.stateTitle, { color: theme.colors.danger }]}>자산 정보를 표시할 수 없습니다</Text><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text><NusaButton label="다시 불러오기" onPress={onRetry} /></NusaCard></View>;
}

export interface PortfolioViewProps {
  readonly snapshot: PortfolioAccountResponse | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function renderPosition(model: PortfolioViewModel, theme: ReturnType<typeof useTheme>["theme"]) {
  if (!model.position) return <NusaCard testID="portfolio-empty"><View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>열린 포지션 없음</Text><StatusChip label="현금 대기" tone="neutral" /></View><Text style={[styles.stateMessage, { color: theme.colors.textMuted }]}>현재 PAPER 계좌에 열린 포지션이 없습니다. 계정 전체 현금과 평가액은 위 집계 카드에서 확인할 수 있습니다.</Text></NusaCard>;
  return <NusaCard testID="portfolio-position">
    <View style={styles.cardHeader}><View><Text style={[styles.label, { color: theme.colors.textMuted }]}>열린 포지션</Text><Text style={[styles.positionMarket, { color: theme.colors.text }]}>{model.position.market}</Text></View><StatusChip label="PAPER" tone="primary" /></View>
    <DataRow label="수량" value={String(model.position.quantity)} />
    <DataRow label="평균 단가" value={money(model.position.averagePrice)} />
    <DataRow label="현재 평가가" value={money(model.position.currentPrice)} />
    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    <DataRow label="미실현 손익" value={signedMoney(model.position.unrealizedPnl)} emphasis tone={model.position.unrealizedPnl >= 0 ? "success" : "danger"} />
    <DataRow label="실현 손익" value={signedMoney(model.position.realizedPnl)} tone={model.position.realizedPnl >= 0 ? "success" : "danger"} />
  </NusaCard>;
}

export function PortfolioView({ snapshot, error, refreshing, onRefresh }: PortfolioViewProps) {
  const { theme } = useTheme();
  if (error) return <ErrorState theme={theme} message={error} onRetry={onRefresh} />;
  if (snapshot === null) return <LoadingState theme={theme} />;

  let model: PortfolioViewModel;
  try {
    model = buildPortfolioViewModel(snapshot);
  } catch (validationError) {
    return <ErrorState theme={theme} message={validationError instanceof Error ? validationError.message : "Portfolio data is invalid."} onRetry={onRefresh} />;
  }

  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={theme.colors.primary} refreshing={refreshing} onRefresh={onRefresh} />} testID="portfolio-screen">
    <SectionHeading eyebrow="PAPER PORTFOLIO" title="자산" description="검증된 계정 전체 집계와 현재 PAPER 포지션을 구분해 표시합니다." />
    <NusaCard testID="portfolio-summary" raised>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>계정 총 평가자산</Text>
      <Text style={[styles.total, { color: theme.colors.text }]}>{money(model.totalEquity)}</Text>
      <Text style={[styles.pnl, { color: model.totalPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.totalPnl)} 계정 누적 손익</Text>
    </NusaCard>
    <View style={styles.metrics}>
      <View style={styles.metricCell}><NusaCard testID="portfolio-realized-pnl"><Text style={[styles.label, { color: theme.colors.textMuted }]}>실현 손익</Text><Text style={[styles.metric, { color: model.realizedPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.realizedPnl)}</Text></NusaCard></View>
      <View style={styles.metricCell}><NusaCard testID="portfolio-unrealized-pnl"><Text style={[styles.label, { color: theme.colors.textMuted }]}>미실현 손익</Text><Text style={[styles.metric, { color: model.unrealizedPnl >= 0 ? theme.colors.success : theme.colors.danger }]}>{signedMoney(model.unrealizedPnl)}</Text></NusaCard></View>
    </View>
    <NusaCard testID="portfolio-allocation">
      <View style={styles.cardHeader}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>계정 전체 집계</Text><StatusChip label="검증됨" tone="info" /></View>
      <DataRow label="현금" value={money(model.cash)} />
      <DataRow label="포지션 평가액" value={money(model.assetValue)} />
      <DataRow label="열린 주문" value={String(model.openOrderCount)} />
      <Text style={[styles.scopeNote, { color: theme.colors.textMuted }]}>총 평가자산·현금·손익은 검증된 계정 집계값입니다.</Text>
    </NusaCard>
    {renderPosition(model, theme)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 14, paddingBottom: 32 },
  state: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  stateTitle: { fontSize: 18, fontWeight: "700" },
  stateMessage: { lineHeight: 21, fontSize: 14 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  total: { fontSize: 34, fontWeight: "800", letterSpacing: -1.3, marginTop: 8, fontVariant: ["tabular-nums"] },
  pnl: { fontSize: 15, fontWeight: "700", marginTop: 8, fontVariant: ["tabular-nums"] },
  metrics: { flexDirection: "row", gap: 10 },
  metricCell: { flex: 1 },
  metric: { fontSize: 17, fontWeight: "700", marginTop: 8, fontVariant: ["tabular-nums"] },
  positionMarket: { fontSize: 21, fontWeight: "700", marginTop: 5 },
  divider: { height: 1, marginVertical: 12 },
  scopeNote: { fontSize: 12, lineHeight: 18, marginTop: 12 },
});