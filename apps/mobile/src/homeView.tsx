import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTheme } from "./ThemeProvider";
import type { PersonalPaperOperationsLoadResult } from "./personalPaperOperationsClient";
import { buildLocalPortfolio, isLocalPaperActive } from "./localPaperLedger";
import { useLocalPaperMarkPrice, useLocalPaperSnapshot } from "./localPaperLedgerHooks";
import { selectHomeMarketData } from "./homeMarketData";
import type { WatchlistMarket } from "./watchlist";
import type { PublicCandle } from "./chartViewModel";

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

function money(value: number | null): string {
  if (value == null) return "—";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}
function pct(value: number | null): string {
  if (value == null) return "—";
  const n = value * 100;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function HomeView({ snapshot, readOnlyError, notConfigured, refreshing, publicMarkets, onRefresh, onGoSettings, onNavigate, onOpenPaperLearning }: HomeViewProps) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const localPaperActive = snapshot == null && isLocalPaperActive();
  const localTradingSnapshot = useLocalPaperSnapshot();
  const localMarkPrice = useLocalPaperMarkPrice(localPaperActive);
  const localPortfolio = localPaperActive ? buildLocalPortfolio(localTradingSnapshot, localMarkPrice) : null;
  const account = snapshot?.portfolio?.account ?? localPortfolio?.account ?? null;
  const totalPnl = account == null ? null : (account.realizedPnl ?? account.position.realizedPnl) + account.unrealizedPnl;
  const dailyRate = account?.equity && totalPnl != null ? totalPnl / account.equity : null;
  const ai = snapshot?.ai ?? null;
  const aiReady = ai?.status === "AVAILABLE" && Boolean(ai.thesis?.trim()) && ai.evidenceReferences.length > 0;
  const marketRows = selectHomeMarketData(publicMarkets, snapshot?.markets ?? []).slice(0, 3);
  const stable = !readOnlyError && !notConfigured;
  const mint = theme.colors.success;
  const purple = theme.colors.neonPurple;
  const blue = theme.colors.neonBlue;

  return <ScrollView
    testID="home-screen"
    contentContainerStyle={[styles.content, { maxWidth: tablet ? 920 : 620 }]}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={mint} />}
  >
    <View style={styles.header} testID="home-master-rail">
      <View>
        <Text style={[styles.brand, { color: theme.colors.text }]}>NUSA</Text>
        <Text style={[styles.brandSub, { color: theme.colors.textMuted }]}>AI SUPERVISORY OS</Text>
      </View>
      <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceRaised }]}><Text style={[styles.avatarText, { color: theme.colors.text }]}>N</Text></View>
    </View>

    <View style={[styles.authorityRail, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Text style={[styles.authorityItem, { color: theme.colors.text }]}>AI ZERO AUTHORITY</Text>
      <Text style={[styles.authorityItem, { color: theme.colors.text }]}>PAPER ONLY · LIVE NONE</Text>
      <Text style={[styles.authorityItem, { color: theme.colors.text }]}>YOU ARE SUPERVISOR</Text>
    </View>

    <View style={[styles.hero, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong }]} testID="home-supervisor-summary">
      <View style={styles.heroCopy}>
        <Text style={[styles.now, { color: mint }]}>● NOW</Text>
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{stable ? "All Stable." : "Attention Needed."}</Text>
        <Text style={[styles.heroSubtitle, { color: stable ? mint : theme.colors.danger }]}>{stable ? "No Action Needed." : "Check Connection."}</Text>
        <Text style={[styles.heroBody, { color: theme.colors.textMuted }]}>NUSA가 시장과 포지션을 지속적으로 감시하고 있습니다.</Text>
        <Pressable onPress={stable ? () => onNavigate("AiSignal") : onGoSettings} style={[styles.detailButton, { borderColor: theme.colors.borderStrong }]}>
          <Text style={[styles.detailButtonText, { color: theme.colors.text }]}>{stable ? "상세 현황 보기" : "연결 설정"} →</Text>
        </Pressable>
      </View>
      <View style={styles.orbWrap} accessibilityLabel="NUSA white mint supervisory orb">
        <View style={[styles.orbOuter, { borderColor: mint, shadowColor: purple }]}>
          <View style={[styles.orbInner, { borderColor: blue, backgroundColor: theme.colors.surfaceRaised }]} />
        </View>
      </View>
      <View style={styles.stateRail}>
        {["STABLE", "WATCH", "CAUTION", "RISK", "ACTION"].map((label, index) => <View key={label} style={styles.stateRow}>
          <View style={[styles.stateDot, { borderColor: index === 0 && stable ? mint : theme.colors.borderStrong, backgroundColor: index === 0 && stable ? mint : theme.colors.surface }]} />
          <Text style={[styles.stateLabel, { color: index === 0 && stable ? mint : theme.colors.textMuted }]}>{label}</Text>
        </View>)}
      </View>
    </View>

    <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>MARKET OVERVIEW</Text><Pressable onPress={() => onNavigate("Markets")}><Text style={[styles.link, { color: theme.colors.textMuted }]}>실시간 주요 자산 →</Text></Pressable></View>
    <View style={styles.marketGrid} testID="home-market-pulse">
      {[0,1,2].map((i) => { const m = marketRows[i]; return <Pressable key={m?.market ?? i} onPress={() => onNavigate("Markets")} style={[styles.marketCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.marketSymbol, { color: theme.colors.text }]}>{m?.market ?? "—"}</Text>
        <Text style={[styles.marketPrice, { color: theme.colors.text }]}>{m ? money(m.price) : "—"}</Text>
        <Text style={[styles.marketChange, { color: m?.changeRate == null ? theme.colors.textMuted : m.changeRate >= 0 ? mint : theme.colors.danger }]}>{pct(m?.changeRate ?? null)}</Text>
      </Pressable>; })}
    </View>

    <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.colors.text }]}>CAPITAL OVERVIEW</Text><Text style={[styles.link, { color: theme.colors.textMuted }]}>PAPER</Text></View>
    <Pressable onPress={() => onNavigate("Portfolio")} style={[styles.capitalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} testID="account-hero-card">
      <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>TOTAL ASSETS</Text><Text style={[styles.assetValue,{color:theme.colors.text}]}>{money(account?.equity ?? null)}</Text></View>
      <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>DAILY P&L</Text><Text style={[styles.metricValue,{color:totalPnl == null ? theme.colors.textMuted : totalPnl >= 0 ? mint : theme.colors.danger}]}>{money(totalPnl)}</Text><Text style={[styles.metricSub,{color:theme.colors.textMuted}]}>{pct(dailyRate)}</Text></View>
      <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>POSITIONS</Text><Text style={[styles.metricValue,{color:theme.colors.text}]}>{account?.position?.quantity ? "1" : "0"}</Text><Text style={[styles.metricSub,{color:theme.colors.textMuted}]}>Active</Text></View>
    </Pressable>

    <View style={[styles.judgmentCard,{backgroundColor:theme.colors.surface,borderColor:theme.colors.border}]} testID="ai-card">
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle,{color:theme.colors.text}]}>NUSA JUDGMENT</Text><Text style={[styles.link,{color:theme.colors.textMuted}]}>AI 판단</Text></View>
      <Text style={[styles.bias,{color:aiReady ? mint : theme.colors.textMuted}]}>{aiReady ? "LONG BIAS" : "NEUTRAL"} ●</Text>
      <Text style={[styles.judgmentBody,{color:theme.colors.text}]}>{aiReady ? ai?.thesis : "검증된 AI 판단이 준비될 때까지 중립 상태를 유지합니다."}</Text>
      <View style={styles.judgmentMetrics}>
        <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>근거</Text><Text style={[styles.metricValue,{color:theme.colors.text}]}>{aiReady ? ai?.evidenceReferences.length : 0}</Text></View>
        <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>신뢰도</Text><Text style={[styles.metricValue,{color:theme.colors.text}]}>{aiReady && ai?.calibrationStatus === "CALIBRATED" ? `${Math.round(ai.confidence * 100)}%` : "—"}</Text></View>
        <View><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>CALIBRATION</Text><Text style={[styles.metricValue,{color:ai?.calibrationStatus === "CALIBRATED" ? mint : theme.colors.textMuted}]}>{ai?.calibrationStatus ?? "PENDING"}</Text></View>
      </View>
    </View>

    <View style={styles.sectionHeader}><Text style={[styles.sectionTitle,{color:theme.colors.text}]}>EVIDENCE STREAM</Text><Pressable onPress={() => onNavigate("AiSignal")}><Text style={[styles.link,{color:theme.colors.textMuted}]}>전체 보기 →</Text></Pressable></View>
    <View style={styles.evidenceRow} testID="home-supervisor-learning">
      {["거시 환경","시장 구조","온체인 데이터","심리 지표"].map((x) => <View key={x} style={[styles.evidenceCard,{backgroundColor:theme.colors.surface,borderColor:theme.colors.border}]}><Text style={[styles.evidenceTitle,{color:theme.colors.text}]}>{x}</Text><Text style={[styles.metricSub,{color:theme.colors.textMuted}]}>검증된 데이터만 표시</Text></View>)}
    </View>
    <Pressable onPress={onOpenPaperLearning} testID="home-paper-learning" style={[styles.learningButton,{borderColor:theme.colors.borderStrong}]}><Text style={[styles.detailButtonText,{color:theme.colors.text}]}>PAPER 학습 근거 보기 →</Text></Pressable>

    <Text style={[styles.sectionTitle,{color:theme.colors.text}]}>OWNER COMMAND</Text>
    <View style={styles.commandRow}>
      <Pressable onPress={() => onNavigate("Markets")} style={[styles.command,{backgroundColor:theme.colors.surface,borderColor:theme.colors.border}]}><Text style={[styles.commandText,{color:theme.colors.text}]}>모니터링 강화</Text></Pressable>
      <Pressable onPress={() => onNavigate("AiSignal")} style={[styles.command,{backgroundColor:theme.colors.surface,borderColor:theme.colors.border}]}><Text style={[styles.commandText,{color:theme.colors.text}]}>시나리오 분석</Text></Pressable>
      <Pressable onPress={() => onNavigate("Portfolio")} style={[styles.command,{backgroundColor:theme.colors.primarySoft,borderColor:theme.colors.borderStrong}]}><Text style={[styles.commandText,{color:theme.colors.text}]}>수동 개입</Text></Pressable>
    </View>

    <View style={[styles.bottomNav,{backgroundColor:theme.colors.navSurface,borderColor:theme.colors.border}]} testID="home-reference-navigation">
      <View style={styles.navItem}><Text style={[styles.navActive,{color:theme.colors.text}]}>●</Text><Text style={[styles.navText,{color:theme.colors.text}]}>NOW</Text></View>
      <Pressable style={styles.navItem} onPress={() => onNavigate("Markets")}><Text style={[styles.navText,{color:theme.colors.textMuted}]}>▥</Text><Text style={[styles.navText,{color:theme.colors.textMuted}]}>MARKET</Text></Pressable>
      <Pressable style={[styles.nusaButton,{backgroundColor:theme.colors.primarySoft,borderColor:purple}]} onPress={() => onNavigate("AiSignal")}><Text style={[styles.nusaMark,{color:theme.colors.text}]}>✦</Text><Text style={[styles.navText,{color:theme.colors.text}]}>NUSA</Text></Pressable>
      <Pressable style={styles.navItem} onPress={() => onNavigate("Portfolio")}><Text style={[styles.navText,{color:theme.colors.textMuted}]}>◔</Text><Text style={[styles.navText,{color:theme.colors.textMuted}]}>ASSETS</Text></Pressable>
      <Pressable style={styles.navItem} onPress={onGoSettings}><Text style={[styles.navText,{color:theme.colors.textMuted}]}>☷</Text><Text style={[styles.navText,{color:theme.colors.textMuted}]}>CONTROL</Text></Pressable>
    </View>
    <Text style={[styles.safety,{color:theme.colors.textMuted}]}>PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content:{width:"100%",alignSelf:"center",paddingHorizontal:18,paddingTop:14,paddingBottom:40,gap:14},
  header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}, brand:{fontSize:34,fontWeight:"700",letterSpacing:7},brandSub:{fontSize:10,fontWeight:"700",letterSpacing:1.6,marginTop:2},avatar:{width:42,height:42,borderRadius:21,alignItems:"center",justifyContent:"center"},avatarText:{fontSize:18,fontWeight:"700"},
  authorityRail:{borderWidth:1,borderRadius:18,paddingHorizontal:12,paddingVertical:12,flexDirection:"row",justifyContent:"space-between",gap:8},authorityItem:{flex:1,fontSize:9,lineHeight:13,fontWeight:"700",textAlign:"center"},
  hero:{borderWidth:1,borderRadius:26,padding:20,minHeight:360,overflow:"hidden",position:"relative"},heroCopy:{maxWidth:"58%",zIndex:2},now:{fontSize:11,fontWeight:"800",letterSpacing:1.4},heroTitle:{fontSize:42,lineHeight:48,fontWeight:"700",marginTop:14},heroSubtitle:{fontSize:28,lineHeight:34,fontWeight:"500"},heroBody:{fontSize:14,lineHeight:22,marginTop:18},detailButton:{alignSelf:"flex-start",borderWidth:1,borderRadius:20,paddingHorizontal:15,paddingVertical:10,marginTop:16},detailButtonText:{fontSize:12,fontWeight:"700"},orbWrap:{position:"absolute",right:48,top:54,width:160,height:160,alignItems:"center",justifyContent:"center"},orbOuter:{width:150,height:150,borderRadius:75,borderWidth:2,alignItems:"center",justifyContent:"center",shadowOpacity:.24,shadowRadius:24,elevation:3},orbInner:{width:112,height:112,borderRadius:56,borderWidth:1},stateRail:{position:"absolute",right:18,top:220,gap:8},stateRow:{flexDirection:"row",alignItems:"center",gap:7},stateDot:{width:9,height:9,borderRadius:5,borderWidth:1},stateLabel:{fontSize:9,fontWeight:"800"},
  sectionHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},sectionTitle:{fontSize:14,fontWeight:"800",letterSpacing:.3},link:{fontSize:11,fontWeight:"600"},marketGrid:{flexDirection:"row",gap:8},marketCard:{flex:1,borderWidth:1,borderRadius:18,padding:13,gap:5},marketSymbol:{fontSize:11,fontWeight:"800"},marketPrice:{fontSize:14,fontWeight:"800"},marketChange:{fontSize:12,fontWeight:"800"},
  capitalCard:{borderWidth:1,borderRadius:22,padding:16,flexDirection:"row",justifyContent:"space-between",gap:12},metricLabel:{fontSize:9,fontWeight:"700"},assetValue:{fontSize:25,fontWeight:"800",marginTop:4},metricValue:{fontSize:18,fontWeight:"800",marginTop:4},metricSub:{fontSize:10,marginTop:3},
  judgmentCard:{borderWidth:1,borderRadius:22,padding:16,gap:12},bias:{fontSize:24,fontWeight:"800"},judgmentBody:{fontSize:14,lineHeight:21},judgmentMetrics:{flexDirection:"row",justifyContent:"space-between"},
  evidenceRow:{flexDirection:"row",gap:7},evidenceCard:{flex:1,minWidth:0,borderWidth:1,borderRadius:14,padding:10},evidenceTitle:{fontSize:10,fontWeight:"800"},learningButton:{borderWidth:1,borderRadius:18,padding:12,alignItems:"center"},commandRow:{flexDirection:"row",gap:8},command:{flex:1,borderWidth:1,borderRadius:16,padding:13,alignItems:"center"},commandText:{fontSize:11,fontWeight:"800"},
  bottomNav:{borderWidth:1,borderRadius:28,paddingHorizontal:8,paddingVertical:8,flexDirection:"row",alignItems:"center",justifyContent:"space-around"},navItem:{flex:1,alignItems:"center",gap:3},navActive:{fontSize:16},navText:{fontSize:9,fontWeight:"700"},nusaButton:{width:62,height:62,borderRadius:31,borderWidth:1,alignItems:"center",justifyContent:"center",marginTop:-20},nusaMark:{fontSize:20},safety:{fontSize:9,textAlign:"center",fontWeight:"700",letterSpacing:.5}
});
