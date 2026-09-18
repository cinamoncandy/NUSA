import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { TerrainSignal } from "./components";
import { useTheme } from "./ThemeProvider";
import { intelligenceFieldColors } from "./designSystem";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { selectHomeMarketData } from "./homeMarketData";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";
import { buildChartViewModel } from "./chartViewModel";

type Snapshot = Extract<PersonalPaperOperationsLoadResult, { status: "READY" }>["snapshot"];
export type HomeDestination = "Markets" | "AiSignal" | "Portfolio";

interface HomeViewProps {
  readonly snapshot: Snapshot | null;
  readonly investmentPercent: number;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  readonly refreshing: boolean;
  readonly publicMarket: string;
  readonly publicMarkets: readonly WatchlistMarket[] | null;
  readonly publicCandles: readonly PublicCandle[] | null;
  readonly publicCurrentPrice: number | null;
  readonly publicMarketConnectionState: string;
  readonly publicMarketStale: boolean;
  readonly onRefresh: () => void;
  readonly onGoSettings: () => void;
  readonly onNavigate: (destination: HomeDestination) => void;
  readonly onOpenPaperLearning: () => void;
}

const LIME = intelligenceFieldColors.terminalSignal;
const INK = "#050706";
const PANEL = "#0A0E0C";
const BORDER = "#1A2A21";
const MUTED = "#819087";
const RED = "#FF6464";

function won(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `₩${Math.round(value).toLocaleString("ko-KR")}`;
}
function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const p = value * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}
function MarketTile({ market }: Readonly<{ market: WatchlistMarket | null }>) {
  const symbol = market?.market.replace("KRW-", "") ?? "—";
  const positive = (market?.changeRate ?? 0) >= 0;
  return <View style={styles.marketTile}>
    <Text style={styles.marketSymbol}>{symbol}</Text>
    <Text style={[styles.marketChange, { color: market == null ? MUTED : positive ? LIME : RED }]}>{pct(market?.changeRate)}</Text>
    <Text style={styles.marketPrice}>{market == null ? "NO DATA" : won(market.price)}</Text>
  </View>;
}
function EvidenceRow({ label, value, tone = "neutral" }: Readonly<{ label: string; value: string; tone?: "lime" | "danger" | "neutral" }>) {
  return <View style={styles.evidenceRow}><Text style={[styles.evidenceLabel, { color: tone === "lime" ? LIME : tone === "danger" ? RED : "#E9F0EC" }]}>{label}</Text><Text style={styles.evidenceValue} numberOfLines={3}>{value}</Text></View>;
}

