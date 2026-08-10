import React, { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { NusaButton, NusaCard } from "./components";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";
import { InlineNotice, MetricTile, ScreenHeader } from "./uxPrimitives";
import { uxLayout } from "./uxLayout";

interface MarketsViewProps {
  readonly repository: WatchlistRepository;
  readonly market: string;
  readonly rawMarkets: unknown[] | null;
  readonly rawCandles: unknown[] | null;
  readonly currentPrice: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

const formatPrice = (value: number | null): string => value == null || !Number.isFinite(value) ? "-" : `₩${Math.round(value).toLocaleString("ko-KR")}`;

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: MarketsViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [panel, setPanel] = useState<"WATCHLIST" | "CHART">("WATCHLIST");
  const chartAvailable = Array.isArray(rawCandles) && rawCandles.length > 0;
  const wide = width >= 840;
  const visiblePanel = chartAvailable ? panel : "WATCHLIST";
  const connected = marketConnectionState === "CONNECTED";

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace"><View style={styles.content}>
    <ScreenHeader eyebrow="MARKETS" title="시장" description="가격보다 먼저 연결과 데이터 신선도를 확인하고, 관심시장과 차트를 한 작업공간에서 탐색합니다." statusLabel={stale ? "점검 필요" : "최신"} statusTone={stale ? "warning" : "success"} />

    <View style={styles.metrics} testID="markets-status-card">
      <MetricTile label="관찰 시장" value={market} detail="현재 선택된 PAPER 기준 시장" tone="primary" />
      <MetricTile label="현재 가격" value={formatPrice(currentPrice)} detail={stale ? "데이터 신선도 확인 필요" : "수신된 최신 값"} tone={stale ? "warning" : "default"} />
      <MetricTile label="시장 연결" value={marketConnectionState} detail={chartAvailable ? "차트 데이터 사용 가능" : "차트 데이터 없음"} tone={connected ? "success" : "warning"} />
    </View>

    {!chartAvailable ? <InlineNotice title="차트 데이터가 아직 없습니다" detail="캔들 데이터가 수신되기 전에는 차트 탭을 노출하지 않습니다. 관심시장과 현재 연결 상태만 확인할 수 있습니다." tone="info" /> : null}
    {error ? <InlineNotice title="시장 데이터를 완전히 불러오지 못했습니다" detail={error} tone="warning" /> : null}

    <View style={[styles.layout, wide && styles.layoutWide]} testID="markets-responsive-layout">
      <View style={[styles.summaryColumn, wide && styles.summaryColumnWide]}>
        <NusaCard raised>
          <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>MARKET TRUTH</Text>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>수신된 데이터만 표시</Text>
          <Text style={[styles.note, { color: theme.colors.textMuted }]}>수신되지 않은 가격·캔들·거래량은 임의로 채우지 않습니다. 연결이 불확실하면 최신처럼 보이게 만들지 않습니다.</Text>
        </NusaCard>
        {chartAvailable && wide ? <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} /> : null}
      </View>
      <View style={styles.mainColumn}>
        {chartAvailable && !wide ? <View style={[styles.panels, { borderBottomColor: theme.colors.border }]} testID="markets-panels">
          <NusaButton label="관심시장" onPress={() => setPanel("WATCHLIST")} tone={visiblePanel === "WATCHLIST" ? "primary" : "neutral"} testID="markets-watchlist-tab" />
          <NusaButton label="차트" onPress={() => setPanel("CHART")} tone={visiblePanel === "CHART" ? "primary" : "neutral"} testID="markets-chart-tab" />
        </View> : null}
        <View style={styles.panelBody}>{wide || visiblePanel === "WATCHLIST" ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />}</View>
      </View>
    </View>
  </View></View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, alignItems: "center" },
  content: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, paddingHorizontal: uxLayout.phoneGutter, paddingTop: 18, gap: 16 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: uxLayout.metricGap },
  layout: { flex: 1, gap: 16 },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  summaryColumn: { gap: 14 },
  summaryColumnWide: { width: uxLayout.summaryColumnWidth, flexShrink: 0 },
  mainColumn: { flex: 1, minWidth: 0 },
  panelBody: { flex: 1, width: "100%" },
  panels: { flexDirection: "row", gap: 8, paddingBottom: 10, borderBottomWidth: 1, marginBottom: 10 },
  sectionLabel: { fontSize: 10, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 },
  sectionTitle: { marginTop: 5, fontSize: 17, lineHeight: 23, fontWeight: "800", letterSpacing: -0.35 },
  note: { fontSize: 12, lineHeight: 19, marginTop: 9 },
});
