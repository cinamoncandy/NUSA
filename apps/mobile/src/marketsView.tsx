import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { TerrainSignal } from "./components";
import { ChartView } from "./chartView";
import type { PublicCandle } from "./chartViewModel";
import { WatchlistView } from "./watchlistView";
import { parseWatchlistMarkets, type WatchlistMarket, type WatchlistRepository } from "./watchlist";
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
  const meanMove = terrainMarkets.length === 0 ? 0 : terrainMarkets.reduce((sum,item)=>sum+Math.abs(item.changeRate ?? 0),0)/terrainMarkets.length;
  const strength = Math.max(0.3, Math.min(1, 0.3 + meanMove * 18));

  return <View style={[styles.terrainFrame, { backgroundColor: theme.colors.surfaceSunken, borderColor: theme.colors.borderStrong }]} testID="markets-terrain">
    <View style={styles.terrainHeader}>
      <View style={styles.terrainHeaderLead}>
        <Text style={[styles.terrainEyebrow, { color: theme.colors.aiSignalEnd }]}>MARKET TERRAIN</Text>
        <Text style={[styles.terrainDetail, { color: theme.colors.textMuted }]}>VERIFIED UPBIT PUBLIC MOVE · NO PREDICTION</Text>
      </View>
      <Text style={[styles.terrainSource, { color: theme.colors.textMuted }]}>UPBIT PUBLIC</Text>
    </View>
    <View style={styles.terrainGrid}>
      {terrainMarkets.length === 0
        ? <View style={styles.terrainEmpty}><Text style={[styles.terrainEmptyText, { color: theme.colors.textMuted }]}>NO VERIFIED PUBLIC DATA</Text></View>
        : <>
          <TerrainSignal variant="market" signalStrength={strength} accessibilityLabel="verified Upbit public market terrain" />
          <View style={styles.terrainColumns}>
            {terrainMarkets.map((item) => {
              const move=item.changeRate ?? 0;
              const up=move>=0;
              const selected=item.market===selectedMarket;
              return <Pressable key={item.market} accessibilityRole="button" accessibilityLabel={`${item.market} ${rate(item.changeRate)}`} onPress={()=>onSelect(item.market)} style={({pressed})=>[styles.terrainColumn,{borderColor:selected?theme.colors.aiSignalMid:"transparent",opacity:pressed?theme.interaction.pressedOpacity:1}]} testID={`market-terrain-${item.market}`}>
                <Text style={[styles.terrainSymbol,{color:selected?theme.colors.text:theme.colors.textMuted}]} numberOfLines={1}>{item.market.replace("KRW-","")}</Text>
                <Text style={[styles.terrainMove,{color:up?theme.colors.chartUp:theme.colors.chartDown}]}>{rate(item.changeRate)}</Text>
              </Pressable>;
            })}
          </View>
        </>}
    </View>
  </View>;
}

