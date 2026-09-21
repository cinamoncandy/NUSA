import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { AiReadOnlyProjection } from "../../../packages/contracts/src/aiInference";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { useTheme } from "./ThemeProvider";
import { intelligenceFieldColors, wealthProductColors } from "./designSystem";
import { buildChartViewModel, type PublicCandle } from "./chartViewModel";
import { getMobileViewportProfile } from "./mobileViewportProfile";

interface AiViewProps {
  readonly ai: AiReadOnlyProjection | null; readonly research: ResearchStatusProjection | null;
  readonly health: string | null; readonly liveAuthority: "NONE" | null; readonly productionMutationAllowed: false | null;
  readonly killSwitchActive: boolean | null; readonly error: string | null; readonly refreshing: boolean; readonly onRefresh: () => void;
  readonly market?: string; readonly currentPrice?: number | null; readonly rawCandles?: readonly PublicCandle[] | null;
  readonly marketConnectionState?: string; readonly stale?: boolean;
}
const LIME=intelligenceFieldColors.terminalSignal, INK=wealthProductColors.c01, PANEL=wealthProductColors.c02, BORDER=wealthProductColors.c03, MUTED=wealthProductColors.c04, RED=wealthProductColors.c05;
const learningProvenanceLabel: Record<string, string> = { AUTO_BACKGROUND: "백그라운드 자동 실행", USER_TRIGGERED: "사용자 요청", UNKNOWN: "알 수 없음" };
const percent=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"—":`${Math.round(v*100)}%`;
function AnalysisRow({label,value,tone="lime",narrow=false}:Readonly<{label:string;value:string;tone?:"lime"|"danger"|"neutral";narrow?:boolean}>){
  return <View style={[styles.analysisRow,narrow?styles.analysisRowNarrow:null]}><Text style={[styles.analysisLabel,narrow?styles.analysisLabelNarrow:null,{color:tone==="lime"?LIME:tone==="danger"?RED:wealthProductColors.c51}]}>{label}</Text><Text style={[styles.analysisValue,narrow?styles.analysisValueNarrow:null]}>{value}</Text></View>;
}
export function AiView({ai,research,health,liveAuthority,productionMutationAllowed,killSwitchActive,error,refreshing,onRefresh,market="KRW-BTC",currentPrice=null,rawCandles=null,marketConnectionState="UNKNOWN",stale=true}:AiViewProps){
  const {theme}=useTheme();
  const {width}=useWindowDimensions();
  const viewport=getMobileViewportProfile(width);
  const chart=buildChartViewModel({market,interval:"1m",rawCandles:rawCandles===null?null:[...rawCandles],currentPrice,connectionState:marketConnectionState,stale});
  const symbol=market.replace("KRW-","");
  const calibrated=ai?.calibrationStatus==="CALIBRATED";
  const trusted=calibrated?percent(ai?.confidence):"UNVERIFIED";
  const evidence=ai?.evidenceReferences ?? [];
  const counter=ai?.counterEvidence ?? [];
  const thesis=ai?.status==="AVAILABLE"&&ai.thesis?ai.thesis:"검증된 AI 판단이 아직 없습니다.";
  const risk=counter.length>0?counter.slice(0,2).join(" · "):"검증된 반대 근거가 없습니다.";
  const learningProvenance = ai?.learningProvenance ?? "UNKNOWN";
  const learning=ai?.recentLessonCount==null?"학습 근거를 확인할 수 없습니다.":`검증된 과거 사례 ${ai.recentLessonCount}건을 현재 판단에 참고했습니다.`;
  const convergenceStages = [
    { label: "GATHER", observed: chart.state === "READY" || currentPrice != null },
    { label: "ANALYZE", observed: ai?.lastModelRun != null },
    { label: "VERIFY", observed: calibrated && evidence.length > 0 },
    { label: "DECIDE", observed: ai?.status === "AVAILABLE" && Boolean(ai.thesis) },
  ] as const;
  return <ScrollView style={{backgroundColor:INK}} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={LIME} refreshing={refreshing} onRefresh={onRefresh}/>} testID="ai-screen">
    <View style={[styles.titleRow,viewport.narrow?styles.titleRowNarrow:null]}>
      <View><Text style={styles.pageEyebrow}>AI SIGNAL · READ ONLY</Text><Text style={styles.pageTitle}>SIGNAL DETAIL</Text></View>
      <View style={styles.titleMeta}><View style={styles.dot}/><Text style={styles.time}>{ai?.lastModelRun?new Date(ai.lastModelRun).toLocaleString("ko-KR"):"NO VERIFIED RUN"}</Text></View>
    </View>

    <View style={[styles.assetHead,viewport.narrow?styles.assetHeadNarrow:null]} testID="ai-now">
      <View style={styles.coin}><Text style={styles.coinText}>{symbol.slice(0,1)}</Text></View>
      <View style={styles.assetName}><Text style={styles.symbol}>{symbol}</Text><Text style={styles.assetSub}>{market}</Text></View>
      <View style={[styles.quote,viewport.narrow?styles.quoteNarrow:null]}><Text style={styles.price}>{currentPrice==null?"—":`₩${Math.round(currentPrice).toLocaleString("ko-KR")}`}</Text><Text style={styles.readOnly}>PUBLIC READ ONLY</Text></View>
    </View>

    <View style={styles.chips}><View style={[styles.chip,{backgroundColor:calibrated?wealthProductColors.c52:wealthProductColors.c53}]}><Text style={[styles.chipText,{color:calibrated?LIME:MUTED}]}>{calibrated?"CALIBRATED":"UNVERIFIED"}</Text></View><View style={styles.chip}><Text style={styles.chipText}>EVIDENCE {evidence.length}</Text></View><View style={styles.chip}><Text style={styles.chipText}>COUNTER {counter.length}</Text></View></View>

    <View style={styles.convergencePanel} testID="ai-convergence-signal">
      <View style={styles.convergenceHead}>
        <View><Text style={styles.sectionTitle}>SIGNAL CONVERGENCE</Text><Text style={styles.convergenceSub}>OBSERVATION → EVIDENCE → VERIFIED JUDGEMENT</Text></View>
        <Text style={[styles.convergenceState,{color:signalAvailable?LIME:MUTED}]}>{signalAvailable?"VERIFIED":"WAITING"}</Text>
      </View>
      <View style={styles.convergenceField}>
        {[0,45,90,135].map((deg)=><View key={deg} style={[styles.convergenceRay,{backgroundColor:signalAvailable?LIME:wealthProductColors.c62,transform:[{rotate:`${deg}deg`}]}]}/>)}
        <View style={[styles.signalRingOuter,{borderColor:signalAvailable?LIME:wealthProductColors.c62}]}>
          <View style={[styles.signalRingInner,{borderColor:signalAvailable?LIME:wealthProductColors.c62}]}>
            <View style={[styles.signalCore,{backgroundColor:signalAvailable?LIME:MUTED}]}/>
          </View>
        </View>
        <View style={styles.convergenceLabel}><Text style={[styles.convergenceLabelText,{color:signalAvailable?LIME:MUTED}]}>{signalAvailable?"VERIFIED AI SIGNAL":"NO VERIFIED SIGNAL"}</Text></View>
      </View>
      <View style={styles.stageRail} testID="ai-stage-timeline">
        {convergenceStages.map((stage,index)=><View key={stage.label} style={styles.stageItem}>
          <View style={[styles.stageNode,{borderColor:stage.observed?LIME:BORDER,backgroundColor:stage.observed?LIME:INK}]}/>
          {index<convergenceStages.length-1?<View style={[styles.stageLink,{backgroundColor:stage.observed?wealthProductColors.c24:BORDER}]}/>:null}
          <Text style={[styles.stageLabel,{color:stage.observed?wealthProductColors.c59:MUTED}]}>{stage.label}</Text>
          <Text style={[styles.stageStatus,{color:stage.observed?LIME:MUTED}]}>{stage.observed?"OBSERVED":"WAITING"}</Text>
        </View>)}
      </View>
    </View>

    <View style={styles.analysis} testID="ai-thesis-card">
      <View style={styles.analysisHeader}><Text style={styles.sectionTitle}>AI ANALYSIS</Text><Text style={styles.chevron}>›</Text></View>
      <View testID="ai-why"><AnalysisRow label="WHY" narrow={viewport.narrow} value={thesis}/></View>
      <View testID="ai-result"><AnalysisRow label="RESULT" narrow={viewport.narrow} value={calibrated?`검증 신뢰도 ${trusted} · 근거 ${evidence.length}건`:"보정되지 않은 출력입니다. 수익 확률로 표시하지 않습니다."}/></View>
      <View testID="ai-risk"><AnalysisRow label="RISK" narrow={viewport.narrow} value={risk} tone="danger"/></View>
      <View testID="ai-learning"><AnalysisRow label="LEARNING" narrow={viewport.narrow} value={learning}/><AnalysisRow label="PROVENANCE" narrow={viewport.narrow} value={learningProvenanceLabel[learningProvenance] ?? learningProvenanceLabel.UNKNOWN}/></View>
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

    <View style={styles.analysis} testID="ai-signal-factors">
      <View style={styles.analysisHeader}><Text style={styles.sectionTitle}>SIGNAL EVIDENCE</Text><Text style={styles.time}>{evidence.length + counter.length} VERIFIED REFERENCES</Text></View>
      {evidence.length===0&&counter.length===0?<View style={{padding:14}}><Text style={styles.emptyText}>VERIFIED EVIDENCE UNAVAILABLE</Text></View>:null}
      {evidence.slice(0,3).map((item,index)=><View key={`evidence-${index}`} style={{paddingHorizontal:14,paddingVertical:11,borderBottomWidth:1,borderBottomColor:BORDER,flexDirection:"row",gap:10}}><Text style={{color:LIME,fontSize:9,fontWeight:"900",width:62}}>EVIDENCE</Text><Text style={{color:wealthProductColors.c51,fontSize:9,lineHeight:14,flex:1}} numberOfLines={3}>{String(item)}</Text></View>)}
      {counter.slice(0,2).map((item,index)=><View key={`counter-${index}`} style={{paddingHorizontal:14,paddingVertical:11,borderBottomWidth:1,borderBottomColor:BORDER,flexDirection:"row",gap:10}}><Text style={{color:RED,fontSize:9,fontWeight:"900",width:62}}>COUNTER</Text><Text style={{color:wealthProductColors.c51,fontSize:9,lineHeight:14,flex:1}} numberOfLines={3}>{String(item)}</Text></View>)}
    </View>

    <View style={styles.authority} testID="ai-zero-authority-status">
      <Text style={styles.authorityTitle}>AI ZERO AUTHORITY</Text>
      <Text style={styles.authorityText}>PAPER ONLY · LIVE {liveAuthority??"NONE"} · PRODUCTION MUTATION {productionMutationAllowed===false?"BLOCKED":"UNVERIFIED"}</Text>
      <Text style={styles.authorityText}>SYSTEM {health??"UNKNOWN"} · KILL SWITCH {killSwitchActive==null?"UNKNOWN":killSwitchActive?"ACTIVE":"INACTIVE"} · RESEARCH {research?.health??"UNAVAILABLE"}</Text>
    </View>
    <View style={styles.watchButton}><Text style={styles.watchText}>SIGNAL IS READ ONLY · ZERO AUTHORITY</Text></View>
    {error?<Text style={styles.error}>{error}</Text>:null}
  </ScrollView>;
}
const styles=StyleSheet.create({
 content:{paddingHorizontal:18,paddingTop:10,paddingBottom:34,gap:12,width:"100%",maxWidth:720,alignSelf:"center",backgroundColor:INK},
 dot:{width:8,height:8,borderRadius:8,backgroundColor:LIME},
 titleRow:{minHeight:72,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},titleRowNarrow:{height:"auto",minHeight:68,paddingVertical:10,flexWrap:"wrap",gap:6},pageEyebrow:{color:LIME,fontSize:8,fontWeight:"900",letterSpacing:1.25,marginBottom:5},pageTitle:{color:wealthProductColors.c59,fontSize:24,fontWeight:"900",letterSpacing:1.1},titleMeta:{flexDirection:"row",alignItems:"center",gap:7},time:{color:MUTED,fontSize:8},
 assetHead:{flexDirection:"row",alignItems:"center",paddingVertical:2,gap:11},assetHeadNarrow:{flexWrap:"wrap"},coin:{width:46,height:46,borderRadius:46,backgroundColor:wealthProductColors.c60,alignItems:"center",justifyContent:"center"},coinText:{color:wealthProductColors.c08,fontSize:20,fontWeight:"900"},assetName:{flex:1},symbol:{color:wealthProductColors.c61,fontSize:20,fontWeight:"800"},assetSub:{color:MUTED,fontSize:9,marginTop:3},quote:{alignItems:"flex-end"},quoteNarrow:{width:"100%",alignItems:"flex-start",paddingLeft:57},price:{color:wealthProductColors.c59,fontSize:20,fontWeight:"800",fontVariant:["tabular-nums"]},readOnly:{color:LIME,fontSize:8,fontWeight:"800",marginTop:4},
 chips:{flexDirection:"row",gap:7,flexWrap:"wrap"},chip:{borderWidth:1,borderColor:wealthProductColors.c62,borderRadius:6,paddingHorizontal:10,paddingVertical:7,backgroundColor:wealthProductColors.c63},chipText:{color:wealthProductColors.c64,fontSize:8,fontWeight:"900",letterSpacing:.5},
 convergencePanel:{borderTopWidth:1,borderBottomWidth:1,borderColor:BORDER,backgroundColor:INK},
 convergenceHead:{minHeight:58,paddingHorizontal:4,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},convergenceSub:{color:MUTED,fontSize:7,fontWeight:"800",letterSpacing:.55,marginTop:4},convergenceState:{fontSize:9,fontWeight:"900",letterSpacing:1},
 convergenceField:{height:244,position:"relative",alignItems:"center",justifyContent:"center",overflow:"hidden",backgroundColor:wealthProductColors.c28},
 convergenceRay:{position:"absolute",width:220,height:1,left:"50%",top:"50%",marginLeft:-110,opacity:.72},
 signalRingOuter:{width:118,height:118,borderRadius:118,borderWidth:1,alignItems:"center",justifyContent:"center",backgroundColor:wealthProductColors.c31},
 signalRingInner:{width:70,height:70,borderRadius:70,borderWidth:1,alignItems:"center",justifyContent:"center"},signalCore:{width:15,height:15,borderRadius:15,shadowColor:LIME,shadowOpacity:.65,shadowRadius:12},
 convergenceLabel:{position:"absolute",bottom:24,paddingHorizontal:10,paddingVertical:6,borderWidth:1,borderColor:BORDER,backgroundColor:INK},convergenceLabelText:{fontSize:9,fontWeight:"900",letterSpacing:.8},
 stageRail:{minHeight:90,flexDirection:"row",paddingHorizontal:4,paddingTop:14,paddingBottom:10},stageItem:{flex:1,alignItems:"center",position:"relative"},stageNode:{width:10,height:10,borderRadius:10,borderWidth:2,zIndex:2},stageLink:{position:"absolute",top:4,left:"55%",width:"90%",height:1},stageLabel:{fontSize:8,fontWeight:"900",letterSpacing:.55,marginTop:10},stageStatus:{fontSize:7,fontWeight:"900",marginTop:4},
 analysis:{borderWidth:1,borderColor:BORDER,borderRadius:4,backgroundColor:PANEL,overflow:"hidden"},analysisHeader:{height:48,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},sectionTitle:{color:wealthProductColors.c59,fontSize:14,fontWeight:"900",letterSpacing:1},chevron:{color:MUTED,fontSize:22},
 analysisRow:{minHeight:82,flexDirection:"row",gap:15,paddingHorizontal:14,paddingVertical:14,borderBottomWidth:1,borderBottomColor:wealthProductColors.c65},analysisRowNarrow:{minHeight:0,flexDirection:"column",gap:6},analysisLabel:{width:66,fontSize:11,fontWeight:"900",letterSpacing:.7},analysisLabelNarrow:{width:"100%"},analysisValue:{flex:1,color:wealthProductColors.c66,fontSize:11,lineHeight:17},analysisValueNarrow:{flexGrow:0,width:"100%"},
 chartPanel:{borderTopWidth:1,borderTopColor:BORDER},periods:{height:45,flexDirection:"row",alignItems:"center",gap:25},period:{height:45,lineHeight:44,borderBottomWidth:2,borderBottomColor:"transparent",color:MUTED,fontSize:9,fontWeight:"800"},
 chart:{height:194,borderTopWidth:1,borderTopColor:wealthProductColors.c67,borderBottomWidth:1,borderBottomColor:wealthProductColors.c67,flexDirection:"row",alignItems:"flex-end",gap:2,paddingHorizontal:4,paddingBottom:10,overflow:"hidden"},chartBar:{flex:1,minWidth:2,opacity:.78,borderRadius:1},
 chartEmpty:{flex:1,alignItems:"center",justifyContent:"center"},emptyTitle:{color:MUTED,fontSize:10,fontWeight:"900"},emptyText:{color:wealthProductColors.c68,fontSize:9,marginTop:7},
 authority:{borderWidth:1,borderColor:BORDER,borderRadius:8,padding:12,backgroundColor:wealthProductColors.c41},authorityTitle:{color:LIME,fontSize:9,fontWeight:"900",letterSpacing:.8},authorityText:{color:wealthProductColors.c69,fontSize:8,lineHeight:13,marginTop:5},
 watchButton:{minHeight:48,borderWidth:1,borderColor:LIME,borderRadius:4,backgroundColor:"transparent",alignItems:"center",justifyContent:"center"},watchText:{color:LIME,fontSize:9,fontWeight:"900",letterSpacing:.9},error:{color:RED,fontSize:9},
});
