import React, { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { DataRow, NusaButton, NusaCard, SectionHeading, StatusChip } from "./components";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";

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

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace"><View style={styles.content}>
    <View style={styles.heading}><SectionHeading eyebrow="MARKETS" title="시장" description="실제 수신된 시장 상태와 관심시장을 한 작업공간에서 확인합니다." /></View>
    <View style={[styles.layout, wide && styles.layoutWide]} testID="markets-responsive-layout">
      <View style={[styles.summaryColumn, wide && styles.summaryColumnWide]}>
        <NusaCard raised testID="markets-status-card">
          <View style={styles.cardHeader}><View><Text style={[styles.label, { color: theme.colors.textMuted }]}>관찰 시장</Text><Text style={[styles.market, { color: theme.colors.text }]}>{market}</Text></View><StatusChip label={stale ? "점검 필요" : "최신"} tone={stale ? "warning" : "success"} /></View>
          <Text style={[styles.price, { color: theme.colors.text }]}>{formatPrice(currentPrice)}</Text>
          <DataRow label="연결" value={marketConnectionState} tone={marketConnectionState === "CONNECTED" ? "success" : "warning"} />
          <DataRow label="차트 데이터" value={chartAvailable ? "사용 가능" : "없음"} tone={chartAvailable ? "success" : "default"} />
          <Text style={[styles.note, { color: theme.colors.textMuted }]}>수신되지 않은 가격·캔들·거래량은 임의로 채우지 않습니다.</Text>
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
  content: { flex: 1, width: "100%", maxWidth: 1080, paddingHorizontal: 20, paddingTop: 18 },
  heading: { marginBottom: 14 },
  layout: { flex: 1, gap: 14 },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  summaryColumn: { gap: 14 },
  summaryColumnWide: { width: 340, flexShrink: 0 },
  mainColumn: { flex: 1, minWidth: 0 },
  panelBody: { flex: 1, width: "100%" },
  panels: { flexDirection: "row", gap: 8, paddingBottom: 10, borderBottomWidth: 1, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  market: { marginTop: 4, fontSize: 20, fontWeight: "700" },
  price: { fontSize: 28, fontWeight: "800", marginVertical: 12, fontVariant: ["tabular-nums"] },
  note: { fontSize: 12, lineHeight: 18, marginTop: 10 },
});
