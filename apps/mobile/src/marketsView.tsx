import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { NusaButton } from "./components";
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

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: MarketsViewProps) {
  const { theme } = useTheme();
  const [panel, setPanel] = useState<"WATCHLIST" | "CHART">("WATCHLIST");
  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    <View style={[styles.panels, { borderBottomColor: theme.colors.border }]} testID="markets-panels">
      <NusaButton label="관심시장" onPress={() => setPanel("WATCHLIST")} tone={panel === "WATCHLIST" ? "primary" : "neutral"} testID="markets-watchlist-tab" />
      <NusaButton label="차트" onPress={() => setPanel("CHART")} tone={panel === "CHART" ? "primary" : "neutral"} testID="markets-chart-tab" />
    </View>
    {panel === "WATCHLIST" ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  panels: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
});
