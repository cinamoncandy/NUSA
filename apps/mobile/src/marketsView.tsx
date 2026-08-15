import React, { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import type { WatchlistRepository } from "./watchlist";
import { uxLayout } from "./uxLayout";

interface MarketsViewProps {
  readonly repository: WatchlistRepository;
  readonly market: string;
  readonly rawMarkets: unknown[] | null;
  readonly rawCandles: unknown[] | null;
  readonly currentPrice: number | null;
  readonly marketConnectionState: string;
  readonly stale: boolean;
  readonly marketsStale: boolean;
  readonly chartError: string | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

type Panel = "WATCHLIST" | "CHART";

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, marketsStale, chartError, error, refreshing, onRefresh }: MarketsViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [panel, setPanel] = useState<Panel>("WATCHLIST");
  const chartAvailable = Array.isArray(rawCandles) && rawCandles.length > 0;
  const tabletWorkspace = width >= 768 && chartAvailable;
  const visiblePanel = chartAvailable ? panel : "WATCHLIST";

  const segment = (value: Panel, label: string, testID: string) => {
    const selected = visiblePanel === value;
    return <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => setPanel(value)}
      testID={testID}
      style={({ pressed }) => [styles.segment, {
        backgroundColor: selected ? theme.colors.surfaceRaised : "transparent",
        borderColor: selected ? theme.colors.borderStrong : "transparent",
        opacity: pressed ? theme.interaction.pressedOpacity : 1,
      }]}
    ><Text style={[styles.segmentLabel, { color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: selected ? theme.typography.weights.bold : theme.typography.weights.semibold }]} numberOfLines={1}>{label}</Text></Pressable>;
  };

  const watchlist = <WatchlistView error={error} onRefresh={onRefresh} rawMarkets={rawMarkets} refreshing={refreshing} repository={repository} stale={marketsStale} />;
  const chart = <ChartView error={chartError ?? error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />;

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    {tabletWorkspace ? <View style={styles.tabletWorkspace} testID="markets-tablet-workspace">
      <View style={styles.tabletPanel} testID="markets-tablet-watchlist">{watchlist}</View>
      <View style={styles.tabletPanel} testID="markets-tablet-chart">{chart}</View>
    </View> : null}
    {!tabletWorkspace && chartAvailable ? <View style={[styles.segmentOuter, { paddingHorizontal: width < 380 ? 16 : 20 }]}>
      <View accessibilityRole="tablist" style={[styles.panels, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="markets-panels"><View testID="markets-panel-segmented-control" style={styles.segmentAlias}>
        {segment("WATCHLIST", "시장", "markets-watchlist-tab")}
        {segment("CHART", "차트", "markets-chart-tab")}
      </View></View>
    </View> : null}
    {!tabletWorkspace ? (visiblePanel === "WATCHLIST" ? watchlist : chart) : null}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  segmentOuter: { paddingTop: 12, paddingBottom: 2 },
  tabletWorkspace: { flex: 1, flexDirection: "row", gap: 24, paddingHorizontal: 28, paddingTop: 20 },
  tabletPanel: { flex: 1, minWidth: 0 },
  panels: { flexDirection: "row", padding: 4, borderWidth: 1, borderRadius: 999 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 12 },
  segmentAlias: { flex: 1, flexDirection: "row" },
  segmentLabel: { fontSize: 13, letterSpacing: -0.15 },
});
