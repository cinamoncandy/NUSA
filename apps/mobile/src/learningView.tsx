import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PaperShadowMonitorView } from "./paperShadowMonitorView";
import { buildLearningScreen } from "./learningScreenModel";
import { CalmHeadline, CalmRow, CalmTitle } from "./uiKit";
import { calmColors } from "./uiKitModel";
import { readableFont } from "./designSystem";

type Props = React.ComponentProps<typeof PaperShadowMonitorView>;

/**
 * "학습" — calm redesign of the PAPER tab. The summary is new; the full read-only monitors
 * (운영/학습/재현/실계좌) stay available behind "자세히 보기" so no evidence is removed.
 */
export function LearningView(props: Props) {
  const [details, setDetails] = useState(false);
  const model = buildLearningScreen(props.paper);
  if (details) return <View style={styles.screen}>
    <Pressable accessibilityRole="button" onPress={() => setDetails(false)} style={styles.back} testID="learning-summary-back"><Text style={styles.backText}>‹ 학습 요약</Text></Pressable>
    <PaperShadowMonitorView {...props} />
  </View>;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="learning-view">
    <CalmTitle text="학습" />
    <CalmHeadline tone={model.tone} text={model.headline} sub={model.sub} />
    <View style={styles.track} accessibilityLabel={model.steps.map((s) => `${s.label} ${s.state === "DONE" ? "확인" : s.state === "BLOCKED" ? "막힘" : "없음"}`).join(", ")}>
      {model.steps.map((step) => <View key={step.label} style={styles.step}>
        <View style={[styles.node, step.state === "DONE" ? styles.done : step.state === "BLOCKED" ? styles.blocked : null]} />
        <Text style={styles.stepLabel}>{step.label}</Text>
      </View>)}
    </View>
    {model.narrowest ? <Text style={styles.narrow}>{model.narrowest}</Text> : null}
    <View style={styles.list}>{model.rows.map((row) => <CalmRow key={row.label} label={row.label} value={row.value} tone={row.tone} />)}</View>
    <Pressable accessibilityRole="button" onPress={() => setDetails(true)} style={styles.fold} testID="learning-details">
      <Text style={styles.foldText}>자세히 보기 (운영 · 학습 · 재현 · 실계좌)</Text><Text style={styles.foldText}>›</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  track: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  step: { alignItems: "center", gap: 6, flex: 1 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: calmColors.muted },
  done: { backgroundColor: calmColors.text, borderColor: calmColors.text },
  blocked: { borderColor: calmColors.attention },
  stepLabel: { color: calmColors.muted, fontSize: readableFont(12) },
  narrow: { color: calmColors.attention, fontSize: readableFont(14), lineHeight: 21, marginHorizontal: 20, marginBottom: 6 },
  list: { paddingHorizontal: 20 },
  fold: { marginHorizontal: 20, marginTop: 8, minHeight: 52, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  foldText: { color: calmColors.text, fontSize: readableFont(14) },
  back: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, backgroundColor: calmColors.ground },
  backText: { color: calmColors.muted, fontSize: readableFont(14) },
});
