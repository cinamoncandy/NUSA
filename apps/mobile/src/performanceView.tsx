import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { buildPortfolioViewModel, type PortfolioAccountResponse } from "./portfolioViewModel";

interface PerformanceViewProps { readonly snapshot: PortfolioAccountResponse | null; }
const money=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"—":`₩${Math.round(v).toLocaleString("ko-KR")}`;
export function PerformanceView({snapshot}:PerformanceViewProps){
 const {theme}=useTheme(); let model=null as ReturnType<typeof buildPortfolioViewModel>|null; try{model=snapshot?buildPortfolioViewModel(snapshot):null}catch{model=null}
 const basis=model?model.totalEquity-model.totalPnl:null; const ret=model&&basis!=null&&basis>0?model.totalPnl/basis:null;
 const cashShare=model&&model.totalEquity>0?model.cash/model.totalEquity:null; const exposureShare=model&&model.totalEquity>0?model.assetValue/model.totalEquity:null;
 return <ScrollView style={{backgroundColor:theme.colors.background}} contentContainerStyle={styles.content} testID="performance-screen">
  <View style={styles.header}><Text style={[styles.title,{color:theme.colors.text}]}>Performance</Text><View style={[styles.mode,{borderColor:theme.colors.borderStrong}]}><Text style={[styles.modeText,{color:theme.colors.text}]}>PAPER</Text></View></View>
  <View style={styles.tabs}>{["Equity","Return","Drawdown","Allocation"].map((x,i)=><View key={x} style={[styles.tab,i===0?{borderBottomColor:theme.colors.primary}:null]}><Text style={{color:i===0?theme.colors.text:theme.colors.textMuted,fontSize:10}}>{x}</Text></View>)}</View>
  <View style={[styles.equityCard,{borderColor:theme.colors.borderStrong}]}>
   <Text style={[styles.label,{color:theme.colors.textMuted}]}>PAPER Equity</Text><Text style={[styles.equity,{color:theme.colors.text}]}>{money(model?.totalEquity)}</Text>
   <Text style={[styles.returnValue,{color:ret==null?theme.colors.textMuted:ret>=0?theme.colors.chartUp:theme.colors.chartDown}]}>{ret==null?"—":`${ret>=0?"+":""}${(ret*100).toFixed(2)}%`}</Text>
   <View style={styles.chart} testID="performance-equity-chart"><View style={[styles.chartGridA,{backgroundColor:theme.colors.border}]}/><View style={[styles.chartGridB,{backgroundColor:theme.colors.border}]}/><Text style={[styles.noHistory,{color:theme.colors.textMuted}]}>NO VERIFIED EQUITY HISTORY</Text></View>
  </View>
  <View style={styles.statList}><Row label="Total Return" value={ret==null?"—":`${(ret*100).toFixed(2)}%`}/><Row label="Max Drawdown" value="—"/><Row label="Win Rate" value="—"/><Row label="Sharpe (Ann.)" value="—"/></View>
  <View style={styles.periods}>{["1M","3M","6M","1Y","ALL"].map((x,i)=><View key={x} style={[styles.period,{borderColor:i===0?theme.colors.primary:theme.colors.border}]}><Text style={{color:i===0?theme.colors.text:theme.colors.textMuted,fontSize:9}}>{x}</Text></View>)}</View>
  <View style={[styles.allocation,{borderColor:theme.colors.border}]}>
    <Text style={[styles.allocationTitle,{color:theme.colors.text}]}>Allocation</Text>
    <View style={styles.allocationBar}><View style={[styles.cash,{width:`${Math.round((cashShare??0)*100)}%`,backgroundColor:theme.colors.aiSignalEnd}]}/><View style={[styles.exposure,{width:`${Math.round((exposureShare??0)*100)}%`,backgroundColor:theme.colors.aiSignalMid}]}/></View>
    <Row label="Cash" value={cashShare==null?"—":`${(cashShare*100).toFixed(1)}%`}/><Row label="Market Exposure" value={exposureShare==null?"—":`${(exposureShare*100).toFixed(1)}%`}/>
  </View>
  <Text style={[styles.safety,{color:theme.colors.textMuted}]}>PAPER ONLY · NO SYNTHETIC CURVE · REAL DATA ONLY</Text>
 </ScrollView>
}
function Row({label,value}:{label:string;value:string}){const {theme}=useTheme();return <View style={styles.row}><Text style={[styles.rowLabel,{color:theme.colors.textMuted}]}>{label}</Text><Text style={[styles.rowValue,{color:theme.colors.text}]}>{value}</Text></View>}
const styles=StyleSheet.create({
 content:{paddingHorizontal:20,paddingTop:16,paddingBottom:120,gap:14},header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},title:{fontSize:30,lineHeight:36,fontWeight:"700"},mode:{borderWidth:1,borderRadius:8,paddingHorizontal:10,paddingVertical:6},modeText:{fontSize:9,fontWeight:"800"},
 tabs:{height:40,flexDirection:"row",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:"#1B2830"},tab:{marginRight:20,justifyContent:"center",borderBottomWidth:2,borderBottomColor:"transparent"},
 equityCard:{borderWidth:1,borderRadius:18,backgroundColor:"#081018",padding:16},label:{fontSize:9},equity:{fontSize:30,lineHeight:36,fontWeight:"700",marginTop:4,fontVariant:["tabular-nums"]},returnValue:{fontSize:17,fontWeight:"800",marginTop:3},
 chart:{height:170,marginTop:12,backgroundColor:"#061019",position:"relative",alignItems:"center",justifyContent:"center",overflow:"hidden"},chartGridA:{position:"absolute",left:0,right:0,top:"35%",height:1},chartGridB:{position:"absolute",left:0,right:0,top:"70%",height:1},noHistory:{fontSize:9,fontWeight:"800",letterSpacing:.7},
 statList:{borderWidth:1,borderColor:"#1B2830",borderRadius:14,paddingHorizontal:14},row:{minHeight:38,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},rowLabel:{fontSize:10},rowValue:{fontSize:11,fontWeight:"800",fontVariant:["tabular-nums"]},
 periods:{flexDirection:"row",gap:7},period:{flex:1,minHeight:34,borderWidth:1,borderRadius:8,alignItems:"center",justifyContent:"center"},
 allocation:{borderWidth:1,borderRadius:16,padding:14},allocationTitle:{fontSize:13,fontWeight:"800",marginBottom:10},allocationBar:{height:16,borderRadius:16,overflow:"hidden",flexDirection:"row",backgroundColor:"#16212A"},cash:{height:"100%"},exposure:{height:"100%"},safety:{fontSize:8,fontWeight:"800",letterSpacing:1,textAlign:"center"}
});