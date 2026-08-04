import React, { useState } from "react";
import { View } from "react-native";
import { NusaButton } from "./components";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";

interface MarketsViewProps {
  readonly repository: WatchlistRepository;
  readonly market: string;
  readonly rawMarkets: readonly unknown[] | null;
  readonly rawCandles: readonly unknown[] | null;
  readonly currentPrice: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, error, refreshing, onRefresh }: MarketsViewProps) {
  const [panel, setPanel] = useState<"WATCHLIST" | "CHART">("WATCHLIST");
  return <View style={{ flex: 1 }} testID="markets-workspace">
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 8 }} testID="markets-panels">
      <NusaButton label="Watchlist" onPress={() => setPanel("WATCHLIST")} tone={panel === "WATCHLIST" ? "primary" : "neutral"} testID="markets-watchlist-tab" />
      <NusaButton label="Chart" onPress={() => setPanel("CHART")} tone={panel === "CHART" ? "primary" : "neutral"} testID="markets-chart-tab" />
    </View>
    {panel === "WATCHLIST" ? <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} /> : <ChartView error={error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />}
  </View>;
}
