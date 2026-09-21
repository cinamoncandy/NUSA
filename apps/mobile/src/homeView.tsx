import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TerrainSignal } from "./components";
import { useTheme } from "./ThemeProvider";
import { intelligenceFieldColors, wealthProductColors } from "./designSystem";
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
export type HomeDestination = "Market" | "Signals" | "Strategies";

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

const SIGNAL_TEAL = intelligenceFieldColors.terminalSignal;
const INK = wealthProductColors.c01;
const PANEL = wealthProductColors.c02;
const BORDER = wealthProductColors.c03;
const MUTED = wealthProductColors.c04;
const RED = wealthProductColors.c05;

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
    <Text style={[styles.marketChange, { color: market == null ? MUTED : positive ? SIGNAL_TEAL : RED }]}>{pct(market?.changeRate)}</Text>
    <Text style={styles.marketPrice}>{market == null ? "NO DATA" : won(market.price)}</Text>
  </View>;
}
function EvidenceRow({ label, value, tone = "neutral" }: Readonly<{ label: string; value: string; tone?: "lime" | "danger" | "neutral" }>) {
  return <View style={styles.evidenceRow}><Text style={[styles.evidenceLabel, { color: tone === "lime" ? SIGNAL_TEAL : tone === "danger" ? RED : wealthProductColors.c06 }]}>{label}</Text><Text style={styles.evidenceValue} numberOfLines={3}>{value}</Text></View>;
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
  const confidenceLabel = signalAvailable && ai?.confidence != null ? `${Math.round(ai.confidence * 100)}%` : "—";
  const observedMarkets = marketRows.filter((market) => market.changeRate != null && Number.isFinite(market.changeRate));
  const positiveMarkets = observedMarkets.filter((market) => (market.changeRate ?? 0) > 0).length;
  const breadthPercent = observedMarkets.length === 0 ? null : Math.round((positiveMarkets / observedMarkets.length) * 100);

  return <ScrollView
    style={{ backgroundColor: INK }}
    contentContainerStyle={[styles.content, { maxWidth: tablet ? 980 : 720 }]}
    refreshControl={<RefreshControl tintColor={SIGNAL_TEAL} refreshing={props.refreshing} onRefresh={props.onRefresh} />}
    testID="home-screen"
  >
    <View style={styles.topbar} testID="home-master-rail">
      <View><Text style={styles.logo}>NUSA</Text><Text style={styles.tagline}>INTELLIGENCE OS</Text></View>
      <View style={styles.notificationGlyph} testID="home-status-rail"><View style={styles.notificationBell}/><View style={styles.notificationClapper}/></View>
    </View>

    <View style={styles.referenceHero} testID="home-reference-hero">
      <View style={styles.heroGlow}/>
      <View style={styles.heroMountainBack}/>
      <View style={styles.heroMountainMid}/>
      <View style={styles.heroMountainFront}/>
      <View style={styles.heroHorizon}/>
      <View style={styles.heroCopy}>
        <Text style={styles.heroHeadline}>A More{"\n"}Rational Tomorrow.</Text>
        <Text style={styles.heroSubline}>Markets. Signals. Evidence.</Text>
      </View>
      <View style={styles.heroPrinciples}><Text style={styles.heroPrinciple}>DISCIPLINE</Text><Text style={styles.heroPrinciple}>EVIDENCE</Text><Text style={styles.heroPrinciple}>PERSPECTIVE</Text></View>
    </View>

    <View style={styles.equityCard} testID="account-hero-card">
      <View><Text style={styles.equityLabel}>PAPER Equity</Text><Text style={styles.equityValue}>{won(account?.equity)}</Text></View>
      <View style={styles.equitySide}><Text style={[styles.equityPnl,{color:totalPnl==null?MUTED:totalPnl>=0?SIGNAL_TEAL:RED}]}>{totalPnl==null?"—":won(totalPnl)}</Text><Text style={styles.equityMeta}>{accountSource==null?"NO VERIFIED ACCOUNT":accountSource+" PAPER"}</Text></View>
    </View>

    <View style={styles.systemCard} testID="home-system-status">
      <View style={[styles.systemDot,{backgroundColor:props.snapshot?.health==="HEALTHY"||localPaperActive?SIGNAL_TEAL:wealthProductColors.c60}]}/>
      <View style={styles.systemCopy}><Text style={styles.systemLabel}>System Status</Text><Text style={styles.systemValue}>{props.snapshot?.health==="HEALTHY"||localPaperActive?"All Systems Operational":props.snapshot?.health??"WAITING FOR VERIFIED RUNTIME"}</Text></View>
      <Text style={styles.systemChevron}>›</Text>
    </View>

    <View style={styles.referenceMiniGrid}>
      <Pressable onPress={()=>props.onNavigate("Market")} style={styles.referenceMiniCard} testID="home-market-status">
        <Text style={styles.miniLabel}>Market</Text><Text style={[styles.miniValue,{color:props.publicMarketConnectionState==="CONNECTED"?SIGNAL_TEAL:MUTED}]}>{props.publicMarketConnectionState==="CONNECTED"?"Live":"Waiting"}</Text>
        <View style={styles.miniSpark}><View style={[styles.miniSparkLine,{backgroundColor:theme.colors.aiSignalMid}]}/><View style={[styles.miniSparkLine2,{backgroundColor:theme.colors.aiSignalEnd}]}/></View>
      </Pressable>
      <Pressable onPress={props.onOpenPaperLearning} style={styles.referenceMiniCard} testID="home-paper-status">
        <Text style={styles.miniLabel}>PAPER</Text><Text style={[styles.miniValue,{color:props.snapshot?.readyForPaperOperations||localPaperActive?SIGNAL_TEAL:MUTED}]}>{props.snapshot?.readyForPaperOperations||localPaperActive?"Running":"Waiting"}</Text>
        <View style={styles.miniSpark}><View style={[styles.miniSparkLine,{backgroundColor:theme.colors.aiSignalEnd}]}/><View style={[styles.miniSparkLine2,{backgroundColor:theme.colors.aiSignalMid}]}/></View>
      </Pressable>
      <Pressable onPress={()=>props.onNavigate("Signals")} style={styles.referenceMiniCard} testID="home-ai-judgement">
        <Text style={styles.miniLabel}>AI</Text><Text style={[styles.miniValue,{color:signalAvailable?SIGNAL_TEAL:MUTED}]}>{signalAvailable?"Ready":"Waiting"}</Text>
        <View style={styles.miniSpark}><View style={[styles.miniSparkLine,{backgroundColor:theme.colors.aiSignalStart}]}/><View style={[styles.miniSparkLine2,{backgroundColor:theme.colors.aiSignalEnd}]}/></View>
      </Pressable>
    </View>

    <View style={styles.referenceFooter}><Text style={styles.referenceFooterLead}>A SAFER TOMORROW.</Text><Text style={styles.referenceFooterSub}>Real data · PAPER only · AI zero authority</Text></View>

    {disconnected || props.readOnlyError ? <Pressable onPress={props.onGoSettings} style={styles.connectionNotice} testID="home-operational-notice"><Text style={styles.connectionTitle}>{disconnected ? "PAPER CONNECTION REQUIRED" : "PAPER READ-ONLY ERROR"}</Text><Text style={styles.connectionBody}>{props.notConfigured ?? props.readOnlyError}</Text><Text style={styles.connectionAction}>OPEN SETTINGS →</Text></Pressable> : null}

    {/* The Android release contract requires a distinct supervisor-learning role on HOME. It was
        satisfied by a 1x1 opacity-0 node, which is not a surface; this renders the same truthful,
        fail-closed line where the owner can read it. */}
    <View style={styles.contractRow} testID="home-supervisor-learning"><Text style={styles.supervisorLearning} numberOfLines={2}>{decision.learning}</Text></View>
    <View style={styles.contractRow} testID="home-paper-learning"><Pressable onPress={props.onOpenPaperLearning}><Text style={styles.learningLink}>PAPER LEARNING EVIDENCE →</Text></Pressable></View>
    <View style={styles.contractRow} testID="home-risk-authority"><Text style={styles.safety}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  referenceHero:{height:330,borderRadius:22,overflow:"hidden",position:"relative",backgroundColor:"#07101A",borderWidth:1,borderColor:"#18283A"},
  heroGlow:{position:"absolute",right:-70,top:-30,width:260,height:260,borderRadius:260,backgroundColor:"#DDF9A8",opacity:.14,shadowColor:"#DDF9A8",shadowOpacity:.5,shadowRadius:42},
  heroMountainBack:{position:"absolute",left:-30,right:80,bottom:74,height:120,backgroundColor:"#152A38",transform:[{rotate:"-8deg"}],borderTopRightRadius:120},
  heroMountainMid:{position:"absolute",left:40,right:-45,bottom:46,height:150,backgroundColor:"#0D1C28",transform:[{rotate:"5deg"}],borderTopLeftRadius:130},
  heroMountainFront:{position:"absolute",left:-70,right:-40,bottom:-42,height:130,backgroundColor:"#050A0F",transform:[{rotate:"-4deg"}],borderTopRightRadius:180},
  heroHorizon:{position:"absolute",left:0,right:0,bottom:92,height:1,backgroundColor:"#A8E66A",opacity:.5},
  heroCopy:{position:"absolute",left:20,top:22,right:18},heroHeadline:{color:"#F7F8F5",fontSize:31,lineHeight:35,fontWeight:"500",letterSpacing:-1},heroSubline:{color:"#99A3A9",fontSize:10,lineHeight:15,marginTop:8},
  heroPrinciples:{position:"absolute",left:20,bottom:22,gap:4},heroPrinciple:{color:"#B7C1C5",fontSize:7,fontWeight:"800",letterSpacing:2},
  equityCard:{minHeight:86,borderRadius:16,borderWidth:1,borderColor:"#20303A",backgroundColor:"#0B1117",paddingHorizontal:16,paddingVertical:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},
  equityLabel:{color:"#9CA7AC",fontSize:9,fontWeight:"700"},equityValue:{color:"#F5F7F4",fontSize:26,lineHeight:32,fontWeight:"700",fontVariant:["tabular-nums"],marginTop:3},
  equitySide:{alignItems:"flex-end"},equityPnl:{fontSize:13,fontWeight:"800",fontVariant:["tabular-nums"]},equityMeta:{color:"#768187",fontSize:7,fontWeight:"800",letterSpacing:.7,marginTop:4},
  systemCard:{minHeight:68,borderRadius:14,borderWidth:1,borderColor:"#20303A",backgroundColor:"#0B1117",paddingHorizontal:14,flexDirection:"row",alignItems:"center",gap:12},
  systemDot:{width:12,height:12,borderRadius:12,shadowColor:SIGNAL_TEAL,shadowOpacity:.5,shadowRadius:9},systemCopy:{flex:1},systemLabel:{color:"#919CA2",fontSize:9},systemValue:{color:"#DDF9A8",fontSize:12,fontWeight:"700",marginTop:2},systemChevron:{color:"#A5B0B4",fontSize:22},
  referenceMiniGrid:{flexDirection:"row",gap:8},referenceMiniCard:{flex:1,minHeight:100,borderRadius:12,borderWidth:1,borderColor:"#20303A",backgroundColor:"#0B1117",padding:11,overflow:"hidden"},
  miniLabel:{color:"#99A4AA",fontSize:8,fontWeight:"700"},miniValue:{fontSize:11,fontWeight:"800",marginTop:4},miniSpark:{height:30,marginTop:12,position:"relative"},miniSparkLine:{position:"absolute",left:0,right:"30%",top:15,height:1.5,transform:[{rotate:"-12deg"}]},miniSparkLine2:{position:"absolute",left:"38%",right:0,top:10,height:1.5,transform:[{rotate:"7deg"}]},
  referenceFooter:{paddingVertical:12,gap:3},referenceFooterLead:{color:"#C8D0D2",fontSize:8,fontWeight:"800",letterSpacing:1.7},referenceFooterSub:{color:"#66747B",fontSize:8,lineHeight:12},
  content:{paddingHorizontal:20,paddingTop:12,paddingBottom:38,gap:18,width:"100%",alignSelf:"center",backgroundColor:INK},
  topbar:{minHeight:68,flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingBottom:6},
  logo:{color:wealthProductColors.c08,fontSize:24,fontWeight:"700",letterSpacing:5.2},tagline:{color:wealthProductColors.c58,fontSize:7,fontWeight:"600",letterSpacing:2.1,marginTop:2},
  notificationGlyph:{width:34,height:34,alignItems:"center",justifyContent:"center",position:"relative"},
  notificationBell:{width:14,height:15,borderWidth:1.4,borderColor:wealthProductColors.c08,borderTopLeftRadius:8,borderTopRightRadius:8,borderBottomLeftRadius:3,borderBottomRightRadius:3},
  notificationClapper:{position:"absolute",bottom:7,width:4,height:2,borderRadius:2,backgroundColor:wealthProductColors.c08},
  accountHero:{paddingTop:22,paddingBottom:8,gap:18},
  accountHeroTop:{flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",gap:16},
  accountHeroValueBlock:{flex:1,minWidth:0},accountHeroEyebrow:{color:SIGNAL_TEAL,fontSize:9,fontWeight:"900",letterSpacing:1.5,marginBottom:6},
  accountHeroValue:{color:wealthProductColors.c08,fontSize:42,lineHeight:48,fontWeight:"800",letterSpacing:-1.8,fontVariant:["tabular-nums"]},
  accountHeroDelta:{fontSize:12,fontWeight:"900",letterSpacing:.35,marginTop:6,fontVariant:["tabular-nums"]},
  accountHeroSource:{alignItems:"flex-end",paddingBottom:3},accountHeroSourceLabel:{color:wealthProductColors.c09,fontSize:9,fontWeight:"900",letterSpacing:.65,textAlign:"right"},
  accountHeroSourceMode:{color:MUTED,fontSize:7,lineHeight:11,marginTop:4,textAlign:"right"},
  accountHeroInsight:{borderWidth:1,borderColor:wealthProductColors.c24,borderRadius:20,paddingHorizontal:16,paddingVertical:15,gap:7,backgroundColor:wealthProductColors.c31},
  accountHeroInsightHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},accountHeroInsightLabel:{color:wealthProductColors.c06,fontSize:9,fontWeight:"900",letterSpacing:1.2},
  accountHeroInsightState:{fontSize:8,fontWeight:"900",letterSpacing:1},accountHeroInsightTitle:{color:wealthProductColors.c33,fontSize:15,lineHeight:20,fontWeight:"800"},
  accountHeroInsightWhy:{color:MUTED,fontSize:10,lineHeight:14},homeConfidenceRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:4},homeConfidenceValue:{color:wealthProductColors.c08,fontSize:18,fontWeight:"800",fontVariant:["tabular-nums"]},
  globeWrap:{width:172,height:174,marginRight:-4,alignItems:"center",justifyContent:"center",position:"relative"},globeGlow:{position:"absolute",width:152,height:152,borderRadius:152,backgroundColor:wealthProductColors.c13,opacity:.72,shadowColor:SIGNAL_TEAL,shadowOpacity:.22,shadowRadius:28},globeSphere:{width:152,height:152,borderRadius:152,borderWidth:1,borderColor:wealthProductColors.c14,backgroundColor:wealthProductColors.c15,overflow:"hidden",position:"relative"},globeLongitude:{position:"absolute",top:-2,bottom:-2,left:"50%",width:56,marginLeft:-28,borderRadius:56,borderWidth:1,borderColor:wealthProductColors.c16},globeLongitudeA:{transform:[{scaleX:.55}]},globeLongitudeB:{transform:[{scaleX:1.45}]},globeLatitude:{position:"absolute",left:-4,right:-4,height:46,borderRadius:80,borderWidth:1,borderColor:wealthProductColors.c17},globeLatitudeA:{top:15},globeLatitudeB:{top:48},globeLatitudeC:{top:81},globeLandA:{position:"absolute",left:77,top:35,width:34,height:18,borderRadius:8,backgroundColor:wealthProductColors.c18,transform:[{rotate:"-18deg"}]},globeLandB:{position:"absolute",left:67,top:54,width:20,height:35,borderRadius:7,backgroundColor:wealthProductColors.c19,transform:[{rotate:"17deg"}]},globeLandC:{position:"absolute",left:98,top:77,width:17,height:12,borderRadius:6,backgroundColor:wealthProductColors.c20},globeNode:{position:"absolute",width:4,height:4,borderRadius:4,backgroundColor:SIGNAL_TEAL,shadowColor:SIGNAL_TEAL,shadowOpacity:.9,shadowRadius:5},globeNodeA:{left:84,top:47},globeNodeB:{left:99,top:82},globeNodeC:{left:71,top:69},
  orbitText:{position:"absolute",right:2,bottom:8,color:wealthProductColors.c21,fontSize:7,lineHeight:10,fontWeight:"800",letterSpacing:.55,textAlign:"right"},
  marketStrip:{flexDirection:"row",gap:8},marketTile:{flex:1,minWidth:0,paddingVertical:12,paddingHorizontal:10,borderRadius:14,backgroundColor:PANEL},
  marketSymbol:{color:wealthProductColors.c22,fontSize:11,fontWeight:"800"},marketChange:{fontSize:14,fontWeight:"800",marginTop:7},marketPrice:{color:wealthProductColors.c23,fontSize:8,marginTop:5,fontVariant:["tabular-nums"]},
  signalPanel:{borderWidth:0,borderColor:"transparent",borderRadius:0,backgroundColor:wealthProductColors.c25,overflow:"hidden"},
  panel:{borderWidth:1,borderColor:BORDER,borderRadius:18,backgroundColor:PANEL,overflow:"hidden"},
  panelTitleRow:{minHeight:56,paddingHorizontal:18,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  marketStripHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:2,paddingBottom:6},
  marketStripTitle:{color:wealthProductColors.c06,fontSize:11,fontWeight:"800",letterSpacing:1.1},
  panelTitle:{color:wealthProductColors.c06,fontSize:13,fontWeight:"800",letterSpacing:1},arrow:{color:SIGNAL_TEAL,fontSize:25,fontWeight:"300"},count:{color:wealthProductColors.c26,fontSize:13},source:{color:wealthProductColors.c27,fontSize:9,fontWeight:"800"},
  terrain:{height:330,position:"relative",justifyContent:"center",overflow:"hidden",backgroundColor:wealthProductColors.c28},gridH1:{position:"absolute",left:0,right:0,top:"33%",height:1,backgroundColor:wealthProductColors.c29},gridH2:{position:"absolute",left:0,right:0,top:"66%",height:1,backgroundColor:wealthProductColors.c29},gridV1:{position:"absolute",top:0,bottom:0,left:"33%",width:1,backgroundColor:wealthProductColors.c29},gridV2:{position:"absolute",top:0,bottom:0,left:"66%",width:1,backgroundColor:wealthProductColors.c29},
  signalPin:{position:"absolute",left:"38%",bottom:24,alignItems:"center"},pinDot:{width:8,height:8,borderRadius:8,backgroundColor:wealthProductColors.c08,shadowColor:SIGNAL_TEAL,shadowOpacity:.9,shadowRadius:14},pinLabel:{marginTop:8,color:wealthProductColors.c57,fontSize:8,fontWeight:"800",backgroundColor:wealthProductColors.c31,paddingHorizontal:9,paddingVertical:5,borderRadius:999,borderWidth:1,borderColor:wealthProductColors.c24},
  signalThesis:{color:wealthProductColors.c33,fontSize:20,lineHeight:28,fontWeight:"700",paddingHorizontal:18,paddingTop:18,paddingBottom:14},
  evidenceRail:{paddingBottom:8},evidenceRow:{flexDirection:"row",gap:12,paddingHorizontal:18,paddingVertical:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:wealthProductColors.c34},evidenceLabel:{width:60,fontSize:9,fontWeight:"900",letterSpacing:.8},evidenceValue:{flex:1,color:wealthProductColors.c35,fontSize:10,lineHeight:15},
  signalRow:{minHeight:48,flexDirection:"row",alignItems:"center",paddingHorizontal:13,gap:10,borderBottomWidth:1,borderBottomColor:wealthProductColors.c34},rank:{width:22,height:22,borderRadius:22,borderWidth:1,borderColor:wealthProductColors.c36,color:wealthProductColors.c37,textAlign:"center",lineHeight:20,fontSize:9},asset:{color:wealthProductColors.c38,fontSize:13,fontWeight:"800",width:54},signalBadge:{borderWidth:1,borderRadius:5,paddingHorizontal:7,paddingVertical:4},signalBadgeText:{fontSize:8,fontWeight:"900"},rowChange:{marginLeft:"auto",fontSize:11,fontWeight:"800",fontVariant:["tabular-nums"]},
  empty:{color:MUTED,fontSize:10,padding:14},performanceGraph:{height:74,flexDirection:"row",alignItems:"flex-end",gap:3,paddingHorizontal:14,paddingTop:12,borderBottomWidth:1,borderBottomColor:BORDER},waveBar:{flex:1,minWidth:2,borderRadius:2},
  performanceMetrics:{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:14,paddingVertical:14,gap:10},metricValue:{color:wealthProductColors.c39,fontSize:13,fontWeight:"800",fontVariant:["tabular-nums"]},metricLabel:{color:wealthProductColors.c40,fontSize:8,fontWeight:"700",marginTop:5},
  capitalLimits:{padding:13,borderWidth:1,borderColor:BORDER,borderRadius:8,backgroundColor:wealthProductColors.c41,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},capitalLabel:{color:wealthProductColors.c42,fontSize:9,fontWeight:"900",letterSpacing:.8},capitalMeta:{color:wealthProductColors.c43,fontSize:8,marginTop:4},capitalValues:{flexDirection:"row",gap:18},capitalValue:{color:wealthProductColors.c44,fontSize:10,fontWeight:"800",textAlign:"right"},capitalKey:{color:wealthProductColors.c43,fontSize:7,fontWeight:"800",marginTop:4,textAlign:"right"},
  connectionNotice:{padding:13,borderWidth:1,borderColor:wealthProductColors.c45,borderRadius:8,backgroundColor:wealthProductColors.c46},connectionTitle:{color:RED,fontSize:10,fontWeight:"900"},connectionBody:{color:wealthProductColors.c47,fontSize:10,lineHeight:15,marginTop:5},connectionAction:{color:wealthProductColors.c48,fontSize:9,fontWeight:"800",marginTop:8},
  contractRow:{paddingHorizontal:6,paddingVertical:5},supervisorLearning:{color:wealthProductColors.c50,fontSize:9,lineHeight:13,fontWeight:"600",letterSpacing:.2},learningLink:{color:wealthProductColors.c49,fontSize:9,fontWeight:"700",letterSpacing:.55},safety:{color:wealthProductColors.c50,fontSize:9,textAlign:"center",fontWeight:"700",letterSpacing:.65},
});