export function HomeView(props: HomeViewProps) {
  const { theme } = useTheme();
  const localPaperActive = props.snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const cloudAccount = props.snapshot?.portfolio?.account ?? null;
  const localAccount = localPortfolio?.account ?? null;
  const account = cloudAccount ?? localAccount;
  const accountSource = cloudAccount != null ? "CLOUD" : localAccount != null ? "LOCAL" : null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const heartbeat = props.snapshot?.operations.heartbeat;
  const ai = props.snapshot?.ai ?? null;
  const disconnected = props.notConfigured != null && !localPaperActive;
  const marketFeed = selectHomeMarketData(props.publicMarkets, props.snapshot?.markets ?? []);
  const marketRows = [...marketFeed].sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0)).slice(0, 4);
  const marketWave = buildChartViewModel({ market: props.publicMarket, interval: "1m", rawCandles: props.publicCandles === null ? null : [...props.publicCandles], currentPrice: props.publicCurrentPrice, connectionState: props.publicMarketConnectionState, stale: props.publicMarketStale });
  const decision = buildHomeDecisionSurface({
    runtimeState: props.snapshot?.operations.runtimeState,
    health: props.snapshot?.health,
    readyForPaperOperations: props.snapshot?.readyForPaperOperations ?? false,
    disconnected,
    readOnlyError: props.readOnlyError != null,
    accountSource,
    paperEquity: account?.equity,
    paperTotalPnl: totalPnl,
    aiThesis: ai?.status === "AVAILABLE" ? ai.thesis : null,
    aiEvidenceCount: ai?.status === "AVAILABLE" ? ai.evidenceReferences.length : 0,
    aiCalibrationStatus: ai?.calibrationStatus,
    aiConfidence: ai?.confidence,
  });
  const signalAvailable = decision.aiInsightAvailable;
  const signalTitle = signalAvailable ? (ai?.thesis ?? "VERIFIED SIGNAL") : "WAITING FOR VERIFIED SIGNAL";
  const strength = signalAvailable && ai?.confidence != null ? Math.max(0.15, Math.min(0.95, ai.confidence)) : 0.24;

  return <ScrollView
    style={{ backgroundColor: INK }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={LIME} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.topbar} testID="home-master-rail">
      <View><Text style={styles.logo}>NUSA</Text><Text style={styles.tagline}>AI FOR A WEALTHIER YOU</Text></View>
      <View style={styles.modeWrap} testID="home-status-rail">
        <View style={styles.modeDot} />
        <View><Text style={styles.modeText}>PAPER MODE</Text><Text style={styles.modeSub}>LIVE: RESTRICTED</Text></View>
      </View>
    </View>

    <View style={styles.hero}>
      <View style={styles.heroCopy}>
        <Text style={styles.heroLine}>DISCIPLINE</Text><Text style={styles.heroLine}>COMPOUNDS</Text><Text style={styles.heroAccent}>FREEDOM.</Text>
        <Text style={styles.heroKorean}>더 나은 오늘이,{"\n"}더 큰 자유를 만든다.</Text>
      </View>
      <View style={styles.orbit} accessibilityLabel="global market intelligence visual">
        <View style={styles.orbitOuter} /><View style={styles.orbitMid} /><View style={styles.orbitCore} />
        <Text style={styles.orbitText}>GLOBAL{"\n"}MARKETS{"\n"}REAL-TIME{"\n"}WITH AI</Text>
      </View>
    </View>

    <View style={styles.marketStrip} testID="home-market-pulse">
      {[0,1,2,3].map((i) => <MarketTile key={marketRows[i]?.market ?? i} market={marketRows[i] ?? null} />)}
    </View>

    <Pressable onPress={() => props.onNavigate("AiSignal")} style={({ pressed }) => [styles.signalPanel, { opacity: pressed ? 0.84 : 1 }]} testID="ai-card">
      <View style={styles.panelTitleRow}><Text style={styles.panelTitle}>◉ SIGNAL TERRAIN</Text><Text style={styles.arrow}>›</Text></View>
      <View style={styles.terrain} testID="home-decision-stage">
        <View style={styles.gridH1}/><View style={styles.gridH2}/><View style={styles.gridV1}/><View style={styles.gridV2}/>
        <TerrainSignal variant="symbolic" signalStrength={strength} accessibilityLabel={signalAvailable ? "verified AI signal terrain" : "signal unavailable"} testID="home-signal-trace" />
        <View style={styles.signalPin}><View style={styles.pinDot}/><Text style={styles.pinLabel}>{signalAvailable ? "VERIFIED AI SIGNAL" : "NO VERIFIED SIGNAL"}</Text></View>
      </View>
      <Text style={styles.signalThesis} numberOfLines={2}>{signalTitle}</Text>
      <View style={styles.evidenceRail}>
        <EvidenceRow label="WHY" value={decision.why} tone="lime" />
        <EvidenceRow label="RESULT" value={decision.result} tone="lime" />
        <EvidenceRow label="RISK" value={decision.risk} tone={decision.attention === "ACTION REQUIRED" ? "danger" : "neutral"} />
        <View testID="home-supervisor-learning"><EvidenceRow label="LEARNING" value={decision.learning} /></View>
      </View>
    </Pressable>

    <View style={styles.panel} testID="home-top-signals">
      <View style={styles.panelTitleRow}><Text style={styles.panelTitle}>TODAY'S TOP SIGNALS</Text><Text style={styles.count}>{marketRows.length}</Text></View>
      {marketRows.length === 0 ? <Text style={styles.empty}>검증된 public market signal이 없습니다.</Text> : marketRows.slice(0,3).map((market, index) => {
        const up = (market.changeRate ?? 0) >= 0;
        return <Pressable key={market.market} onPress={() => props.onNavigate("Markets")} style={styles.signalRow}>
          <Text style={styles.rank}>{index + 1}</Text>
          <Text style={styles.asset}>{market.market.replace("KRW-", "")}</Text>
          <View style={[styles.signalBadge, { borderColor: up ? LIME : RED }]}><Text style={[styles.signalBadgeText,{color:up?LIME:RED}]}>{up ? "UP" : "DOWN"}</Text></View>
          <Text style={[styles.rowChange,{color:up?LIME:RED}]}>{pct(market.changeRate)}</Text>
        </Pressable>;
      })}
    </View>

    <Pressable onPress={() => props.onNavigate("Portfolio")} style={styles.panel} testID="home-paper-performance">
      <View style={styles.panelTitleRow}><Text style={styles.panelTitle}>PAPER PERFORMANCE</Text><Text style={styles.source}>{accountSource ? `${accountSource} PAPER` : "NO LINK"}</Text></View>
      <View style={styles.performanceGraph}>
        {marketWave.state === "READY" ? marketWave.bars.slice(-22).map((bar,index) => {
          const range = Math.max(0.000001, bar.high - bar.low);
          const rise = bar.close >= bar.open;
          return <View key={bar.openTime} style={[styles.waveBar,{height:12+Math.min(38, range/Math.max(1,bar.close)*8000), backgroundColor:rise?LIME:"#406A54", opacity:0.55 + index/50}]}/>;
        }) : <Text style={styles.empty}>VERIFIED PERFORMANCE WAVE UNAVAILABLE</Text>}
      </View>
      <View style={styles.performanceMetrics} testID="account-hero-card">
        <View><Text style={[styles.metricValue,{color:totalPnl != null && totalPnl >= 0?LIME:totalPnl == null?MUTED:RED}]}>{totalPnl == null ? "—" : won(totalPnl)}</Text><Text style={styles.metricLabel}>TOTAL P&L</Text></View>
        <View><Text style={styles.metricValue}>{won(account?.equity)}</Text><Text style={styles.metricLabel}>EQUITY</Text></View>
        <View><Text style={styles.metricValue}>{heartbeat?.paperOrderCount ?? "—"}</Text><Text style={styles.metricLabel}>ORDERS</Text></View>
        <View><Text style={styles.metricValue}>{heartbeat?.paperFillCount ?? "—"}</Text><Text style={styles.metricLabel}>FILLS</Text></View>
      </View>
    </Pressable>

    {disconnected || props.readOnlyError ? <Pressable onPress={props.onGoSettings} style={styles.connectionNotice} testID="home-operational-notice"><Text style={styles.connectionTitle}>{disconnected ? "PAPER CONNECTION REQUIRED" : "PAPER READ-ONLY ERROR"}</Text><Text style={styles.connectionBody}>{props.notConfigured ?? props.readOnlyError}</Text><Text style={styles.connectionAction}>OPEN SETTINGS →</Text></Pressable> : null}

    <View style={styles.hiddenContract} testID="home-paper-learning"><Pressable onPress={props.onOpenPaperLearning}><Text style={styles.learningLink}>PAPER LEARNING EVIDENCE →</Text></Pressable></View>
    <View style={styles.hiddenContract} testID="home-risk-authority"><Text style={styles.safety}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content:{paddingHorizontal:16,paddingTop:12,paddingBottom:34,gap:14,width:"100%",maxWidth:720,alignSelf:"center",backgroundColor:INK},
  topbar:{minHeight:60,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER,paddingBottom:10},
  logo:{color:"#F5F8F6",fontSize:27,fontWeight:"900",letterSpacing:2.7},tagline:{color:MUTED,fontSize:7,fontWeight:"700",letterSpacing:1.4,marginTop:-2},
  modeWrap:{flexDirection:"row",alignItems:"center",gap:7},modeDot:{width:9,height:9,borderRadius:9,backgroundColor:LIME,shadowColor:LIME,shadowOpacity:.6,shadowRadius:8},
  modeText:{color:"#CDEDD9",fontSize:10,fontWeight:"800",letterSpacing:.7},modeSub:{color:"#739386",fontSize:8,marginTop:2},
  hero:{minHeight:190,flexDirection:"row",alignItems:"center",justifyContent:"space-between",overflow:"hidden"},
  heroCopy:{zIndex:2,flex:1},heroLine:{color:"#EAF2EE",fontSize:29,lineHeight:34,fontWeight:"500",letterSpacing:2.2},heroAccent:{color:LIME,fontSize:29,lineHeight:35,fontWeight:"900",letterSpacing:2.1},
  heroKorean:{color:"#A4B3AB",fontSize:13,lineHeight:20,marginTop:16},
  orbit:{width:160,height:160,marginRight:-28,alignItems:"center",justifyContent:"center"},orbitOuter:{position:"absolute",width:148,height:148,borderRadius:148,borderWidth:1,borderColor:"#294D38"},orbitMid:{position:"absolute",width:112,height:112,borderRadius:112,borderWidth:1,borderColor:"#1D392A",transform:[{scaleY:.55}]},orbitCore:{position:"absolute",width:76,height:76,borderRadius:76,backgroundColor:"#0C1711",borderWidth:1,borderColor:LIME,opacity:.5},
  orbitText:{position:"absolute",right:8,bottom:18,color:"#6F8D7C",fontSize:8,lineHeight:12,fontWeight:"700",letterSpacing:.7},
  marketStrip:{flexDirection:"row",gap:7},marketTile:{flex:1,minWidth:0,padding:10,borderWidth:1,borderColor:BORDER,borderRadius:7,backgroundColor:PANEL},
  marketSymbol:{color:"#E7EEE9",fontSize:11,fontWeight:"800"},marketChange:{fontSize:14,fontWeight:"800",marginTop:7},marketPrice:{color:"#89988F",fontSize:8,marginTop:5,fontVariant:["tabular-nums"]},
  signalPanel:{borderWidth:1,borderColor:"#285E3C",borderRadius:9,backgroundColor:"#070A08",overflow:"hidden"},
  panel:{borderWidth:1,borderColor:BORDER,borderRadius:9,backgroundColor:PANEL,overflow:"hidden"},
  panelTitleRow:{height:44,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},
  panelTitle:{color:"#E9F0EC",fontSize:13,fontWeight:"800",letterSpacing:1},arrow:{color:LIME,fontSize:25,fontWeight:"300"},count:{color:"#C7D3CC",fontSize:13},source:{color:"#71877B",fontSize:9,fontWeight:"800"},
  terrain:{height:190,position:"relative",justifyContent:"center",overflow:"hidden",backgroundColor:"#050806"},gridH1:{position:"absolute",left:0,right:0,top:"33%",height:1,backgroundColor:"#112219"},gridH2:{position:"absolute",left:0,right:0,top:"66%",height:1,backgroundColor:"#112219"},gridV1:{position:"absolute",top:0,bottom:0,left:"33%",width:1,backgroundColor:"#112219"},gridV2:{position:"absolute",top:0,bottom:0,left:"66%",width:1,backgroundColor:"#112219"},
  signalPin:{position:"absolute",left:"43%",top:"42%",alignItems:"center"},pinDot:{width:14,height:14,borderRadius:14,backgroundColor:LIME,borderWidth:4,borderColor:"#A0CF52",shadowColor:LIME,shadowOpacity:.9,shadowRadius:12},pinLabel:{marginTop:5,color:LIME,fontSize:8,fontWeight:"900",backgroundColor:"#0D2114",paddingHorizontal:6,paddingVertical:4,borderRadius:4,borderWidth:1,borderColor:"#2C703F"},
  signalThesis:{color:"#DDE9E2",fontSize:15,lineHeight:21,fontWeight:"700",paddingHorizontal:14,paddingVertical:11,borderTopWidth:1,borderTopColor:BORDER},
  evidenceRail:{borderTopWidth:1,borderTopColor:BORDER},evidenceRow:{flexDirection:"row",gap:10,paddingHorizontal:14,paddingVertical:10,borderBottomWidth:1,borderBottomColor:"#121D17"},evidenceLabel:{width:60,fontSize:9,fontWeight:"900",letterSpacing:.8},evidenceValue:{flex:1,color:"#A9B7AF",fontSize:10,lineHeight:15},
  signalRow:{minHeight:48,flexDirection:"row",alignItems:"center",paddingHorizontal:13,gap:10,borderBottomWidth:1,borderBottomColor:"#121D17"},rank:{width:22,height:22,borderRadius:22,borderWidth:1,borderColor:"#3A4C42",color:"#DDE7E1",textAlign:"center",lineHeight:20,fontSize:9},asset:{color:"#EEF5F1",fontSize:13,fontWeight:"800",width:54},signalBadge:{borderWidth:1,borderRadius:5,paddingHorizontal:7,paddingVertical:4},signalBadgeText:{fontSize:8,fontWeight:"900"},rowChange:{marginLeft:"auto",fontSize:11,fontWeight:"800",fontVariant:["tabular-nums"]},
  empty:{color:MUTED,fontSize:10,padding:14},performanceGraph:{height:74,flexDirection:"row",alignItems:"flex-end",gap:3,paddingHorizontal:14,paddingTop:12,borderBottomWidth:1,borderBottomColor:BORDER},waveBar:{flex:1,minWidth:2,borderRadius:2},
  performanceMetrics:{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:14,paddingVertical:14,gap:10},metricValue:{color:"#EDF4F0",fontSize:13,fontWeight:"800",fontVariant:["tabular-nums"]},metricLabel:{color:"#66786E",fontSize:8,fontWeight:"700",marginTop:5},
  connectionNotice:{padding:13,borderWidth:1,borderColor:"#57342F",borderRadius:8,backgroundColor:"#140B09"},connectionTitle:{color:RED,fontSize:10,fontWeight:"900"},connectionBody:{color:"#B8A7A3",fontSize:10,lineHeight:15,marginTop:5},connectionAction:{color:"#E4B3A9",fontSize:9,fontWeight:"800",marginTop:8},
  hiddenContract:{paddingHorizontal:4,paddingVertical:3},learningLink:{color:"#61756A",fontSize:8,fontWeight:"700",letterSpacing:.6},safety:{color:"#4E6458",fontSize:8,textAlign:"center",letterSpacing:.7},
});
