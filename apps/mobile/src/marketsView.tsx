import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";
import { SegmentedControl } from "./uxPrimitives";

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

type Panel = "WATCHLIST" | "CHART";
const panelItems = Object.freeze([{ key: "WATCHLIST", label: "관심시장" }, { key: "CHART", label: "차트" }]);

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: MarketsViewProps) {
  const { theme } = useTheme();
  const [panel, setPanel] = useState<Panel>("WATCHLIST");
  const chartAvailable = Array.isArray(rawCandles) && rawCandles.length > 0;
  const visiblePanel = chartAvailable ? panel : "WATCHLIST";

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    {chartAvailable ? <View style={styles.segmentOuter}>
      <SegmentedControl items={panelItems} selectedKey={visiblePanel} onChange={(key) => setPanel(key as Panel)} testID="markets-panel-segmented-control" />
    </View> : null}
    {visiblePanel === "WATCHLIST" ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  segmentOuter: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 2 },
});
