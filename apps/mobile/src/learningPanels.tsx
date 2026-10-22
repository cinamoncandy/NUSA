import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SectionLabel } from "./instrumentKit";
import { calmColors, calmToneColor } from "./uiKitModel";
import { readableFont } from "./designSystem";
import { buildCostWall, buildDecisionBars, buildStudyTimeline } from "./learningPanelsModel";

/** Registered studies: a vertical line, one dot per study, the next verdict highlighted. Dates are the frozen designs' verdict times. */
export function StudyTimeline({ nowMs }: { readonly nowMs: number }) {
  const rows = buildStudyTimeline(nowMs);
  return <View style={styles.block} testID="learning-studies" accessibilityLabel={rows.map((r) => `${r.id} ${r.dateLabel} ${r.status}`).join(". ")}>
    <SectionLabel left="사전 등록 연구" right="사전 등록" />
    <View style={styles.tl}>
      <View style={styles.tlLine} />
      {rows.map((r) => <View key={r.id} style={styles.ev}>
        <View style={[styles.dot, r.next ? styles.dotNext : null]} />
        <Text style={styles.date}>{r.dateLabel}</Text>
        <Text style={styles.evName}>{r.name}</Text>
        <Text style={[styles.evStatus, { color: calmToneColor(r.tone) }]}>{r.status}</Text>
      </View>)}
    </View>
    <Text style={styles.note}>대부분의 연구가 실패할 가능성이 높아요. 실패도 그대로 기록해요.</Text>
  </View>;
}

/** The cost wall: candidates' gross edge against the round-trip cost line. Bars that do not reach the line lose money after costs. */
export function CostWall({ input }: { readonly input?: ReadonlyArray<{ readonly label: string; readonly bp: number }> | null }) {
  const m = buildCostWall(input);
  const wallPct = `${(m.wallBp / m.maxBp) * 100}%` as const;
  return <View style={styles.block} testID="learning-cost-wall" accessibilityLabel={`${m.example ? "예시 · " : ""}비용의 벽 왕복 ${m.wallBp}bp. ${m.bars.map((b) => `${b.label} ${b.bp}bp ${b.over ? "넘음" : "못 넘음"}`).join(", ")}`}>
    <SectionLabel left="비용의 벽" right={m.example ? "예시" : `${m.wallBp}bp`} />
    <View style={styles.wallBody}>
      {m.bars.map((b) => <View key={b.label} style={styles.wRow}>
        <Text style={styles.wLabel}>{b.label}</Text>
        <View style={styles.wTrack}><View style={[styles.wFill, { width: `${b.ratio * 100}%`, backgroundColor: b.over ? calmColors.text : calmColors.muted }]} /></View>
        <Text style={styles.wValue}>{b.bp}</Text>
      </View>)}
      <View pointerEvents="none" style={styles.wOverlay}><View style={[styles.wLine, { left: wallPct }]}><Text style={styles.wTag}>{m.wallBp}bp</Text></View></View>
    </View>
    <Text style={styles.note}>비용선을 넘지 못하면 순수익은 마이너스예요. 스프레드는 별도예요.{m.example ? " 막대는 설명용 예시이고 실제 후보 값이 아니에요." : ""}</Text>
  </View>;
}

/** Decision bars: one bar per hour, the latest hours in the live tone. Shows activity, not performance. */
export function DecisionBars({ hourly }: { readonly hourly?: ReadonlyArray<number> | null }) {
  const m = buildDecisionBars(hourly);
  return <View style={styles.block} testID="learning-decision-bars" accessibilityLabel={`${m.example ? "예시 · " : ""}최근 ${m.bars.length}시간 판단 ${m.total.toLocaleString("en-US")}건`}>
    <SectionLabel left="판단 흐름" right={m.example ? "예시" : `${m.bars.length}시간`} />
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {m.bars.map((b, i) => <View key={i} style={[styles.bar, { height: `${b.ratio * 100}%`, backgroundColor: b.recent ? calmColors.order : RAIL }]} />)}
    </View>
    <Text style={styles.note}>판단이 많다고 수익이 나는 것은 아니에요. 활동량만 보여 줘요.{m.example ? " 막대는 예시예요." : ""}</Text>
  </View>;
}

const RAIL = "#2A3440";

const styles = StyleSheet.create({
  block: { paddingHorizontal: 20, marginTop: 22, gap: 12 },
  note: { color: calmColors.muted, fontSize: readableFont(12), lineHeight: 18 },
  tl: { paddingLeft: 26, gap: 20, marginTop: 6 },
  tlLine: { position: "absolute", left: 5, top: 8, bottom: 8, width: StyleSheet.hairlineWidth, backgroundColor: RAIL },
  ev: { gap: 2 },
  dot: { position: "absolute", left: -26, top: 9, width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: calmColors.muted, backgroundColor: calmColors.ground },
  dotNext: { borderColor: calmColors.order, backgroundColor: calmColors.order },
  date: { color: calmColors.text, fontSize: 34, fontWeight: "500", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  evName: { color: calmColors.text, fontSize: readableFont(14), fontWeight: "500" },
  evStatus: { fontSize: readableFont(12) },
  wallBody: { paddingTop: 22, paddingBottom: 4 },
  wRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
  wLabel: { width: 74, color: calmColors.muted, fontSize: readableFont(12) },
  wTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: calmColors.line, justifyContent: "center" },
  wFill: { height: 9, borderRadius: 1 },
  wValue: { width: 28, textAlign: "right", color: calmColors.muted, fontSize: readableFont(12), fontVariant: ["tabular-nums"] },
  wOverlay: { position: "absolute", top: 0, bottom: 0, left: 84, right: 38 },
  wLine: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1, borderLeftColor: calmColors.loss },
  wTag: { position: "absolute", top: -2, left: -16, width: 44, textAlign: "center", color: calmColors.loss, fontSize: readableFont(12), fontWeight: "600" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 64 },
  bar: { flex: 1, borderRadius: 1, minHeight: 2 },
});
