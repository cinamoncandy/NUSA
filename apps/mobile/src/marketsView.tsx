import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { NusaButton } from "./components";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import { WatchlistView } from "./watchlistView";
import { parseWatchlistMarkets, type WatchlistRepository } from "./watchlist";
import { uxLayout } from "./uxLayout";
import type { PublicQuotationDiagnostic } from "./upbitPublicQuotationClient";

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
  readonly chartErrorDiagnostic: PublicQuotationDiagnostic | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onPaperTrade: () => void;
}

type Panel = "WATCHLIST" | "CHART";

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, marketsStale, chartError, chartErrorDiagnostic, error, refreshing, onRefresh, onPaperTrade }: MarketsViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  // v5 (docs/NUSA_MOBILE_UIUX_V5_OBSIDIAN_FINANCE.md §6): the chart is the dominant/first
  // region -- it is always reachable and defaults first, even when no real candle data is
  // wired yet. ChartView's own LOADING/EMPTY/ERROR states render truthfully instead of the
  // chart being silently hidden behind the watchlist.
  const [panel, setPanel] = useState<Panel>("CHART");
  const tabletWorkspace = width >= 768;
  const changeRate = useMemo(() => {
    if (!Array.isArray(rawMarkets)) return null;
    try { return parseWatchlistMarkets(rawMarkets).find((item) => item.market === market)?.changeRate ?? null; } catch { return null; }
  }, [market, rawMarkets]);

  const segment = (value: Panel, label: string, testID: string) => {
    const selected = panel === value;
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
  const chart = <View style={styles.detailWorkspace} testID="market-detail-workspace">
    <ChartView changeRate={changeRate} diagnostic={chartError ? chartErrorDiagnostic : null} error={chartError ?? error} currentPrice={currentPrice} market={market} marketConnectionState={marketConnectionState} onRefresh={onRefresh} rawCandles={rawCandles} refreshing={refreshing} stale={stale} />
    <View style={[styles.tradeAction, { borderTopColor: theme.colors.border }]}>
      <View style={styles.tradeCopy}>
        <Text style={[styles.tradeEyebrow, { color: theme.colors.textMuted }]}>NEXT</Text>
        <Text style={[styles.tradeDetail, { color: theme.colors.textMuted }]}>현재 시장을 유지한 채 기존 PAPER 주문 검토 흐름으로 이동합니다.</Text>
      </View>
      <NusaButton label="PAPER TRADE" onPress={onPaperTrade} testID="market-paper-trade" />
    </View>
  </View>;

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    {tabletWorkspace ? <View style={styles.tabletWorkspace} testID="markets-tablet-workspace">
      <View style={styles.tabletPanel} testID="markets-tablet-watchlist">{watchlist}</View>
      <View style={styles.tabletPanel} testID="markets-tablet-chart">{chart}</View>
    </View> : null}
    {!tabletWorkspace ? <View style={[styles.segmentOuter, { paddingHorizontal: width < 380 ? 16 : 20 }]}>
      <View accessibilityRole="tablist" style={[styles.panels, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="markets-panels"><View testID="markets-panel-segmented-control" style={styles.segmentAlias}>
        {segment("WATCHLIST", "시장", "markets-watchlist-tab")}
        {segment("CHART", "차트", "markets-chart-tab")}
      </View></View>
    </View> : null}
    {!tabletWorkspace ? (panel === "WATCHLIST" ? watchlist : chart) : null}
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
  detailWorkspace: { flex: 1, minWidth: 0 },
  tradeAction: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  tradeCopy: { gap: 4 },
  tradeEyebrow: { fontSize: 9, lineHeight: 14, fontWeight: "800", letterSpacing: 1.5 },
  tradeDetail: { fontSize: 11, lineHeight: 16 },
});