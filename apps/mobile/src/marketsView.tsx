import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { ChartView } from "./chartView";
import type { PublicCandle } from "./chartViewModel";
import { WatchlistView } from "./watchlistView";
import { parseWatchlistMarkets, type WatchlistRepository } from "./watchlist";
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
    <Pressable accessibilityRole="button" onPress={onPaperTrade} style={[styles.paperContext, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="market-observation-context">
      <View style={styles.paperContextCopy}><Text style={[styles.paperKicker, { color: theme.colors.primary }]}>PAPER CONTEXT</Text><Text style={[styles.paperTitle, { color: theme.colors.text }]}>이 시장은 관찰 데이터입니다</Text><Text style={[styles.paperDetail, { color: theme.colors.textMuted }]}>전략 신호나 주문 권한으로 자동 승격되지 않습니다. PAPER 감독 화면에서 실행 상태를 별도로 확인하세요.</Text></View>
      <Text style={[styles.chevron, { color: theme.colors.textMuted }]}>›</Text>
    </Pressable>
  </View>;

  return <View style={[styles.workspace, { backgroundColor: theme.colors.background }]} testID="markets-workspace">
    <View style={[styles.top, { maxWidth: tabletWorkspace ? 1080 : 680 }]}>
      <AuthorityRail detail="PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY" status={sourceState} tone={sourceState === "ACTIVE" ? "success" : sourceState === "ERROR" ? "danger" : "warning"} testID="markets-authority-rail" />
      <ScreenLead eyebrow="MARKETS" title={selectedMarket} detail="공개 시세를 관찰합니다. 관찰 데이터와 NUSA의 전략 판단을 분리해 표시합니다." badge="OBSERVE" badgeTone="info" />
      <MetricStrip items={[{ label: "PRICE", value: money(selectedCurrentPrice) }, { label: "CHANGE", value: rate(changeRate), tone: changeRate == null ? "neutral" : changeRate >= 0 ? "success" : "danger" }, { label: "FEED", value: sourceState, tone: sourceState === "ACTIVE" ? "success" : "warning" }]} testID="markets-summary-strip" />
      {error ? <StateNotice title="PUBLIC FEED ERROR" detail={error} tone="danger" /> : displayedStale ? <StateNotice title="STALE DATA" detail="표시 중인 공개 시장 데이터가 신선도 기준을 벗어났습니다." tone="warning" /> : null}
    </View>

    {tabletWorkspace ? <View style={styles.tabletWorkspace} testID="markets-tablet-workspace"><View style={styles.tabletPanel} testID="markets-tablet-watchlist">{watchlist}</View><View style={styles.tabletPanel} testID="markets-tablet-chart">{chart}</View></View> : null}
    {!tabletWorkspace ? <View style={[styles.segmentOuter, { paddingHorizontal: width < 380 ? 16 : 20 }]}><View accessibilityRole="tablist" style={[styles.panels, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.border }]} testID="markets-panels"><View testID="markets-panel-segmented-control" style={styles.segmentAlias}>{segment("CHART", "관찰 상세", "markets-chart-tab")}{segment("WATCHLIST", "관찰 목록", "markets-watchlist-tab")}</View></View></View> : null}
    {!tabletWorkspace ? (panel === "WATCHLIST" ? watchlist : chart) : null}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  top: { width: "100%", alignSelf: "center", paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  segmentOuter: { paddingTop: 14, paddingBottom: 2 },
  tabletWorkspace: { flex: 1, flexDirection: "row", gap: 24, paddingHorizontal: 28, paddingTop: 18 },
  tabletPanel: { flex: 1, minWidth: 0 },
  panels: { flexDirection: "row", padding: 4, borderWidth: 1, borderRadius: 14 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  segmentAlias: { flex: 1, flexDirection: "row" },
  segmentLabel: { fontSize: 12, lineHeight: 17, fontWeight: "850" },
  detailWorkspace: { flex: 1, minWidth: 0 },
  paperContext: { minHeight: 84, borderWidth: 1, borderRadius: 16, marginHorizontal: 20, marginVertical: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  paperContextCopy: { flex: 1, gap: 3 },
  paperKicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  paperTitle: { fontSize: 14, lineHeight: 19, fontWeight: "850" },
  paperDetail: { fontSize: 10, lineHeight: 16 },
  chevron: { fontSize: 24, fontWeight: "700" },
});
