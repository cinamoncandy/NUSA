import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TerrainSignal } from "./components";
import { useTheme } from "./ThemeProvider";
import { intelligenceFieldColors } from "./designSystem";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildHomeDecisionSurface } from "./homeDecisionSurface";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { createCashInvestmentEnvelope } from "./capitalAllocationGuard";
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
function GlobeVisual() {
  return <View style={styles.globeWrap} accessible accessibilityRole="image" accessibilityLabel="NUSA global market intelligence globe">
    <View style={styles.globeGlow} />
    <View style={styles.globeSphere}>
      <View style={[styles.globeLongitude, styles.globeLongitudeA]} />
      <View style={[styles.globeLongitude, styles.globeLongitudeB]} />
      <View style={[styles.globeLatitude, styles.globeLatitudeA]} />
      <View style={[styles.globeLatitude, styles.globeLatitudeB]} />
      <View style={[styles.globeLatitude, styles.globeLatitudeC]} />
      <View style={styles.globeLandA} /><View style={styles.globeLandB} /><View style={styles.globeLandC} />
      <View style={[styles.globeNode, styles.globeNodeA]} /><View style={[styles.globeNode, styles.globeNodeB]} /><View style={[styles.globeNode, styles.globeNodeC]} />
    </View>
    <Text style={styles.orbitText}>GLOBAL{String.fromCharCode(10)}MARKETS{String.fromCharCode(10)}REAL-TIME{String.fromCharCode(10)}WITH AI</Text>
  </View>;
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
  const cashEnvelope = account == null ? null : createCashInvestmentEnvelope(account.cash, props.investmentPercent);
  const heartbeat = props.snapshot?.operations.heartbeat;
  const ai = props.snapshot?.ai ?? null;
  const disconnected = props.notConfigured != null && !localPaperActive;
  const marketFeed = selectHomeMarketData(props.publicMarkets, props.snapshot?.markets ?? []);
  // A tablet has the width to carry more verified observation without crowding, and the rebuilt
  // HOME lost that. The phone layout stays at the four market tiles the approved design specifies.
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const marketRows = [...marketFeed].sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0)).slice(0, tablet ? 6 : 4);
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
    contentContainerStyle={[styles.content, { maxWidth: tablet ? 980 : 720 }]}
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
        <Text style={styles.heroKorean}>더 나은 오늘이,{String.fromCharCode(10)}더 큰 자유를 만든다.</Text>
      </View>
      <GlobeVisual />
    </View>

    <View testID="home-market-pulse">
      <View style={styles.marketStripHead}>
        <Text style={styles.marketStripTitle}>MARKET PULSE</Text>
        {/* Public market numbers carry their source on screen. A price with no stated origin is
            indistinguishable from a fabricated one, and PAPER PERFORMANCE already names its own. */}
        <Text style={styles.source}>{marketRows.length === 0 ? "UNAVAILABLE" : "UPBIT PUBLIC"}</Text>
      </View>
      <View style={styles.marketStrip}>
        {(tablet ? [0,1,2,3,4,5] : [0,1,2,3]).map((i) => <MarketTile key={marketRows[i]?.market ?? i} market={marketRows[i] ?? null} />)}
      </View>
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
      {marketRows.length === 0 ? <Text style={styles.empty}>검증된 public market signal이 없습니다.</Text> : marketRows.slice(0, tablet ? 5 : 3).map((market, index) => {
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

    <View style={styles.capitalLimits} testID="home-capital-limits">
      <View>
        <Text style={styles.capitalLabel}>CAPITAL LIMITS</Text>
        <Text style={styles.capitalMeta}>PAPER BUY ENVELOPE · {props.investmentPercent}%</Text>
      </View>
      <View style={styles.capitalValues}>
        <View testID="home-investable-cash">
          <Text style={styles.capitalValue}>{cashEnvelope == null ? "—" : won(cashEnvelope.investableCash)}</Text>
          <Text style={styles.capitalKey}>INVESTABLE</Text>
        </View>
        <View testID="home-reserved-cash">
          <Text style={styles.capitalValue}>{cashEnvelope == null ? "—" : won(cashEnvelope.reservedCash)}</Text>
          <Text style={styles.capitalKey}>RESERVED</Text>
        </View>
      </View>
    </View>

    {disconnected || props.readOnlyError ? <Pressable onPress={props.onGoSettings} style={styles.connectionNotice} testID="home-operational-notice"><Text style={styles.connectionTitle}>{disconnected ? "PAPER CONNECTION REQUIRED" : "PAPER READ-ONLY ERROR"}</Text><Text style={styles.connectionBody}>{props.notConfigured ?? props.readOnlyError}</Text><Text style={styles.connectionAction}>OPEN SETTINGS →</Text></Pressable> : null}

    <View style={styles.hiddenContract} testID="home-paper-learning"><Pressable onPress={props.onOpenPaperLearning}><Text style={styles.learningLink}>PAPER LEARNING EVIDENCE →</Text></Pressable></View>
    <View style={styles.hiddenContract} testID="home-risk-authority"><Text style={styles.safety}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content:{paddingHorizontal:16,paddingTop:12,paddingBottom:34,gap:14,width:"100%",alignSelf:"center",backgroundColor:INK},
  topbar:{minHeight:60,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER,paddingBottom:10},
  logo:{color:"#F5F8F6",fontSize:27,fontWeight:"900",letterSpacing:2.7},tagline:{color:MUTED,fontSize:7,fontWeight:"700",letterSpacing:1.4,marginTop:-2},
  modeWrap:{flexDirection:"row",alignItems:"center",gap:7},modeDot:{width:9,height:9,borderRadius:9,backgroundColor:LIME,shadowColor:LIME,shadowOpacity:.6,shadowRadius:8},
  modeText:{color:"#CDEDD9",fontSize:10,fontWeight:"800",letterSpacing:.7},modeSub:{color:"#739386",fontSize:8,marginTop:2},
  hero:{minHeight:178,flexDirection:"row",alignItems:"center",justifyContent:"space-between",overflow:"hidden"},
  heroCopy:{zIndex:2,flex:1},heroLine:{color:"#EAF2EE",fontSize:27,lineHeight:31,fontWeight:"500",letterSpacing:2.2},heroAccent:{color:LIME,fontSize:27,lineHeight:32,fontWeight:"900",letterSpacing:2.1},
  heroKorean:{color:"#A4B3AB",fontSize:13,lineHeight:20,marginTop:16},
  globeWrap:{width:160,height:164,marginRight:-4,alignItems:"center",justifyContent:"center",position:"relative"},globeGlow:{position:"absolute",width:142,height:142,borderRadius:142,backgroundColor:"#0B1810",opacity:.72,shadowColor:LIME,shadowOpacity:.22,shadowRadius:28},globeSphere:{width:142,height:142,borderRadius:142,borderWidth:1,borderColor:"#355943",backgroundColor:"#07100B",overflow:"hidden",position:"relative"},globeLongitude:{position:"absolute",top:-2,bottom:-2,left:"50%",width:56,marginLeft:-28,borderRadius:56,borderWidth:1,borderColor:"#183A26"},globeLongitudeA:{transform:[{scaleX:.55}]},globeLongitudeB:{transform:[{scaleX:1.45}]},globeLatitude:{position:"absolute",left:-4,right:-4,height:46,borderRadius:80,borderWidth:1,borderColor:"#173823"},globeLatitudeA:{top:15},globeLatitudeB:{top:48},globeLatitudeC:{top:81},globeLandA:{position:"absolute",left:77,top:35,width:34,height:18,borderRadius:8,backgroundColor:"#173923",transform:[{rotate:"-18deg"}]},globeLandB:{position:"absolute",left:67,top:54,width:20,height:35,borderRadius:7,backgroundColor:"#204C2D",transform:[{rotate:"17deg"}]},globeLandC:{position:"absolute",left:98,top:77,width:17,height:12,borderRadius:6,backgroundColor:"#285D36"},globeNode:{position:"absolute",width:4,height:4,borderRadius:4,backgroundColor:LIME,shadowColor:LIME,shadowOpacity:.9,shadowRadius:5},globeNodeA:{left:84,top:47},globeNodeB:{left:99,top:82},globeNodeC:{left:71,top:69},
  orbitText:{position:"absolute",right:2,bottom:8,color:"#82998B",fontSize:7,lineHeight:10,fontWeight:"800",letterSpacing:.55,textAlign:"right"},
  marketStrip:{flexDirection:"row",gap:7},marketTile:{flex:1,minWidth:0,padding:10,borderWidth:1,borderColor:BORDER,borderRadius:7,backgroundColor:PANEL},
  marketSymbol:{color:"#E7EEE9",fontSize:11,fontWeight:"800"},marketChange:{fontSize:14,fontWeight:"800",marginTop:7},marketPrice:{color:"#89988F",fontSize:8,marginTop:5,fontVariant:["tabular-nums"]},
  signalPanel:{borderWidth:1,borderColor:"#285E3C",borderRadius:9,backgroundColor:"#070A08",overflow:"hidden"},
  panel:{borderWidth:1,borderColor:BORDER,borderRadius:9,backgroundColor:PANEL,overflow:"hidden"},
  panelTitleRow:{height:44,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},
  marketStripHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:2,paddingBottom:6},
  marketStripTitle:{color:"#E9F0EC",fontSize:11,fontWeight:"800",letterSpacing:1.1},
  panelTitle:{color:"#E9F0EC",fontSize:13,fontWeight:"800",letterSpacing:1},arrow:{color:LIME,fontSize:25,fontWeight:"300"},count:{color:"#C7D3CC",fontSize:13},source:{color:"#71877B",fontSize:9,fontWeight:"800"},
  terrain:{height:190,position:"relative",justifyContent:"center",overflow:"hidden",backgroundColor:"#050806"},gridH1:{position:"absolute",left:0,right:0,top:"33%",height:1,backgroundColor:"#112219"},gridH2:{position:"absolute",left:0,right:0,top:"66%",height:1,backgroundColor:"#112219"},gridV1:{position:"absolute",top:0,bottom:0,left:"33%",width:1,backgroundColor:"#112219"},gridV2:{position:"absolute",top:0,bottom:0,left:"66%",width:1,backgroundColor:"#112219"},
  signalPin:{position:"absolute",left:"43%",top:"42%",alignItems:"center"},pinDot:{width:14,height:14,borderRadius:14,backgroundColor:LIME,borderWidth:4,borderColor:"#A0CF52",shadowColor:LIME,shadowOpacity:.9,shadowRadius:12},pinLabel:{marginTop:5,color:LIME,fontSize:8,fontWeight:"900",backgroundColor:"#0D2114",paddingHorizontal:6,paddingVertical:4,borderRadius:4,borderWidth:1,borderColor:"#2C703F"},
  signalThesis:{color:"#DDE9E2",fontSize:15,lineHeight:21,fontWeight:"700",paddingHorizontal:14,paddingVertical:11,borderTopWidth:1,borderTopColor:BORDER},
  evidenceRail:{borderTopWidth:1,borderTopColor:BORDER},evidenceRow:{flexDirection:"row",gap:10,paddingHorizontal:14,paddingVertical:10,borderBottomWidth:1,borderBottomColor:"#121D17"},evidenceLabel:{width:60,fontSize:9,fontWeight:"900",letterSpacing:.8},evidenceValue:{flex:1,color:"#A9B7AF",fontSize:10,lineHeight:15},
  signalRow:{minHeight:48,flexDirection:"row",alignItems:"center",paddingHorizontal:13,gap:10,borderBottomWidth:1,borderBottomColor:"#121D17"},rank:{width:22,height:22,borderRadius:22,borderWidth:1,borderColor:"#3A4C42",color:"#DDE7E1",textAlign:"center",lineHeight:20,fontSize:9},asset:{color:"#EEF5F1",fontSize:13,fontWeight:"800",width:54},signalBadge:{borderWidth:1,borderRadius:5,paddingHorizontal:7,paddingVertical:4},signalBadgeText:{fontSize:8,fontWeight:"900"},rowChange:{marginLeft:"auto",fontSize:11,fontWeight:"800",fontVariant:["tabular-nums"]},
  empty:{color:MUTED,fontSize:10,padding:14},performanceGraph:{height:74,flexDirection:"row",alignItems:"flex-end",gap:3,paddingHorizontal:14,paddingTop:12,borderBottomWidth:1,borderBottomColor:BORDER},waveBar:{flex:1,minWidth:2,borderRadius:2},
  performanceMetrics:{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:14,paddingVertical:14,gap:10},metricValue:{color:"#EDF4F0",fontSize:13,fontWeight:"800",fontVariant:["tabular-nums"]},metricLabel:{color:"#66786E",fontSize:8,fontWeight:"700",marginTop:5},
  capitalLimits:{padding:13,borderWidth:1,borderColor:BORDER,borderRadius:8,backgroundColor:"#080C0A",flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},capitalLabel:{color:"#C9D5CE",fontSize:9,fontWeight:"900",letterSpacing:.8},capitalMeta:{color:"#5F7468",fontSize:8,marginTop:4},capitalValues:{flexDirection:"row",gap:18},capitalValue:{color:"#DFE8E3",fontSize:10,fontWeight:"800",textAlign:"right"},capitalKey:{color:"#5F7468",fontSize:7,fontWeight:"800",marginTop:4,textAlign:"right"},
  connectionNotice:{padding:13,borderWidth:1,borderColor:"#57342F",borderRadius:8,backgroundColor:"#140B09"},connectionTitle:{color:RED,fontSize:10,fontWeight:"900"},connectionBody:{color:"#B8A7A3",fontSize:10,lineHeight:15,marginTop:5},connectionAction:{color:"#E4B3A9",fontSize:9,fontWeight:"800",marginTop:8},
  hiddenContract:{paddingHorizontal:6,paddingVertical:5},learningLink:{color:"#82978B",fontSize:9,fontWeight:"700",letterSpacing:.55},safety:{color:"#81988B",fontSize:9,textAlign:"center",fontWeight:"700",letterSpacing:.65},
});
