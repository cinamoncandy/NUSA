import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { masterReferenceColors, wealthProductColors } from "./designSystem";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";

const CANVAS = masterReferenceColors.canvas;
const ACCENT = masterReferenceColors.accent;
const ACCENT_SOFT = masterReferenceColors.accentSoft;
const TEXT = wealthProductColors.c06;
const MUTED = wealthProductColors.c04;
const BORDER = wealthProductColors.c03;
const PANEL = wealthProductColors.c02;

interface StrategiesViewProps {
  readonly research: ResearchStatusProjection | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function Row({ label, value, tone }: Readonly<{ label: string; value: string; tone?: "accent" }>) {
  return <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, tone === "accent" ? { color: ACCENT_SOFT } : null]} numberOfLines={1}>{value}</Text>
  </View>;
}

/**
 * The concept board's Strategies screen lists strategy families with returns. The runtime carries
 * no per-strategy return: ResearchStatusProjection names a champion and a challenger with their
 * versions and authority, and counts candidates and experiments. So the composition follows the
 * board and the content stops where the evidence stops — an absent return is stated, never filled.
 */
export function StrategiesView({ research, refreshing, onRefresh }: StrategiesViewProps) {
  const entries = research === null ? [] : [
    { key: "champion", role: "CHAMPION", id: research.champion.strategyId, version: research.champion.strategyVersion, authority: research.champion.authority },
    { key: "challenger", role: "CHALLENGER", id: research.challenger.strategyId, version: research.challenger.strategyVersion, authority: research.challenger.authority },
  ];

  return <ScrollView
    style={{ backgroundColor: CANVAS }}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl tintColor={ACCENT} refreshing={refreshing} onRefresh={onRefresh} />}
    testID="strategies-screen"
  >
    <Text style={styles.title}>Strategies</Text>
    <View style={styles.tabs} testID="strategies-tabs">{["Families","Active","Watchlist"].map((label,index)=><View key={label} style={[styles.tab,index===0?styles.tabActive:null]}><Text style={[styles.tabText,index===0?styles.tabTextActive:null]}>{label}</Text></View>)}</View>

    {research === null
      ? <View style={styles.empty} testID="strategies-unavailable"><Text style={styles.emptyTitle}>NO VERIFIED STRATEGY DATA</Text><Text style={styles.emptyBody}>연구 세션 근거가 없어 전략을 표시하지 않습니다. 추정치를 대신 보여주지 않습니다.</Text></View>
      : <>
        <View style={styles.strategyList} testID="strategies-list">
          {entries.map((entry,index)=><View key={entry.key} style={styles.strategyRow} testID={`strategy-${entry.key}`}>
            <View style={[styles.strategyIcon,{borderColor:index===0?ACCENT_SOFT:BORDER}]}><Text style={styles.strategyIconText}>{index===0?"C":"Δ"}</Text></View>
            <View style={styles.strategyMain}><Text style={styles.strategyName} numberOfLines={1}>{entry.id}</Text><Text style={styles.strategySub}>{entry.role} · v{entry.version}</Text></View>
            <View style={styles.strategyTail}><Text style={styles.strategyAuthority}>{entry.authority}</Text><Text style={styles.strategyReturn} testID={`strategy-${entry.key}-return`}>RETURN —</Text></View>
            <Text style={styles.strategyChevron}>›</Text>
          </View>)}
          <View style={styles.strategyEmptyRow}><Text style={styles.strategyEmptyText}>No additional verified strategy families</Text></View>
        </View>

        <View style={styles.featured} testID="strategies-featured">
          <Text style={styles.featuredKicker}>Featured Strategy</Text>
          <Text style={styles.featuredTitle}>{research.champion.strategyId}</Text>
          <Text style={styles.featuredMeta}>CHAMPION · v{research.champion.strategyVersion} · {research.champion.authority}</Text>
          <View style={styles.featuredTrace}><View style={styles.featuredLineA}/><View style={styles.featuredLineB}/></View>
          <Text style={styles.featuredNote}>Performance unavailable in this projection; no return is fabricated.</Text>
        </View>

        <View style={styles.sessionCard} testID="strategies-session"><Text style={styles.sessionTitle}>RESEARCH SESSION</Text><Row label="상태" value={research.state}/><Row label="건전성" value={research.health} tone="accent"/><Row label="후보" value={String(research.candidateCount)}/><Row label="실험" value={String(research.experimentCount)}/></View>
      </>}

    <Text style={styles.authority} testID="strategies-authority">PAPER ONLY · LIVE {research?.liveAuthority ?? "NONE"} · AI ZERO AUTHORITY</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  tabs:{height:40,flexDirection:"row",alignItems:"stretch",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:BORDER},tab:{marginRight:24,justifyContent:"center",borderBottomWidth:2,borderBottomColor:"transparent"},tabActive:{borderBottomColor:ACCENT_SOFT},tabText:{color:MUTED,fontSize:10,fontWeight:"700"},tabTextActive:{color:TEXT},
  strategyList:{borderWidth:1,borderColor:BORDER,borderRadius:14,backgroundColor:PANEL,overflow:"hidden"},strategyRow:{minHeight:66,flexDirection:"row",alignItems:"center",gap:10,paddingHorizontal:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:BORDER},
  strategyIcon:{width:34,height:34,borderRadius:10,borderWidth:1,alignItems:"center",justifyContent:"center",backgroundColor:"#0D171B"},strategyIconText:{color:ACCENT_SOFT,fontSize:11,fontWeight:"900"},strategyMain:{flex:1,minWidth:0},strategyName:{color:TEXT,fontSize:12,fontWeight:"800"},strategySub:{color:MUTED,fontSize:8,marginTop:3},strategyTail:{alignItems:"flex-end"},strategyAuthority:{color:ACCENT_SOFT,fontSize:7,fontWeight:"800"},strategyReturn:{color:MUTED,fontSize:8,fontWeight:"800",marginTop:4},strategyChevron:{color:MUTED,fontSize:20},
  strategyEmptyRow:{minHeight:48,alignItems:"center",justifyContent:"center",paddingHorizontal:12},strategyEmptyText:{color:MUTED,fontSize:9},
  featured:{minHeight:190,borderWidth:1,borderColor:BORDER,borderRadius:16,backgroundColor:"#0A1217",padding:16,overflow:"hidden"},featuredKicker:{color:MUTED,fontSize:9,fontWeight:"800"},featuredTitle:{color:TEXT,fontSize:20,lineHeight:25,fontWeight:"700",marginTop:5},featuredMeta:{color:ACCENT_SOFT,fontSize:8,fontWeight:"800",marginTop:4},featuredTrace:{height:58,marginTop:16,position:"relative"},featuredLineA:{position:"absolute",left:0,right:"35%",top:32,height:2,backgroundColor:ACCENT_SOFT,transform:[{rotate:"-11deg"}]},featuredLineB:{position:"absolute",left:"50%",right:0,top:20,height:2,backgroundColor:ACCENT,transform:[{rotate:"6deg"}]},featuredNote:{color:MUTED,fontSize:9,lineHeight:14},
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120, gap: 14 },
  title: { color: TEXT, fontSize: 30, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6 },
  subtitle: { color: MUTED, fontSize: 12, lineHeight: 18 },
  empty: { minHeight: 120, borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 18, gap: 8, justifyContent: "center" },
  emptyTitle: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  emptyBody: { color: MUTED, fontSize: 11, lineHeight: 17 },
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cardRole: { color: ACCENT_SOFT, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  authorityChip: { flexShrink: 0, minHeight: 22, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 9, justifyContent: "center" },
  authorityChipText: { color: MUTED, fontSize: 8, fontWeight: "900", letterSpacing: 0.5, paddingRight: 1 },
  cardId: { color: TEXT, fontSize: 17, lineHeight: 24, fontWeight: "700", marginTop: 4 },
  cardVersion: { color: MUTED, fontSize: 11, fontVariant: ["tabular-nums"] },
  cardReturn: { color: MUTED, fontSize: 20, lineHeight: 26, fontWeight: "800", marginTop: 8, fontVariant: ["tabular-nums"] },
  cardReturnNote: { color: MUTED, fontSize: 10, lineHeight: 15 },
  sessionCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: PANEL, padding: 16, gap: 2 },
  sessionTitle: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 8 },
  row: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { color: MUTED, fontSize: 12 },
  rowValue: { color: TEXT, fontSize: 12, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] },
  authority: { color: MUTED, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "center", marginTop: 6 },
});