function MarketGlobe({ markets }: Readonly<{ markets: readonly WatchlistMarket[] }>) {
  const { theme } = useTheme();
  const rows=markets.slice(0,4);
  return <View style={styles.globeHero} testID="market-globe-hero">
    <View style={styles.globeGlow}/>
    <View style={styles.globeSphere}>
      <View style={styles.globeLatA}/><View style={styles.globeLatB}/><View style={styles.globeLonA}/><View style={styles.globeLonB}/>
      <View style={[styles.globeNode,{left:"28%",top:"42%",backgroundColor:theme.colors.aiSignalEnd}]}/><View style={[styles.globeNode,{left:"57%",top:"35%",backgroundColor:theme.colors.primary}]}/><View style={[styles.globeNode,{left:"73%",top:"58%",backgroundColor:theme.colors.aiSignalMid}]}/>
      <Text style={[styles.globeLabel,{left:"20%",top:"49%"}]}>US</Text><Text style={[styles.globeLabel,{left:"54%",top:"42%"}]}>EU</Text><Text style={[styles.globeLabel,{right:"11%",top:"64%"}]}>ASIA</Text>
    </View>
    <View style={styles.globeCaption}><Text style={styles.globeCaptionTitle}>Global Markets</Text><Text style={styles.globeCaptionSub}>{rows.length>0?"Verified public observations":"NO VERIFIED PUBLIC DATA"}</Text></View>
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
          backgroundColor: pressed ? theme.colors.primarySoft : "transparent",
          borderBottomColor: selected ? theme.colors.primary : "transparent",
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
      <View style={styles.marketReferenceHeader} testID="market-reference-header">
        <View><Text style={[styles.marketReferenceTitle,{color:theme.colors.text}]}>Market</Text><Text style={[styles.marketReferenceSub,{color:theme.colors.textMuted}]}>Global markets at a glance</Text></View>
        <Text style={[styles.marketReferenceSource,{color:theme.colors.textMuted}]}>UPBIT PUBLIC</Text>
      </View>
      <View style={styles.marketReferenceTabs} testID="market-reference-tabs">
        {["Overview","Indices","Sectors","Assets"].map((label,index)=><View key={label} style={[styles.marketReferenceTab,index===0?{borderBottomColor:theme.colors.primary}:null]}><Text style={[styles.marketReferenceTabText,{color:index===0?theme.colors.text:theme.colors.textMuted}]}>{label}</Text></View>)}
      </View>
      <MarketGlobe markets={parsedMarkets}/>
      <View style={styles.marketReferenceList} testID="market-reference-list">
        {(parsedMarkets.length?parsedMarkets.slice(0,4):[null,null,null,null]).map((item,index)=>{
          const up=item!=null&&(item.changeRate??0)>=0;
          return <Pressable key={item?.market??index} disabled={item==null} onPress={()=>item&&handleSelectMarket(item.market)} style={styles.marketReferenceRow}>
            <View style={styles.marketReferenceIcon}><Text style={styles.marketReferenceIconText}>{item?.market.replace("KRW-","").slice(0,1)??"—"}</Text></View>
            <View style={styles.marketReferenceRowMain}><Text style={[styles.marketReferenceSymbol,{color:theme.colors.text}]}>{item?.market.replace("KRW-","")??"NO DATA"}</Text><Text style={[styles.marketReferencePrice,{color:theme.colors.textMuted}]}>{item?money(item.price):"—"}</Text></View>
            <Text style={[styles.marketReferenceMove,{color:item==null?theme.colors.textMuted:up?theme.colors.chartUp:theme.colors.chartDown}]}>{item?rate(item.changeRate):"—"}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={[styles.marketSafety,{color:theme.colors.textMuted}]}>REAL DATA ONLY · NO PREDICTION · PAPER SEPARATE</Text>

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
  marketReferenceHeader:{paddingTop:6,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",gap:12},
  marketReferenceTitle:{fontSize:30,lineHeight:36,fontWeight:"700",letterSpacing:-.7},marketReferenceSub:{fontSize:9,lineHeight:13,marginTop:3},marketReferenceSource:{fontSize:8,fontWeight:"800",letterSpacing:.8},
  marketReferenceTabs:{height:40,flexDirection:"row",alignItems:"stretch",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#1B2830"},marketReferenceTab:{marginRight:22,justifyContent:"center",borderBottomWidth:2,borderBottomColor:"transparent"},marketReferenceTabText:{fontSize:10,fontWeight:"700"},
  globeHero:{height:260,borderRadius:20,overflow:"hidden",position:"relative",backgroundColor:"#06101A",borderWidth:1,borderColor:"#1A2B38",alignItems:"center",justifyContent:"center"},
  globeGlow:{position:"absolute",width:245,height:245,borderRadius:245,backgroundColor:"#76C7FF",opacity:.08,shadowColor:"#7FE6B0",shadowOpacity:.4,shadowRadius:35},
  globeSphere:{width:210,height:210,borderRadius:210,borderWidth:1,borderColor:"#39586C",backgroundColor:"#0A1722",overflow:"hidden",position:"relative"},
  globeLatA:{position:"absolute",left:-5,right:-5,top:58,height:76,borderRadius:110,borderWidth:1,borderColor:"#23455B"},globeLatB:{position:"absolute",left:-5,right:-5,top:84,height:42,borderRadius:110,borderWidth:1,borderColor:"#23455B"},
  globeLonA:{position:"absolute",top:-4,bottom:-4,left:66,width:78,borderRadius:90,borderWidth:1,borderColor:"#23455B"},globeLonB:{position:"absolute",top:-4,bottom:-4,left:88,width:34,borderRadius:90,borderWidth:1,borderColor:"#23455B"},
  globeNode:{position:"absolute",width:8,height:8,borderRadius:8,shadowColor:"#DDF9A8",shadowOpacity:.8,shadowRadius:8},globeLabel:{position:"absolute",color:"#D7DEE0",fontSize:8,fontWeight:"800"},
  globeCaption:{position:"absolute",left:16,bottom:14},globeCaptionTitle:{color:"#F4F7F6",fontSize:13,fontWeight:"700"},globeCaptionSub:{color:"#7D8A90",fontSize:8,marginTop:2},
  marketReferenceList:{gap:7},marketReferenceRow:{minHeight:58,borderRadius:12,borderWidth:1,borderColor:"#1B2A33",backgroundColor:"#0B1218",paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:11},
  marketReferenceIcon:{width:30,height:30,borderRadius:30,backgroundColor:"#16232C",alignItems:"center",justifyContent:"center"},marketReferenceIconText:{color:"#C7D2D6",fontSize:11,fontWeight:"800"},
  marketReferenceRowMain:{flex:1},marketReferenceSymbol:{fontSize:12,fontWeight:"800"},marketReferencePrice:{fontSize:9,fontVariant:["tabular-nums"],marginTop:2},marketReferenceMove:{fontSize:11,fontWeight:"800",fontVariant:["tabular-nums"]},
  marketSafety:{textAlign:"center",fontSize:7,fontWeight:"800",letterSpacing:1.1,paddingVertical:4},
  workspace: { flex: 1, width: "100%", maxWidth: uxLayout.maxWorkspaceWidth, alignSelf: "center" },
  top: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 10, gap: 10 },
  marketHero: { paddingTop: 12, paddingBottom: 4, gap: 12 },
  // flexWrap plus a flexible lead column: heroTitle used to carry maxWidth 330 while the row is
  // only ~320dp wide on a 360dp screen, so the lead column claimed more than the row had and the
  // badge was pushed past the right edge ("UPBIT PUBLIC · VERIFIED" rendered as "UPBIT PUBLI").
  // Now the badge drops to its own line instead of off-screen.
  heroTopRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  heroLead: { flex: 1, minWidth: 220 },
  heroEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.35 },
  heroTitle: { fontSize: 24, lineHeight: 32, fontWeight: "700", letterSpacing: -0.4, marginTop: 4 },
  heroMarket: { fontSize: 9, lineHeight: 13, fontWeight: "700", letterSpacing: 0.8, marginTop: 1 },
  sourceBadge: { minHeight: 32, maxWidth: 190, flexShrink: 0, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
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
  referenceFilterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  referenceFilter: { minHeight: 34, borderWidth: 1, borderRadius: 8, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  referenceFilterText: { fontSize: 9, lineHeight: 12, fontWeight: "800" },
  referenceState: { minHeight: 30, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  referenceStateText: { fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 0.6 },
  terrainFrame: { borderWidth: 1, borderRadius: 24, overflow: "hidden" },
  terrainHeader: { minHeight: 64, paddingHorizontal: 18, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  terrainHeaderLead: { flex: 1, minWidth: 0 },
  terrainEyebrow: { fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 1.3 },
  terrainDetail: { marginTop: 4, fontSize: 8, lineHeight: 12, fontWeight: "700", letterSpacing: 0.55 },
  // flexShrink 0: terrainHeader is a space-between row whose left column carries a 41-character
  // detail line, which squeezed this sibling until the last glyph was cut ("UPBIT PUBLI").
  // paddingRight absorbs the trailing letterSpacing, which Android excludes from measured width.
  terrainSource: { fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7, flexShrink: 0, paddingRight: 1 },
  terrainGrid: { height: 310, position: "relative", overflow: "hidden" },
  terrainColumns: { position:"absolute",left:10,right:10,bottom:12,flexDirection:"row",gap:5 },
  terrainColumn: { flex:1,minWidth:0,alignItems:"center",justifyContent:"center",paddingVertical:7,paddingHorizontal:3,borderWidth:1,borderRadius:10,backgroundColor:"rgba(5,7,16,0.72)" },
  terrainSymbol: { fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.2 },
  terrainMove: { marginTop: 2, fontSize: 9, lineHeight: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  terrainEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  terrainEmptyText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  segmentOuter: { paddingTop: 9, paddingBottom: 2 },
  tabletWorkspace: { flex: 1, flexDirection: "row", gap: 20, paddingHorizontal: 24, paddingTop: 14 },
  tabletPanel: { flex: 1, minWidth: 0 },
  panels: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 0 },
  segment: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, paddingHorizontal: 12 },
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
