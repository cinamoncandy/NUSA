import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { useTheme } from "./ThemeProvider";
import { intelligenceFieldColors, wealthProductColors } from "./designSystem";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";

interface AiViewProps {
  readonly ai: AiReadOnlyProjection | null; readonly research: ResearchStatusProjection | null;
  readonly health: string | null; readonly liveAuthority: "NONE" | null; readonly productionMutationAllowed: false | null;
  readonly killSwitchActive: boolean | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void;
  readonly market?: string; readonly currentPrice?: number | null; readonly rawCandles?: readonly PublicCandle[] | null;
  readonly marketConnectionState?: string; readonly stale?: boolean;
}
const LIME=intelligenceFieldColors.terminalSignal, INK=wealthProductColors.c01, PANEL=wealthProductColors.c02, BORDER=wealthProductColors.c03, MUTED=wealthProductColors.c04, RED=wealthProductColors.c05;
const percent=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"—":`${Math.round(v*100)}%`;
function AnalysisRow({label,value,tone="lime"}:Readonly<{label:string;value:string;tone?:"lime"|"danger"|"neutral"}>){
  return <View style={styles.analysisRow}><Text style={[styles.analysisLabel,{color:tone==="lime"?LIME:tone==="danger"?RED:wealthProductColors.c51}]}>{label}</Text><Text style={styles.analysisValue}>{value}</Text></View>;
}
export function AiView({ai,research,health,liveAuthority,productionMutationAllowed,killSwitchActive,error,refreshing,onRefresh,market="KRW-BTC",currentPrice=null,rawCandles=null,marketConnectionState="UNKNOWN",stale=true}:AiViewProps){
  const {theme}=useTheme();
  const chart=buildChartViewModel({market,interval:"1m",rawCandles:rawCandles===null?null:[...rawCandles],currentPrice,connectionState:marketConnectionState,stale});
  const symbol=market.replace("KRW-","");
  const calibrated=ai?.calibrationStatus==="CALIBRATED";
  const trusted=calibrated?percent(ai?.confidence):"UNVERIFIED";
  const evidence=ai?.evidenceReferences ?? [];
  const counter=ai?.counterEvidence ?? [];
  const thesis=ai?.status==="AVAILABLE"&&ai.thesis?ai.thesis:"검증된 AI 판단이 아직 없습니다.";
  const risk=counter.length>0?counter.slice(0,2).join(" · "):"검증된 반대 근거가 없습니다.";
  const learning=ai?.recentLessonCount==null?"학습 근거를 확인할 수 없습니다.":`검증된 과거 사례 ${ai.recentLessonCount}건을 현재 판단에 참고했습니다.`;
  return <ScrollView style={{backgroundColor:INK}} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={LIME} refreshing={refreshing} onRefresh={onRefresh}/>} testID="ai-screen">
    <View style={styles.topbar}><Text style={styles.back}>‹</Text><Text style={styles.logo}>NUSA</Text><View style={styles.mode}><View style={styles.dot}/><View><Text style={styles.modeText}>PAPER MODE</Text><Text style={styles.modeSub}>LIVE: RESTRICTED</Text></View></View></View>
    <View style={styles.titleRow}><Text style={styles.pageTitle}>SIGNAL DETAIL</Text><Text style={styles.time}>{ai?.lastModelRun?new Date(ai.lastModelRun).toLocaleString("ko-KR"):"NO VERIFIED RUN"}</Text></View>

    <View style={styles.assetHead} testID="ai-now">
      <View style={styles.coin}><Text style={styles.coinText}>{symbol.slice(0,1)}</Text></View>
      <View style={styles.assetName}><Text style={styles.symbol}>{symbol}</Text><Text style={styles.assetSub}>{market}</Text></View>
      <View style={styles.quote}><Text style={styles.price}>{currentPrice==null?"—":`₩${Math.round(currentPrice).toLocaleString("ko-KR")}`}</Text><Text style={styles.readOnly}>PUBLIC READ ONLY</Text></View>
    </View>

    <View style={styles.chips}><View style={[styles.chip,{backgroundColor:calibrated?wealthProductColors.c52:wealthProductColors.c53}]}><Text style={[styles.chipText,{color:calibrated?LIME:MUTED}]}>{calibrated?"CALIBRATED":"UNVERIFIED"}</Text></View><View style={styles.chip}><Text style={styles.chipText}>EVIDENCE {evidence.length}</Text></View><View style={styles.chip}><Text style={styles.chipText}>COUNTER {counter.length}</Text></View></View>

    <View style={styles.analysis} testID="ai-thesis-card">
      <View style={styles.analysisHeader}><Text style={styles.sectionTitle}>AI ANALYSIS</Text><Text style={styles.chevron}>›</Text></View>
      <View testID="ai-why"><AnalysisRow label="WHY" value={thesis}/></View>
      <View testID="ai-result"><AnalysisRow label="RESULT" value={calibrated?`검증 신뢰도 ${trusted} · 근거 ${evidence.length}건`:"보정되지 않은 출력입니다. 수익 확률로 표시하지 않습니다."}/></View>
      <View testID="ai-risk"><AnalysisRow label="RISK" value={risk} tone="danger"/></View>
      <View testID="ai-learning"><AnalysisRow label="LEARNING" value={learning}/></View>
    </View>

    <View style={styles.chartPanel}>
      <View style={styles.periods}><Text style={[styles.period,{color:LIME,borderBottomColor:LIME}]}>1D</Text><Text style={styles.period}>1W</Text><Text style={styles.period}>1M</Text><Text style={styles.period}>3M</Text><Text style={styles.period}>1Y</Text></View>
      <View style={styles.chart}>
        {chart.state==="READY"?chart.bars.slice(-38).map((bar,i)=>{
          const base=chart.currentPrice??bar.close; const delta=(bar.close-base)/Math.max(1,base); const h=18+Math.min(90,Math.abs(delta)*5000+i*1.2);
          return <View key={bar.openTime} style={[styles.chartBar,{height:h,backgroundColor:bar.close>=bar.open?LIME:wealthProductColors.c54}]}/>;
        }):<View style={styles.chartEmpty}><Text style={styles.emptyTitle}>VERIFIED CHART UNAVAILABLE</Text><Text style={styles.emptyText}>실제 public candle이 확인될 때만 차트를 표시합니다.</Text></View>}
      </View>
    </View>

    <View style={styles.authority}>
      <Text style={styles.authorityTitle}>AI ZERO AUTHORITY</Text>
      <Text style={styles.authorityText}>PAPER ONLY · LIVE {liveAuthority??"NONE"} · PRODUCTION MUTATION {productionMutationAllowed===false?"BLOCKED":"UNVERIFIED"}</Text>
      <Text style={styles.authorityText}>SYSTEM {health??"UNKNOWN"} · KILL SWITCH {killSwitchActive==null?"UNKNOWN":killSwitchActive?"ACTIVE":"INACTIVE"} · RESEARCH {research?.health??"UNAVAILABLE"}</Text>
    </View>
    <View style={styles.watchButton}><Text style={styles.watchText}>☆  SIGNAL IS READ ONLY</Text></View>
    {error?<Text style={styles.error}>{error}</Text>:null}
    <View testID="ai-zero-authority-status"/>
  </ScrollView>;
}
const styles=StyleSheet.create({
 content:{paddingHorizontal:16,paddingTop:10,paddingBottom:34,gap:14,width:"100%",maxWidth:720,alignSelf:"center",backgroundColor:INK},
 topbar:{minHeight:56,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:BORDER,gap:12},back:{color:wealthProductColors.c55,fontSize:34,fontWeight:"200"},logo:{color:wealthProductColors.c56,fontSize:23,fontWeight:"900",letterSpacing:2.4},mode:{marginLeft:"auto",flexDirection:"row",alignItems:"center",gap:6},dot:{width:8,height:8,borderRadius:8,backgroundColor:LIME},modeText:{color:wealthProductColors.c57,fontSize:9,fontWeight:"800"},modeSub:{color:wealthProductColors.c58,fontSize:8,marginTop:2},
 titleRow:{height:55,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},pageTitle:{color:wealthProductColors.c59,fontSize:18,fontWeight:"800",letterSpacing:1.4},time:{color:MUTED,fontSize:8},
 assetHead:{flexDirection:"row",alignItems:"center",paddingVertical:2,gap:11},coin:{width:42,height:42,borderRadius:42,backgroundColor:wealthProductColors.c60,alignItems:"center",justifyContent:"center"},coinText:{color:"#FFF",fontSize:20,fontWeight:"900"},assetName:{flex:1},symbol:{color:wealthProductColors.c61,fontSize:19,fontWeight:"800"},assetSub:{color:MUTED,fontSize:9,marginTop:3},quote:{alignItems:"flex-end"},price:{color:wealthProductColors.c59,fontSize:18,fontWeight:"800",fontVariant:["tabular-nums"]},readOnly:{color:LIME,fontSize:8,fontWeight:"800",marginTop:4},
 chips:{flexDirection:"row",gap:7,flexWrap:"wrap"},chip:{borderWidth:1,borderColor:wealthProductColors.c62,borderRadius:6,paddingHorizontal:10,paddingVertical:7,backgroundColor:wealthProductColors.c63},chipText:{color:wealthProductColors.c64,fontSize:8,fontWeight:"900",letterSpacing:.5},
 analysis:{borderWidth:1,borderColor:BORDER,borderRadius:9,backgroundColor:PANEL,overflow:"hidden"},analysisHeader:{height:48,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},sectionTitle:{color:wealthProductColors.c59,fontSize:14,fontWeight:"900",letterSpacing:1},chevron:{color:MUTED,fontSize:22},
 analysisRow:{minHeight:76,flexDirection:"row",gap:15,paddingHorizontal:14,paddingVertical:14,borderBottomWidth:1,borderBottomColor:wealthProductColors.c65},analysisLabel:{width:66,fontSize:11,fontWeight:"900",letterSpacing:.7},analysisValue:{flex:1,color:wealthProductColors.c66,fontSize:11,lineHeight:17},
 chartPanel:{borderTopWidth:1,borderTopColor:BORDER},periods:{height:45,flexDirection:"row",alignItems:"center",gap:25},period:{height:45,lineHeight:44,borderBottomWidth:2,borderBottomColor:"transparent",color:MUTED,fontSize:9,fontWeight:"800"},
 chart:{height:180,borderTopWidth:1,borderTopColor:wealthProductColors.c67,borderBottomWidth:1,borderBottomColor:wealthProductColors.c67,flexDirection:"row",alignItems:"flex-end",gap:2,paddingHorizontal:4,paddingBottom:10,overflow:"hidden"},chartBar:{flex:1,minWidth:2,opacity:.78,borderRadius:1},
 chartEmpty:{flex:1,alignItems:"center",justifyContent:"center"},emptyTitle:{color:MUTED,fontSize:10,fontWeight:"900"},emptyText:{color:wealthProductColors.c68,fontSize:9,marginTop:7},
 authority:{borderWidth:1,borderColor:BORDER,borderRadius:8,padding:12,backgroundColor:wealthProductColors.c41},authorityTitle:{color:LIME,fontSize:9,fontWeight:"900",letterSpacing:.8},authorityText:{color:wealthProductColors.c69,fontSize:8,lineHeight:13,marginTop:5},
 watchButton:{minHeight:56,borderRadius:8,backgroundColor:LIME,alignItems:"center",justifyContent:"center"},watchText:{color:wealthProductColors.c70,fontSize:12,fontWeight:"900",letterSpacing:.8},error:{color:RED,fontSize:9},
});
