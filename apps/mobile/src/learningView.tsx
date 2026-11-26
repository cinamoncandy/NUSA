import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PaperShadowMonitorView } from "./paperShadowMonitorView";
import { buildLearningScreen, splitHeroLines } from "./learningScreenModel";
import { buildLearningFunnel } from "./learningFunnelModel";
import { LearningFunnel } from "./learningFunnel";
import { AiShell } from "./aiKit";
import { plainScreenChip } from "./stageTraceModel";
import { InstrumentHero, PressScale, Reveal, SectionLabel, useReducedMotion } from "./instrumentKit";
import { CalmTiles } from "./uiKit";
import { calmColors, calmToneColor } from "./uiKitModel";
import { latticePalette, readableFont } from "./designSystem";
import { chainLinePercents, loopChain } from "./loopChainModel";
import { CostWaterfall, NullComparison, OverfitGate, PaperResultBars, StudyTimeline } from "./learningPanels";

type Props = React.ComponentProps<typeof PaperShadowMonitorView> & { /** Server heartbeat learningFunnel (display only); null when stale or absent. */ readonly learningFunnel?: unknown; /** Server heartbeat learningLoop (display only): measured numbers for the panels; null when absent. */ readonly learningLoop?: unknown; /** Server heartbeat orderBookStudy (display only): the pre-registered study result; null when absent. */ readonly orderBookStudy?: unknown; /** The server is healthy with no order path (COLLECT_ONLY): a paused loop is worded as the designed state. */ readonly collectOnly?: boolean };

/**
 * "학습" — calm redesign of the PAPER tab. The summary is new; the full read-only monitors
 * (운영/학습/재현/실계좌) stay available behind "자세히 보기" so no evidence is removed.
 */
export function LearningView(props: Props) {
  const [details, setDetails] = useState(false);
  const reduced = useReducedMotion();
  const { learningFunnel, learningLoop, orderBookStudy, collectOnly, ...monitorProps } = props;
  const model = buildLearningScreen(props.paper, { collectOnly: collectOnly === true });
  const funnel = buildLearningFunnel(learningFunnel);
  if (details) return <AiShell chip={plainScreenChip("LEARN")}><View style={styles.screen}>
    <Pressable accessibilityRole="button" onPress={() => setDetails(false)} style={styles.back} testID="learning-summary-back"><Text style={styles.backText}>‹ Lab 요약</Text></Pressable>
    <PaperShadowMonitorView {...monitorProps} embedded />
  </View></AiShell>;
  return <AiShell chip={plainScreenChip("LEARN")}><ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="learning-view">
    {funnel ? <LearningFunnel model={funnel} /> : <>
      <InstrumentHero index="02 / Lab" lines={splitHeroLines(model.headline).map((text) => ({ text, color: calmToneColor(model.tone) }))} label={model.headline} />
      {model.sub ? <Reveal index={1} reducedMotion={reduced}><Text style={styles.sub}>{model.sub}</Text></Reveal> : null}
    </>}
    <PressScale accessibilityRole="button" onPress={() => setDetails(true)} style={styles.fold} testID="learning-details">
      <Text style={styles.foldText}>자세히 보기 (운영 · 학습 · 재현 · 실계좌)</Text><Text style={styles.foldText}>›</Text>
    </PressScale>
    <View style={styles.labelWrap}><SectionLabel left="PAPER 연계 · 모의투자" right={`${model.steps.filter((x) => x.state === "DONE").length} / ${model.steps.length}`} /></View>
    <LoopChainStrip steps={model.steps} />
    {model.narrowest ? <Text style={styles.narrow}>{model.narrowest}</Text> : null}
    {model.rows.length === 0 ? null : <View style={styles.labelWrap}><SectionLabel left="성과 · 모의투자" right={`${model.rows.length}`} /></View>}
    {model.rows.length === 0 || model.periodLabel == null ? null : <Text style={styles.period} testID="learning-result-period">{model.periodLabel}</Text>}
    <View style={styles.list}><Reveal index={2} reducedMotion={reduced}><CalmTiles rows={model.rows} testID="learning-result-tiles" /></Reveal></View>
    <CostWaterfall raw={learningLoop} />
    <NullComparison raw={learningLoop} />
    <PaperResultBars raw={learningLoop} />
    <OverfitGate raw={learningLoop} />
    <StudyTimeline nowMs={Date.now()} orderBookStudy={orderBookStudy} />
  </ScrollView></AiShell>;
}

/** The loop as one chain: confirmed nodes lit, the line lit up to the last confirmed one, the next unconfirmed step ringed in ice. Static. */
function LoopChainStrip({ steps }: { readonly steps: readonly { readonly label: string; readonly state: "DONE" | "NONE" | "BLOCKED" }[] }) {
  const chain = loopChain(steps);
  const line = chainLinePercents(steps.length, chain.lastDone);
  return <View style={styles.track} testID="learning-loop-chain" accessibilityLabel={steps.map((s) => `${s.label} ${s.state === "DONE" ? "확인" : s.state === "BLOCKED" ? "막힘" : "없음"}`).join(", ")}>
    <View style={[styles.chainLine, { left: `${line.start}%`, right: `${100 - line.end}%` }]} />
    {chain.lastDone >= 0 ? <View style={[styles.chainLit, { left: `${line.start}%`, right: `${100 - line.litEnd}%` }]} /> : null}
    {steps.map((step, i) => <View key={step.label} style={styles.step}>
      <View style={[styles.node, step.state === "DONE" ? styles.done : step.state === "BLOCKED" ? styles.blocked : chain.nextIndex === i ? styles.next : null]} />
      <Text style={styles.stepLabel}>{step.label}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  sub: { color: calmColors.muted, fontSize: readableFont(14), lineHeight: 21, paddingHorizontal: 20, marginTop: 10, marginBottom: 8 },
  labelWrap: { paddingHorizontal: 20, marginTop: 10 },
  track: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 20, paddingVertical: 14, position: "relative" },
  // The line sits behind the nodes at the height of their centres (14 px nodes, 14 px strip padding): the hairline top is 21 (14 + 7); the 1.5 px lit line starts half a pixel higher so both are centred on the same y.
  chainLine: { position: "absolute", top: 14 + 7, height: StyleSheet.hairlineWidth, backgroundColor: calmColors.line },
  chainLit: { position: "absolute", top: 14 + 7 - 0.5, height: 1.5, backgroundColor: calmColors.text, opacity: 0.7 },
  step: { alignItems: "center", gap: 6, flex: 1 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: calmColors.muted, backgroundColor: calmColors.ground },
  done: { backgroundColor: calmColors.text, borderColor: calmColors.text },
  blocked: { borderColor: calmColors.attention },
  next: { borderColor: latticePalette.ice, borderWidth: 2 },
  stepLabel: { color: calmColors.muted, fontSize: readableFont(12) },
  narrow: { color: calmColors.attention, fontSize: readableFont(14), lineHeight: 21, marginHorizontal: 20, marginBottom: 6 },
  list: { paddingHorizontal: 20 },
  period: { color: calmColors.muted, fontSize: readableFont(12), lineHeight: 18, paddingHorizontal: 20, marginTop: 2, marginBottom: 4 },
  fold: { marginHorizontal: 20, marginTop: 8, minHeight: 52, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  foldText: { color: calmColors.text, fontSize: readableFont(14) },
  back: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, backgroundColor: "transparent" },
  backText: { color: calmColors.muted, fontSize: readableFont(14) },
});
