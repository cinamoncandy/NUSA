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
const SIGNAL_TEAL=intelligenceFieldColors.terminalSignal, INK=wealthProductColors.c01, PANEL=wealthProductColors.c02, BORDER=wealthProductColors.c03, MUTED=wealthProductColors.c04, RED=wealthProductColors.c05;
const learningProvenanceLabel: Record<string, string> = { AUTO_BACKGROUND: "백그라운드 자동 실행", USER_TRIGGERED: "사용자 요청", UNKNOWN: "알 수 없음" };
const percent=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"—":`${Math.round(v*100)}%`;
function AnalysisRow({label,value,tone="lime",narrow=false}:Readonly<{label:string;value:string;tone?:"lime"|"danger"|"neutral";narrow?:boolean}>){
  return <View style={[styles.analysisRow,narrow?styles.analysisRowNarrow:null]}><Text style={[styles.analysisLabel,narrow?styles.analysisLabelNarrow:null,{color:tone==="lime"?SIGNAL_TEAL:tone==="danger"?RED:wealthProductColors.c51}]}>{label}</Text><Text style={[styles.analysisValue,narrow?styles.analysisValueNarrow:null]}>{value}</Text></View>;
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
  const signalAvailable=ai?.status==="AVAILABLE"&&Boolean(ai.thesis)&&calibrated&&evidence.length>0;
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
  return <ScrollView style={{backgroundColor:INK}} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={SIGNAL_TEAL} refreshing={refreshing} onRefresh={onRefresh}/>} testID="ai-screen">
    <View style={[styles.titleRow,viewport.narrow?styles.titleRowNarrow:null]}>
      <View><Text style={styles.pageEyebrow}>AI SIGNAL · READ ONLY</Text><Text style={styles.pageTitle}>SIGNAL DETAIL</Text></View>
      <View style={styles.titleMeta}><View style={styles.dot}/><Text style={styles.time}>{ai?.lastModelRun?new Date(ai.lastModelRun).toLocaleString("ko-KR"):"NO VERIFIED RUN"}</Text></View>
    </View>

    <View style={styles.aiDecisionSummary} testID="ai-now">
      <View style={styles.aiDecisionCopy}>
        <Text style={styles.aiDecisionHeadline}>{thesis}</Text>
        <Text style={styles.aiDecisionSub}>실제 검증 근거를 바탕으로 현재 방향성을 관찰합니다.</Text>
      </View>
      <View style={[styles.confidenceRing,{borderColor:signalAvailable?theme.colors.aiSignalMid:BORDER}]}>
        <Text style={styles.confidenceLabel}>신뢰도</Text>
        <Text style={[styles.confidenceValue,{color:signalAvailable?theme.colors.text:MUTED}]}>{trusted}</Text>
      </View>
    </View>

    <View style={styles.convergencePanel} testID="ai-convergence-signal">
      <View style={styles.convergenceHead}>
        <View><Text style={styles.sectionTitle}>AI 분석 진행 중</Text><Text style={styles.convergenceSub}>GATHER → ANALYZE → CONVERGE → DECIDE</Text></View>
        <Text style={[styles.convergenceState,{color:signalAvailable?theme.colors.aiSignalEnd:MUTED}]}>{signalAvailable?"VERIFIED":"WAITING"}</Text>
      </View>
      <View style={styles.convergenceField}>
        <View style={[styles.flowAmbient,styles.flowAmbientPurple,{backgroundColor:theme.colors.neonPurple}]}/>
        <View style={[styles.flowAmbient,styles.flowAmbientBlue,{backgroundColor:theme.colors.neonBlue}]}/>
        <View style={[styles.flowAmbient,styles.flowAmbientTeal,{backgroundColor:theme.colors.neonTeal}]}/>
        <View style={[styles.flowLine,{top:"24%",left:"2%",width:"68%",backgroundColor:theme.colors.aiSignalStart,transform:[{rotate:"11deg"}]}]}/>
        <View style={[styles.flowLine,{top:"33%",left:"3%",width:"70%",backgroundColor:theme.colors.aiSignalStart,transform:[{rotate:"7deg"}]}]}/>
        <View style={[styles.flowLine,{top:"43%",left:"5%",width:"70%",backgroundColor:theme.colors.aiSignalMid,transform:[{rotate:"3deg"}]}]}/>
        <View style={[styles.flowLine,{top:"54%",left:"5%",width:"70%",backgroundColor:theme.colors.aiSignalMid,transform:[{rotate:"-3deg"}]}]}/>
        <View style={[styles.flowLine,{top:"64%",left:"3%",width:"70%",backgroundColor:theme.colors.aiSignalEnd,transform:[{rotate:"-7deg"}]}]}/>
        <View style={[styles.flowLine,{top:"73%",left:"2%",width:"68%",backgroundColor:theme.colors.aiSignalEnd,transform:[{rotate:"-11deg"}]}]}/>
        <View style={[styles.flowBeam,{backgroundColor:signalAvailable?theme.colors.aiSignalEnd:wealthProductColors.c62}]}/>
        <View style={[styles.flowCoreOuter,{borderColor:signalAvailable?theme.colors.aiSignalMid:wealthProductColors.c62}]}>
          <View style={[styles.flowCore,{backgroundColor:signalAvailable?theme.colors.text:MUTED,shadowColor:theme.colors.aiSignalEnd}]}/>
        </View>
        <View style={styles.convergenceLabel}><Text style={[styles.convergenceLabelText,{color:signalAvailable?theme.colors.aiSignalEnd:MUTED}]}>{signalAvailable?"VERIFIED AI SIGNAL":"NO VERIFIED SIGNAL"}</Text></View>
      </View>
      <View style={styles.stageRail} testID="ai-stage-timeline">
        {convergenceStages.map((stage,index)=><View key={stage.label} style={styles.stageItem}>
          <View style={[styles.stageNode,{borderColor:stage.observed?SIGNAL_TEAL:BORDER,backgroundColor:stage.observed?SIGNAL_TEAL:INK}]}/>
          {index<convergenceStages.length-1?<View style={[styles.stageLink,{backgroundColor:stage.observed?wealthProductColors.c24:BORDER}]}/>:null}
          <Text style={[styles.stageNumber,{color:stage.observed?theme.colors.text:MUTED}]}>{index + 1}</Text>
          <Text style={[styles.stageLabel,{color:stage.observed?wealthProductColors.c59:MUTED}]}>{stage.label==="GATHER"?"수집":stage.label==="ANALYZE"?"분석":stage.label==="VERIFY"?"검증":"판단"}</Text>
          <Text style={[styles.stageStatus,{color:stage.observed?theme.colors.aiSignalEnd:MUTED}]}>{stage.observed?"완료":"대기"}</Text>
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
      <View style={styles.periods}><Text style={[styles.period,{color:SIGNAL_TEAL,borderBottomColor:SIGNAL_TEAL}]}>1D</Text><Text style={styles.period}>1W</Text><Text style={styles.period}>1M</Text><Text style={styles.period}>3M</Text><Text style={styles.period}>1Y</Text></View>
      <View style={styles.chart}>
        {chart.state==="READY"?chart.bars.slice(-38).map((bar,i)=>{
          const base=chart.currentPrice??bar.close; const delta=(bar.close-base)/Math.max(1,base); const h=18+Math.min(90,Math.abs(delta)*5000+i*1.2);
          return <View key={bar.openTime} style={[styles.chartBar,{height:h,backgroundColor:bar.close>=bar.open?SIGNAL_TEAL:wealthProductColors.c54}]}/>;
        }):<View style={styles.chartEmpty}><Text style={styles.emptyTitle}>VERIFIED CHART UNAVAILABLE</Text><Text style={styles.emptyText}>실제 public candle이 확인될 때만 차트를 표시합니다.</Text></View>}
      </View>
    </View>

    <View style={styles.analysis} testID="ai-signal-factors">
      <View style={styles.analysisHeader}><Text style={styles.sectionTitle}>SIGNAL EVIDENCE</Text><Text style={styles.time}>{evidence.length + counter.length} VERIFIED REFERENCES</Text></View>
      {evidence.length===0&&counter.length===0?<View style={{padding:14}}><Text style={styles.emptyText}>VERIFIED EVIDENCE UNAVAILABLE</Text></View>:null}
      {evidence.slice(0,3).map((item,index)=><View key={`evidence-${index}`} style={{paddingHorizontal:14,paddingVertical:11,borderBottomWidth:1,borderBottomColor:BORDER,flexDirection:"row",gap:10}}><Text style={{color:SIGNAL_TEAL,fontSize:9,fontWeight:"900",width:62}}>EVIDENCE</Text><Text style={{color:wealthProductColors.c51,fontSize:9,lineHeight:14,flex:1}} numberOfLines={3}>{String(item)}</Text></View>)}
      {counter.slice(0,2).map((item,index)=><View key={`counter-${index}`} style={{paddingHorizontal:14,paddingVertical:11,borderBottomWidth:1,borderBottomColor:BORDER,flexDirection:"row",gap:10}}><Text style={{color:RED,fontSize:9,fontWeight:"900",width:62}}>COUNTER</Text><Text style={{color:wealthProductColors.c51,fontSize:9,lineHeight:14,flex:1}} numberOfLines={3}>{String(item)}</Text></View>)}
    </View>

    <View style={styles.aiTruthContract} accessible accessibilityLabel={`PUBLIC READ ONLY · EVIDENCE ${evidence.length} · COUNTER ${counter.length}`}><Text style={styles.aiTruthContractText}>PUBLIC READ ONLY · EVIDENCE {evidence.length} · COUNTER {counter.length}</Text></View>
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
 dot:{width:8,height:8,borderRadius:8,backgroundColor:SIGNAL_TEAL},
 titleRow:{minHeight:72,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},titleRowNarrow:{height:"auto",minHeight:68,paddingVertical:10,flexWrap:"wrap",gap:6},pageEyebrow:{color:SIGNAL_TEAL,fontSize:8,fontWeight:"900",letterSpacing:1.25,marginBottom:5},pageTitle:{color:wealthProductColors.c59,fontSize:24,fontWeight:"900",letterSpacing:1.1},titleMeta:{flexDirection:"row",alignItems:"center",gap:7},time:{color:MUTED,fontSize:8},
 aiDecisionSummary:{flexDirection:"row",alignItems:"center",gap:16,paddingVertical:8},aiDecisionCopy:{flex:1,minWidth:0},aiDecisionHeadline:{color:wealthProductColors.c59,fontSize:24,lineHeight:33,fontWeight:"700",letterSpacing:-.5},aiDecisionSub:{color:MUTED,fontSize:10,lineHeight:16,marginTop:8},confidenceRing:{width:82,height:82,borderRadius:82,borderWidth:5,alignItems:"center",justifyContent:"center",backgroundColor:wealthProductColors.c31},confidenceLabel:{color:MUTED,fontSize:8,fontWeight:"800"},confidenceValue:{fontSize:18,fontWeight:"900",marginTop:2,fontVariant:["tabular-nums"]},
 convergencePanel:{backgroundColor:INK},
 convergenceHead:{minHeight:58,paddingHorizontal:4,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},convergenceSub:{color:MUTED,fontSize:7,fontWeight:"800",letterSpacing:.55,marginTop:4},convergenceState:{fontSize:9,fontWeight:"900",letterSpacing:1},
 convergenceField:{height:300,position:"relative",overflow:"hidden",backgroundColor:wealthProductColors.c28,borderWidth:1,borderColor:wealthProductColors.c24,borderRadius:24},
 flowAmbient:{position:"absolute",width:190,height:190,borderRadius:190,opacity:.12},
 flowAmbientPurple:{left:-82,top:-38},flowAmbientBlue:{left:"32%",top:54,opacity:.09},flowAmbientTeal:{right:-72,bottom:-42,opacity:.1},
 flowLine:{position:"absolute",height:1.5,borderRadius:2,opacity:.72},
 flowBeam:{position:"absolute",right:"18%",top:"18%",bottom:"18%",width:1.5,opacity:.65},
 flowCoreOuter:{position:"absolute",right:"12%",top:"36%",width:66,height:66,borderRadius:66,borderWidth:1,alignItems:"center",justifyContent:"center",backgroundColor:wealthProductColors.c31},
 flowCore:{width:10,height:10,borderRadius:10,shadowOpacity:.9,shadowRadius:18},
 convergenceLabel:{position:"absolute",right:18,bottom:20,paddingHorizontal:11,paddingVertical:6,borderWidth:1,borderColor:wealthProductColors.c24,borderRadius:999,backgroundColor:wealthProductColors.c31},convergenceLabelText:{fontSize:8,fontWeight:"900",letterSpacing:.8},
 stageRail:{minHeight:196,flexDirection:"column",paddingHorizontal:4,paddingTop:14,paddingBottom:10,gap:8},stageItem:{minHeight:40,flexDirection:"row",alignItems:"center",position:"relative",borderWidth:1,borderColor:BORDER,borderRadius:10,paddingHorizontal:12,gap:10,backgroundColor:PANEL},stageNode:{width:8,height:8,borderRadius:8,borderWidth:1,zIndex:2},stageLink:{display:"none"},stageNumber:{width:22,height:22,borderRadius:22,borderWidth:1,borderColor:BORDER,textAlign:"center",lineHeight:20,fontSize:9,fontWeight:"900"},stageLabel:{flex:1,fontSize:10,fontWeight:"900",letterSpacing:.35,marginTop:0},stageStatus:{fontSize:8,fontWeight:"900",marginTop:0},
 analysis:{borderWidth:1,borderColor:BORDER,borderRadius:18,backgroundColor:PANEL,overflow:"hidden"},analysisHeader:{height:48,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderBottomColor:BORDER},sectionTitle:{color:wealthProductColors.c59,fontSize:14,fontWeight:"900",letterSpacing:1},chevron:{color:MUTED,fontSize:22},
 analysisRow:{minHeight:82,flexDirection:"row",gap:15,paddingHorizontal:14,paddingVertical:14,borderBottomWidth:1,borderBottomColor:wealthProductColors.c65},analysisRowNarrow:{minHeight:0,flexDirection:"column",gap:6},analysisLabel:{width:66,fontSize:11,fontWeight:"900",letterSpacing:.7},analysisLabelNarrow:{width:"100%"},analysisValue:{flex:1,color:wealthProductColors.c66,fontSize:11,lineHeight:17},analysisValueNarrow:{flexGrow:0,width:"100%"},
 chartPanel:{borderTopWidth:1,borderTopColor:BORDER},periods:{height:45,flexDirection:"row",alignItems:"center",gap:25},period:{height:45,lineHeight:44,borderBottomWidth:2,borderBottomColor:"transparent",color:MUTED,fontSize:9,fontWeight:"800"},
 chart:{height:194,borderTopWidth:1,borderTopColor:wealthProductColors.c67,borderBottomWidth:1,borderBottomColor:wealthProductColors.c67,flexDirection:"row",alignItems:"flex-end",gap:2,paddingHorizontal:4,paddingBottom:10,overflow:"hidden"},chartBar:{flex:1,minWidth:2,opacity:.78,borderRadius:1},
 chartEmpty:{flex:1,alignItems:"center",justifyContent:"center"},emptyTitle:{color:MUTED,fontSize:10,fontWeight:"900"},emptyText:{color:wealthProductColors.c68,fontSize:9,marginTop:7},
 authority:{borderWidth:1,borderColor:BORDER,borderRadius:8,padding:12,backgroundColor:wealthProductColors.c41},authorityTitle:{color:SIGNAL_TEAL,fontSize:9,fontWeight:"900",letterSpacing:.8},authorityText:{color:wealthProductColors.c69,fontSize:8,lineHeight:13,marginTop:5},
 aiTruthContract:{position:"absolute",width:1,height:1,opacity:0},aiTruthContractText:{fontSize:1},
 watchButton:{minHeight:48,borderWidth:1,borderColor:wealthProductColors.c24,borderRadius:16,backgroundColor:wealthProductColors.c31,alignItems:"center",justifyContent:"center"},watchText:{color:SIGNAL_TEAL,fontSize:9,fontWeight:"900",letterSpacing:.9},error:{color:RED,fontSize:9},
});
