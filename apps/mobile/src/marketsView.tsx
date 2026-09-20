import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import type { PublicCandle } from "./chartViewModel";
import { WatchlistView } from "./watchlistView";
import { parseWatchlistMarkets, type WatchlistRepository } from "./watchlist";
import { uxLayout } from "./uxLayout";
import { loadUpbitPublicCandles, UpbitPublicQuotationError, type PublicQuotationDiagnostic } from "./upbitPublicQuotationClient";
import { AuthorityRail, StateNotice } from "./intelligenceOs";

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

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}
function rate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = value * 100;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function MarketsView({ repository, market, rawMarkets, rawCandles, currentPrice, marketConnectionState, stale, marketsStale, chartError, chartErrorDiagnostic, error, refreshing, onRefresh, onPaperTrade }: MarketsViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [panel, setPanel] = useState<Panel>("CHART");
  const [selectedMarket, setSelectedMarket] = useState(market);
  const [selectedCandles, setSelectedCandles] = useState<readonly PublicCandle[] | null>(null);
  const [selectedChartError, setSelectedChartError] = useState<string | null>(null);
  const [selectedChartDiagnostic, setSelectedChartDiagnostic] = useState<PublicQuotationDiagnostic | null>(null);
  const [selectedChartLoading, setSelectedChartLoading] = useState(false);
  const selectionRequestRef = useRef(0);
  const tabletWorkspace = width >= 768;

  const parsedMarkets = useMemo(() => {
    if (!Array.isArray(rawMarkets)) return [];
    try { return parseWatchlistMarkets(rawMarkets); } catch { return []; }
  }, [rawMarkets]);
  const selectedQuote = useMemo(() => parsedMarkets.find((item) => item.market === selectedMarket) ?? null, [parsedMarkets, selectedMarket]);
  const changeRate = selectedQuote?.changeRate ?? null;
  const selectedCurrentPrice = selectedMarket === market ? currentPrice : selectedQuote?.price ?? null;
  const displayedCandles = selectedMarket === market ? rawCandles : selectedCandles;
  const displayedChartError = selectedMarket === market ? chartError : selectedChartError;
  const displayedDiagnostic = selectedMarket === market ? chartErrorDiagnostic : selectedChartDiagnostic;
  const displayedStale = selectedMarket === market ? stale : selectedChartLoading || selectedCandles === null;
  const sourceState = error ? "ERROR" : marketsStale || displayedStale ? "STALE" : parsedMarkets.length > 0 ? "ACTIVE" : "UNAVAILABLE";
  const marketSymbol = selectedMarket.replace("KRW-", "");
  const positiveMove = changeRate != null && changeRate >= 0;
  const sourceLabel = sourceState === "ACTIVE" ? "UPBIT PUBLIC · VERIFIED" : sourceState === "STALE" ? "UPBIT PUBLIC · STALE" : sourceState;

  const loadSelectedCandles = useCallback(async (nextMarket: string): Promise<void> => {
    if (nextMarket === market) {
      setSelectedCandles(null); setSelectedChartError(null); setSelectedChartDiagnostic(null); setSelectedChartLoading(false); return;
    }
    const request = selectionRequestRef.current + 1;
    selectionRequestRef.current = request;
    setSelectedCandles(null); setSelectedChartError(null); setSelectedChartDiagnostic(null); setSelectedChartLoading(true);
    try {
      const candles = await loadUpbitPublicCandles({ market: nextMarket });
      if (selectionRequestRef.current !== request) return;
      setSelectedCandles(candles);
    } catch (loadError) {
      if (selectionRequestRef.current !== request) return;
      setSelectedChartError(loadError instanceof Error ? loadError.message : "선택한 시장의 공개 캔들을 불러올 수 없습니다.");
      setSelectedChartDiagnostic(loadError instanceof UpbitPublicQuotationError ? loadError.diagnostic : null);
    } finally {
      if (selectionRequestRef.current === request) setSelectedChartLoading(false);
    }
  }, [market]);

  const handleSelectMarket = useCallback((nextMarket: string): void => {
    if (nextMarket !== selectedMarket) {
      setSelectedMarket(nextMarket);
      void loadSelectedCandles(nextMarket);
    }
    setPanel("CHART");
  }, [loadSelectedCandles, selectedMarket]);

  const refreshMarketView = useCallback((): void => {
    onRefresh();
    if (selectedMarket !== market) void loadSelectedCandles(selectedMarket);
  }, [loadSelectedCandles, market, onRefresh, selectedMarket]);

  const segment = (value: Panel, label: string, testID: string) => {
    const selected = panel === value;
    return <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => setPanel(value)}
      testID={testID}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: selected ? theme.colors.primarySoft : "transparent",
          borderColor: selected ? theme.colors.primary : "transparent",
          opacity: pressed ? theme.interaction.pressedOpacity : 1,
        },
      ]}
    >
      <Text style={[styles.segmentLabel, { color: selected ? theme.colors.primary : theme.colors.textMuted }]}>{label}</Text>
    </Pressable>;
  };

  const watchlist = <WatchlistView error={error} onRefresh={refreshMarketView} rawMarkets={rawMarkets} refreshing={refreshing || selectedChartLoading} repository={repository} selectedMarket={selectedMarket} onSelectMarket={handleSelectMarket} stale={marketsStale} />;
  const chart = <View style={styles.detailWorkspace} testID="market-detail-workspace">
    <ChartView changeRate={changeRate} diagnostic={displayedChartError ? displayedDiagnostic : null} error={displayedChartError ?? error} currentPrice={selectedCurrentPrice} market={selectedMarket} marketConnectionState={marketConnectionState} onRefresh={refreshMarketView} rawCandles={displayedCandles === null ? null : [...displayedCandles]} refreshing={refreshing || selectedChartLoading} stale={displayedStale} />
    <Pressable
      accessibilityRole="button"
      onPress={onPaperTrade}
      style={({ pressed }) => [styles.paperContext, { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
      testID="market-observation-context"
    >
      <View style={styles.paperContextCopy}>
        <Text style={[styles.paperKicker, { color: theme.colors.primary }]}>PAPER CONTEXT</Text>
        <Text style={[styles.paperTitle, { color: theme.colors.text }]}>시장 관측과 PAPER 판단은 분리됩니다</Text>
        <Text style={[styles.paperDetail, { color: theme.colors.textMuted }]}>공개 시세는 읽기 전용입니다. 이 데이터만으로 전략 신호나 주문 권한이 생기지 않습니다.</Text>
      </View>
      <Text style={[styles.chevron, { color: theme.colors.primary }]}>›</Text>
    </Pressable>
  </View>;

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    <View style={[styles.top, { maxWidth: tabletWorkspace ? 980 : 720 }]}>
      <AuthorityRail detail="PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY" status={sourceState} tone={sourceState === "ACTIVE" ? "success" : sourceState === "ERROR" ? "danger" : "warning"} testID="markets-authority-rail" />

      <View style={styles.marketHero} testID="markets-command-hero">
        <View style={styles.heroTopRow}>
          <View>
            <Text style={[styles.heroEyebrow, { color: theme.colors.textMuted }]}>MARKET OBSERVATION</Text>
            <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{marketSymbol}</Text>
            <Text style={[styles.heroMarket, { color: theme.colors.textMuted }]}>{selectedMarket}</Text>
          </View>
          <View style={[styles.sourceBadge, { borderColor: sourceState === "ACTIVE" ? theme.colors.primary : theme.colors.borderStrong }]}>
            <View style={[styles.sourceDot, { backgroundColor: sourceState === "ACTIVE" ? theme.colors.primary : theme.colors.warning }]} />
            <Text style={[styles.sourceBadgeText, { color: sourceState === "ACTIVE" ? theme.colors.primary : theme.colors.textMuted }]}>{sourceLabel}</Text>
          </View>
        </View>

        <View style={styles.quoteRow}>
          <Text style={[styles.heroPrice, { color: theme.colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{money(selectedCurrentPrice)}</Text>
          <Text style={[styles.heroChange, { color: changeRate == null ? theme.colors.textMuted : positiveMove ? theme.colors.primary : theme.colors.danger }]}>{rate(changeRate)}</Text>
        </View>

        <View style={[styles.marketStats, { borderColor: theme.colors.border }]} testID="markets-summary-strip">
          <View style={styles.marketStat}>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>CONNECTION</Text>
            <Text style={[styles.statValue, { color: marketConnectionState === "CONNECTED" ? theme.colors.primary : theme.colors.warning }]}>{marketConnectionState}</Text>
          </View>
          <View style={[styles.marketStat, styles.statDivider, { borderLeftColor: theme.colors.border }]}>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>OBSERVED</Text>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{parsedMarkets.length}</Text>
          </View>
          <View style={[styles.marketStat, styles.statDivider, { borderLeftColor: theme.colors.border }]}>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>AUTHORITY</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>READ ONLY</Text>
          </View>
        </View>
      </View>

      {error ? <StateNotice title="PUBLIC FEED ERROR" detail={error} tone="danger" /> : displayedStale ? <StateNotice title="STALE DATA" detail="표시 중인 공개 시장 데이터가 신선도 기준을 벗어났습니다." tone="warning" /> : null}
    </View>

    {tabletWorkspace ? <View style={styles.tabletWorkspace} testID="markets-tablet-workspace"><View style={styles.tabletPanel} testID="markets-tablet-watchlist">{watchlist}</View><View style={styles.tabletPanel} testID="markets-tablet-chart">{chart}</View></View> : null}

    {!tabletWorkspace ? <View style={[styles.segmentOuter, { paddingHorizontal: width < 380 ? 16 : 20 }]}>
      <View accessibilityRole="tablist" style={[styles.panels, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="markets-panels">
        <View testID="markets-panel-segmented-control" style={styles.segmentAlias}>{segment("CHART", "차트", "markets-chart-tab")}{segment("WATCHLIST", "시장 목록", "markets-watchlist-tab")}</View>
      </View>
    </View> : null}

    {!tabletWorkspace ? (panel === "WATCHLIST" ? watchlist : chart) : null}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  top: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 10, gap: 10 },
  marketHero: { paddingTop: 12, paddingBottom: 4, gap: 12 },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  heroEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.35 },
  heroTitle: { fontSize: 34, lineHeight: 38, fontWeight: "900", letterSpacing: 0.6, marginTop: 2 },
  heroMarket: { fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 0.8, marginTop: 1 },
  sourceBadge: { minHeight: 32, maxWidth: 190, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  sourceDot: { width: 6, height: 6, borderRadius: 6 },
  sourceBadgeText: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 0.5 },
  quoteRow: { flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  heroPrice: { flexShrink: 1, fontSize: 36, lineHeight: 42, fontWeight: "900", letterSpacing: -1.3, fontVariant: ["tabular-nums"] },
  heroChange: { fontSize: 14, lineHeight: 19, fontWeight: "900", fontVariant: ["tabular-nums"] },
  marketStats: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  marketStat: { flex: 1, minWidth: 0, paddingVertical: 10, gap: 3 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 10 },
  statLabel: { fontSize: 7, lineHeight: 10, fontWeight: "900", letterSpacing: 0.8 },
  statValue: { fontSize: 10, lineHeight: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  segmentOuter: { paddingTop: 9, paddingBottom: 2 },
  tabletWorkspace: { flex: 1, flexDirection: "row", gap: 20, paddingHorizontal: 24, paddingTop: 14 },
  tabletPanel: { flex: 1, minWidth: 0 },
  panels: { flexDirection: "row", padding: 4, borderWidth: 1, borderRadius: 9 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 6, paddingHorizontal: 12 },
  segmentAlias: { flex: 1, flexDirection: "row" },
  segmentLabel: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 0.35 },
  detailWorkspace: { flex: 1, minWidth: 0 },
  paperContext: { minHeight: 86, borderWidth: 1, borderRadius: 9, marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  paperContextCopy: { flex: 1, gap: 4 },
  paperKicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  paperTitle: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  paperDetail: { fontSize: 10, lineHeight: 16 },
  chevron: { fontSize: 24, fontWeight: "700" },
});
