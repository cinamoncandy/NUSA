import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import type { PublicCandle } from "./chartViewModel";
import { WatchlistView } from "./watchlistView";
import { parseWatchlistMarkets, type WatchlistMarket, type WatchlistRepository } from "./watchlist";
import { uxLayout } from "./uxLayout";
import { loadUpbitPublicCandles, UpbitPublicQuotationError, type PublicQuotationDiagnostic } from "./upbitPublicQuotationClient";
import { AuthorityRail, MetricStrip, ScreenLead, StateNotice } from "./intelligenceOs";

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
function terrainHeight(changeRate: number | null): number {
  if (changeRate == null || !Number.isFinite(changeRate)) return 2;
  return 12 + Math.min(76, Math.abs(changeRate) * 1_800);
}

function MarketTerrain({
  markets,
  selectedMarket,
  onSelect,
}: Readonly<{
  markets: readonly WatchlistMarket[];
  selectedMarket: string;
  onSelect: (market: string) => void;
}>) {
  const { theme } = useTheme();
  const terrainMarkets = [...markets]
    .filter((item) => item.changeRate != null && Number.isFinite(item.changeRate))
    .sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
    .slice(0, 6);

  return <View style={[styles.terrainFrame, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.borderStrong }]} testID="markets-terrain">
    <View style={styles.terrainHeader}>
      <View>
        <Text style={[styles.terrainEyebrow, { color: theme.colors.primary }]}>MARKET TERRAIN</Text>
        <Text style={[styles.terrainDetail, { color: theme.colors.textMuted }]}>VERIFIED UPBIT PUBLIC MOVE · NO PREDICTION</Text>
      </View>
      <Text style={[styles.terrainSource, { color: theme.colors.textMuted }]}>UPBIT PUBLIC</Text>
    </View>
    <View style={[styles.terrainGrid, { borderColor: theme.colors.border }]}>
      <View style={[styles.terrainAxis, { backgroundColor: theme.colors.border }]} />
      {terrainMarkets.length === 0
        ? <View style={styles.terrainEmpty}><Text style={[styles.terrainEmptyText, { color: theme.colors.textMuted }]}>NO VERIFIED PUBLIC DATA</Text></View>
        : <View style={styles.terrainColumns}>
          {terrainMarkets.map((item) => {
            const move = item.changeRate ?? 0;
            const up = move >= 0;
            const selected = item.market === selectedMarket;
            return <Pressable
              key={item.market}
              accessibilityRole="button"
              accessibilityLabel={`${item.market} ${rate(item.changeRate)}`}
              onPress={() => onSelect(item.market)}
              style={({ pressed }) => [styles.terrainColumn, { opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
              testID={`market-terrain-${item.market}`}
            >
              <View style={styles.terrainGraph}>
                {up ? <View style={styles.terrainHalf}>
                  <View style={[styles.terrainStem, { height: terrainHeight(item.changeRate), backgroundColor: theme.colors.chartUp }]} />
                  <View style={[styles.terrainNode, { backgroundColor: theme.colors.chartUp, borderColor: selected ? theme.colors.text : theme.colors.chartUp }]} />
                </View> : <View style={styles.terrainHalf} />}
                <View style={[styles.terrainCenterTick, { backgroundColor: selected ? theme.colors.text : theme.colors.borderStrong }]} />
                {!up ? <View style={[styles.terrainHalf, styles.terrainHalfDown]}>
                  <View style={[styles.terrainNode, { backgroundColor: theme.colors.chartDown, borderColor: selected ? theme.colors.text : theme.colors.chartDown }]} />
                  <View style={[styles.terrainStem, { height: terrainHeight(item.changeRate), backgroundColor: theme.colors.chartDown }]} />
                </View> : <View style={styles.terrainHalf} />}
              </View>
              <Text style={[styles.terrainSymbol, { color: selected ? theme.colors.text : theme.colors.textMuted }]} numberOfLines={1}>{item.market.replace("KRW-", "")}</Text>
              <Text style={[styles.terrainMove, { color: up ? theme.colors.chartUp : theme.colors.chartDown }]}>{rate(item.changeRate)}</Text>
            </Pressable>;
          })}
        </View>}
    </View>
  </View>;
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
    return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} onPress={() => setPanel(value)} testID={testID}
      style={({ pressed }) => [styles.segment, { backgroundColor: selected ? theme.colors.surfaceRaised : "transparent", borderColor: selected ? theme.colors.borderStrong : "transparent", opacity: pressed ? theme.interaction.pressedOpacity : 1 }]}
    ><Text style={[styles.segmentLabel, { color: selected ? theme.colors.text : theme.colors.textMuted }]}>{label}</Text></Pressable>;
  };

  const watchlist = <WatchlistView error={error} onRefresh={refreshMarketView} rawMarkets={rawMarkets} refreshing={refreshing || selectedChartLoading} repository={repository} selectedMarket={selectedMarket} onSelectMarket={handleSelectMarket} stale={marketsStale} />;
  const chart = <View style={styles.detailWorkspace} testID="market-detail-workspace">
    <ChartView changeRate={changeRate} diagnostic={displayedChartError ? displayedDiagnostic : null} error={displayedChartError ?? error} currentPrice={selectedCurrentPrice} market={selectedMarket} marketConnectionState={marketConnectionState} onRefresh={refreshMarketView} rawCandles={displayedCandles === null ? null : [...displayedCandles]} refreshing={refreshing || selectedChartLoading} stale={displayedStale} />
    <Pressable accessibilityRole="button" onPress={onPaperTrade} style={[styles.paperContext, { borderTopColor: theme.colors.border }]} testID="market-observation-context">
      <View style={styles.paperContextCopy}><Text style={[styles.paperKicker, { color: theme.colors.primary }]}>PAPER CONTEXT</Text><Text style={[styles.paperTitle, { color: theme.colors.text }]}>시장 관측과 PAPER 판단은 분리됩니다</Text><Text style={[styles.paperDetail, { color: theme.colors.textMuted }]}>공개 시세는 읽기 전용입니다. 이 데이터만으로 전략 신호나 주문 권한이 생기지 않습니다.</Text></View>
      <Text style={[styles.chevron, { color: theme.colors.textMuted }]}>›</Text>
    </Pressable>
  </View>;

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    <View style={[styles.top, { maxWidth: tabletWorkspace ? 1080 : 680 }]}>
      <AuthorityRail detail="PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY" status={sourceState} tone={sourceState === "ACTIVE" ? "success" : sourceState === "ERROR" ? "danger" : "warning"} testID="markets-authority-rail" />
      <ScreenLead eyebrow="MARKETS" title={selectedMarket} detail="NUSA가 관측하는 공개 가격 흐름과 데이터 신선도입니다." badge="MARKETS" badgeTone="info" />
      <MetricStrip items={[{ label: "PRICE", value: money(selectedCurrentPrice) }, { label: "CHANGE", value: rate(changeRate), tone: changeRate == null ? "neutral" : changeRate >= 0 ? "success" : "danger" }, { label: "DATA", value: sourceState, tone: sourceState === "ACTIVE" ? "success" : "warning" }]} testID="markets-summary-strip" />
      <MarketTerrain markets={parsedMarkets} selectedMarket={selectedMarket} onSelect={handleSelectMarket} />
      {error ? <StateNotice title="PUBLIC FEED ERROR" detail={error} tone="danger" /> : displayedStale ? <StateNotice title="STALE DATA" detail="표시 중인 공개 시장 데이터가 신선도 기준을 벗어났습니다." tone="warning" /> : null}
    </View>

    {tabletWorkspace ? <View style={styles.tabletWorkspace} testID="markets-tablet-workspace"><View style={styles.tabletPanel} testID="markets-tablet-watchlist">{watchlist}</View><View style={styles.tabletPanel} testID="markets-tablet-chart">{chart}</View></View> : null}
    {!tabletWorkspace ? <View style={[styles.segmentOuter, { paddingHorizontal: width < 380 ? 16 : 20 }]}><View accessibilityRole="tablist" style={[styles.panels, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="markets-panels"><View testID="markets-panel-segmented-control" style={styles.segmentAlias}>{segment("CHART", "차트", "markets-chart-tab")}{segment("WATCHLIST", "시장 목록", "markets-watchlist-tab")}</View></View></View> : null}
    {!tabletWorkspace ? (panel === "WATCHLIST" ? watchlist : chart) : null}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  top: { width: "100%", alignSelf: "center", paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  terrainFrame: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  terrainHeader: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  terrainEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 1.2 },
  terrainDetail: { marginTop: 3, fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.55 },
  terrainSource: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7 },
  terrainGrid: { height: 212, borderTopWidth: 1, position: "relative", overflow: "hidden" },
  terrainAxis: { position: "absolute", left: 12, right: 12, top: 96, height: StyleSheet.hairlineWidth },
  terrainColumns: { flex: 1, flexDirection: "row", paddingHorizontal: 8 },
  terrainColumn: { flex: 1, minWidth: 0, alignItems: "center", paddingTop: 7, paddingHorizontal: 2 },
  terrainGraph: { height: 148, width: "100%", alignItems: "center", justifyContent: "center" },
  terrainHalf: { height: 70, width: "100%", alignItems: "center", justifyContent: "flex-end" },
  terrainHalfDown: { justifyContent: "flex-start" },
  terrainStem: { width: 2, borderRadius: 2 },
  terrainNode: { width: 10, height: 10, borderRadius: 10, borderWidth: 2 },
  terrainCenterTick: { width: 18, height: 1 },
  terrainSymbol: { fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.2 },
  terrainMove: { marginTop: 2, fontSize: 9, lineHeight: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  terrainEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  terrainEmptyText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  segmentOuter: { paddingTop: 9, paddingBottom: 2 },
  tabletWorkspace: { flex: 1, flexDirection: "row", gap: 24, paddingHorizontal: 28, paddingTop: 18 },
  tabletPanel: { flex: 1, minWidth: 0 },
  panels: { flexDirection: "row", padding: 4, borderWidth: 1, borderRadius: 14 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  segmentAlias: { flex: 1, flexDirection: "row" },
  segmentLabel: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  detailWorkspace: { flex: 1, minWidth: 0 },
  paperContext: { minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: 20, marginVertical: 10, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  paperContextCopy: { flex: 1, gap: 3 },
  paperKicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  paperTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  paperDetail: { fontSize: 11, lineHeight: 17 },
  chevron: { fontSize: 24, fontWeight: "700" },
});
