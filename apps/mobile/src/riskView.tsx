import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./ThemeProvider";
import { wealthProductColors } from "./designSystem";
import { buildPortfolioViewModel, type PortfolioAccountResponse } from "./portfolioViewModel";
import { MasterHeroImage } from "./masterHeroImage";

interface RiskViewProps { readonly snapshot: PortfolioAccountResponse | null; }
const pct=(v:number|null)=>v==null||!Number.isFinite(v)?"—":`${(v*100).toFixed(1)}%`;

export function RiskView({snapshot}:RiskViewProps){
  const {theme}=useTheme();
  let model=null as ReturnType<typeof buildPortfolioViewModel>|null;
  try{ model=snapshot?buildPortfolioViewModel(snapshot):null; }catch{ model=null; }
  const exposure=model&&model.totalEquity>0?model.assetValue/model.totalEquity:null;
  const cash=model&&model.totalEquity>0?model.cash/model.totalEquity:null;
  const concentration=model?.position?1:null;
  return <ScrollView style={{backgroundColor:theme.colors.background}} contentContainerStyle={styles.content} testID="risk-screen">
    <Text style={[styles.title,{color:theme.colors.text}]}>Risk</Text>
    <View style={styles.tabs}>{["Overview","Exposure","Stress","Alerts"].map((x,i)=><View key={x} style={[styles.tab,i===0?{borderBottomColor:theme.colors.primary}:null]}><Text style={{color:i===0?theme.colors.text:theme.colors.textMuted,fontSize:10}}>{x}</Text></View>)}</View>
    <View style={[styles.sphereCard,{borderColor:theme.colors.borderStrong}]}>
      <MasterHeroImage asset="riskSphere" style={styles.sphereVisual} imageStyle={styles.sphereImage} scrimOpacity={0.06} testID="risk-master-sphere">
        <View style={styles.sphereBadge}><Text style={[styles.sphereWord,{color:theme.colors.text}]}>RISK</Text></View>
      </MasterHeroImage>
      <View style={styles.riskLegend}>
        <Text style={[styles.legendKey,{color:theme.colors.textMuted}]}>Market</Text><Text style={[styles.legendValue,{color:theme.colors.warning}]}>NO VERIFIED SCORE</Text>
        <Text style={[styles.legendKey,{color:theme.colors.textMuted}]}>Exposure</Text><Text style={[styles.legendValue,{color:theme.colors.aiSignalEnd}]}>{pct(exposure)}</Text>
        <Text style={[styles.legendKey,{color:theme.colors.textMuted}]}>Cash</Text><Text style={[styles.legendValue,{color:theme.colors.aiSignalEnd}]}>{pct(cash)}</Text>
      </View>
    </View>
    <View style={styles.metrics}>
      <Metric label="PORTFOLIO VAR" value="—"/><Metric label="MAX DRAWDOWN" value="—"/><Metric label="SHARPE (ANN.)" value="—"/>
    </View>
    <View style={[styles.map,{borderColor:theme.colors.border}]}>
      <Text style={[styles.mapTitle,{color:theme.colors.text}]}>Risk Map</Text>
      <View style={styles.mapGrid}><View style={[styles.axisH,{backgroundColor:theme.colors.borderStrong}]}/><View style={[styles.axisV,{backgroundColor:theme.colors.borderStrong}]}/>{model?.position?<View style={[styles.mapPoint,{backgroundColor:theme.colors.warning,left:"68%",top:"35%"}]}/>:null}</View>
      <Text style={[styles.note,{color:theme.colors.textMuted}]}>{concentration==null?"NO VERIFIED POSITION RISK DATA":"Single verified PAPER position shown; VaR/drawdown/Sharpe require additional evidence."}</Text>
    </View>
    <Text style={[styles.safety,{color:theme.colors.textMuted}]}>PAPER ONLY · REAL DATA ONLY · UNKNOWN ≠ SAFE</Text>
  </ScrollView>;
}
function Metric({label,value}:{label:string;value:string}){const {theme}=useTheme();return <View style={[styles.metric,{borderColor:theme.colors.border}]}><Text style={[styles.metricValue,{color:theme.colors.text}]}>{value}</Text><Text style={[styles.metricLabel,{color:theme.colors.textMuted}]}>{label}</Text></View>}
const styles=StyleSheet.create({
 content:{paddingHorizontal:20,paddingTop:16,paddingBottom:120,gap:14},title:{fontSize:30,lineHeight:36,fontWeight:"700"},
 tabs:{height:40,flexDirection:"row",borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:wealthProductColors.c73},tab:{marginRight:22,justifyContent:"center",borderBottomWidth:2,borderBottomColor:"transparent"},
 sphereCard:{minHeight:300,borderWidth:1,borderRadius:18,backgroundColor:wealthProductColors.c74,padding:14,flexDirection:"row",alignItems:"center",gap:14,overflow:"hidden"},
 sphereVisual:{width:208,height:248,borderRadius:150,alignItems:"center",justifyContent:"center"},sphereImage:{borderRadius:150},sphereBadge:{width:58,height:58,borderRadius:58,backgroundColor:"rgba(3,8,10,0.52)",alignItems:"center",justifyContent:"center",borderWidth:StyleSheet.hairlineWidth,borderColor:"rgba(221,249,168,0.34)"},sphereWord:{fontSize:14,fontWeight:"800",letterSpacing:1.2},
 riskLegend:{flex:1,gap:6},legendKey:{fontSize:9},legendValue:{fontSize:11,fontWeight:"800",marginBottom:7},
 metrics:{flexDirection:"row",gap:8},metric:{flex:1,minHeight:72,borderWidth:1,borderRadius:12,padding:10,justifyContent:"center"},metricValue:{fontSize:16,fontWeight:"800"},metricLabel:{fontSize:7,fontWeight:"800",marginTop:4},
 map:{borderWidth:1,borderRadius:16,padding:14,gap:10},mapTitle:{fontSize:13,fontWeight:"800"},mapGrid:{height:130,position:"relative",backgroundColor:wealthProductColors.c112},axisH:{position:"absolute",left:18,right:8,bottom:22,height:1},axisV:{position:"absolute",left:18,top:10,bottom:22,width:1},mapPoint:{position:"absolute",width:13,height:13,borderRadius:13},note:{fontSize:9,lineHeight:14},safety:{fontSize:8,fontWeight:"800",letterSpacing:1,textAlign:"center"}
});