import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { auraPalette, readableFont } from "./designSystem";
import { DotField, DotNumeral, GrainCard, TickSlider } from "./auraKit";
import { buildStudyTimeline } from "./learningPanelsModel";
import { buildLearningLoopPanels } from "./learningLoopModel";

/**
 * Learning tab panels in the aura direction: near-black ground, one green that glows, grain, dot-matrix numerals.
 * Every number comes from buildLearningLoopPanels / buildStudyTimeline (real server values or nothing). The graphics encode the
 * values: lit dots = the real count, marker position = the real ratio. Static, so reduce-motion has nothing to turn off.
 */
const CARD_MARGIN = 16;
const CARD_PADDING = 18;

const fmt = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
const signedInt = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const toneColor = (bp: number): string => (bp < 0 ? auraPalette.loss : auraPalette.neon);

function Chip({ children }: { readonly children: string }) {
  return <View style={styles.chip}><Text style={styles.chipText}>{children}</Text></View>;
}

/** Registered studies: dot-matrix dates on a quiet card, the next verdict lit. Dates are the frozen designs' verdict times. */
export function StudyTimeline({ nowMs }: { readonly nowMs: number }) {
  const rows = buildStudyTimeline(nowMs);
  return <GrainCard tone="DARK" style={styles.card} testID="learning-studies" accessibilityLabel={`사전 등록 연구. ${rows.map((r) => `${r.id} ${r.dateLabel} ${r.status}`).join(". ")}`}>
    <Chip>사전 등록 연구</Chip>
    <View style={styles.studyList}>
      {rows.map((r) => <View key={r.id} style={styles.studyRow}>
        <DotNumeral text={r.dateLabel} pitch={4} color={r.next ? auraPalette.neon : auraPalette.muted} glow={r.next} accessibilityLabel={r.dateLabel} />
        <View style={styles.studyCopy}>
          <Text style={[styles.studyName, r.next ? styles.studyNameNext : null]}>{r.name}</Text>
          <Text style={styles.studyStatus}>{r.status}</Text>
        </View>
      </View>)}
    </View>
    <Text style={styles.note}>대부분의 연구가 실패할 가능성이 높아요. 실패도 그대로 기록해요.</Text>
  </GrainCard>;
}

/** The cost wall, measured: what an average shadow trade of the owner baseline gains, loses and pays in fees, and what is left. */
export function CostWaterfall({ raw }: { readonly raw: unknown }) {
  const { cost } = buildLearningLoopPanels(raw);
  const { width } = useWindowDimensions();
  if (cost == null) return <Missing title="그림자 거래 한 번의 손익" />;
  const sliderWidth = Math.max(120, width - CARD_MARGIN * 2 - CARD_PADDING * 2);
  const result = cost.rows.find((r) => r.kind === "RESULT");
  const parts = cost.rows.filter((r) => r.kind !== "RESULT");
  return <GrainCard tone="DARK" style={styles.card} testID="learning-cost-waterfall"
    accessibilityLabel={`그림자 거래 한 번의 손익. 모의투자 주문이 아닌 기준 거래예요. 거래 ${cost.trades}건 기준. ${cost.rows.map((r) => `${r.label} ${fmt(r.bp)}bp`).join(", ")}. ${cost.summary}`}>
    <Chip>{`그림자 거래 한 번의 손익 · ${cost.trades.toLocaleString("en-US")}건`}</Chip>
    {result == null ? null : <View style={styles.numeralRow}>
      <DotNumeral text={result.bp.toFixed(1)} pitch={7} color={toneColor(result.bp)} glow accessibilityLabel={`${result.label} ${fmt(result.bp)}bp`} />
      <Text style={styles.unit}>bp</Text>
    </View>}
    <View style={styles.sliders}>
      {parts.map((r) => <View key={r.label} style={styles.sliderRow}>
        <View style={styles.rowHead}>
          <Text style={styles.rowLabel}>{r.label}</Text>
          <Text style={[styles.rowValue, { color: r.kind === "GAIN" ? auraPalette.neon : r.kind === "LOSS" ? auraPalette.loss : auraPalette.attention }]}>{fmt(r.bp)}</Text>
        </View>
        <TickSlider width={sliderWidth} ratio={Math.abs(r.bp) / cost.scaleBp} color={r.kind === "GAIN" ? auraPalette.neon : r.kind === "LOSS" ? auraPalette.loss : auraPalette.attention} />
      </View>)}
    </View>
    <Text style={styles.note}>{cost.summary}{cost.winRatePercent == null ? "" : ` 이긴 비율은 ${cost.winRatePercent.toFixed(0)}%예요.`} 세 눈금은 같은 크기로 맞췄어요.</Text>
  </GrainCard>;
}

/** The owner baseline's PAPER result over the periods the learner consumed, and against buying everything. */
export function PaperResultBars({ raw }: { readonly raw: unknown }) {
  const { paper } = buildLearningLoopPanels(raw);
  if (paper == null) return <Missing title="모의투자 성과" />;
  return <GrainCard tone="DARK" style={styles.card} testID="learning-paper-result" accessibilityLabel={`모의투자 성과. ${paper.summary}`}>
    <Chip>{paper.periods == null ? "모의투자 성과" : `모의투자 성과 · ${paper.periods}구간`}</Chip>
    <View style={styles.pairRow}>
      {paper.netBp == null ? null : <View style={styles.pairCell}>
        <DotNumeral text={signedInt(paper.netBp)} pitch={6} color={toneColor(paper.netBp)} glow accessibilityLabel={`순결과 ${signedInt(paper.netBp)}bp`} />
        <Text style={styles.cellLabel}>순결과 bp</Text>
      </View>}
      {paper.excessBp == null ? null : <View style={styles.pairCell}>
        <DotNumeral text={signedInt(paper.excessBp)} pitch={6} color={toneColor(paper.excessBp)} glow accessibilityLabel={`전부 사기 대비 ${signedInt(paper.excessBp)}bp`} />
        <Text style={styles.cellLabel}>전부 사기 대비 bp</Text>
      </View>}
    </View>
    <Text style={styles.note}>{paper.summary}</Text>
  </GrainCard>;
}

/** First screen passes against the independent holdout: the number that survived new data, over every setting that was tried. */
export function OverfitGate({ raw }: { readonly raw: unknown }) {
  const { overfit } = buildLearningLoopPanels(raw);
  if (overfit == null) return <Missing title="새 데이터에서의 결과" />;
  const tried = overfit.configurations;
  const field = tried != null && tried >= overfit.discoveryPasses ? tried : null;
  return <GrainCard tone="GREEN" style={styles.hero} testID="learning-overfit-gate" accessibilityLabel={`새 데이터에서의 결과. ${overfit.summary}`}>
    <View style={styles.heroTop}>
      <Chip>새 데이터 독립 검증 합격</Chip>
      {overfit.overfitRatePercent == null ? null : <Chip>{`탈락 ${overfit.overfitRatePercent}%`}</Chip>}
    </View>
    <View style={styles.heroBody}>
      <DotNumeral text={String(overfit.holdoutPasses)} pitch={13} color={auraPalette.text} glow accessibilityLabel={`독립 검증 합격 ${overfit.holdoutPasses}개`} />
      {field == null ? null : <DotField total={field} lit={overfit.discoveryPasses} columns={16} pitch={10} accessibilityLabel={`시도한 설정 ${field}개 중 1차 통과 ${overfit.discoveryPasses}개가 밝게 표시돼요`} />}
    </View>
    <View style={styles.heroFoot}>
      <Chip>{field == null ? `1차 통과 ${overfit.discoveryPasses}개 → 합격 ${overfit.holdoutPasses}개` : `${field}개 시도 → 1차 ${overfit.discoveryPasses}개 → 합격 ${overfit.holdoutPasses}개`}</Chip>
    </View>
    <View style={styles.heroNoteBox}><Text style={styles.heroNote}>{overfit.summary} 기준은 낮추지 않아요.</Text></View>
  </GrainCard>;
}

function Missing({ title }: { readonly title: string }) {
  return <GrainCard tone="DARK" style={styles.card} accessibilityLabel={`${title}. 서버에서 아직 받지 못했어요`}>
    <Chip>{title}</Chip>
    <Text style={styles.note}>서버에서 아직 받지 못했어요. 값을 지어내지 않고 비워 둬요.</Text>
  </GrainCard>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: CARD_MARGIN, marginTop: 12, gap: 14, padding: CARD_PADDING },
  hero: { marginHorizontal: CARD_MARGIN, marginTop: 16, gap: 14, padding: CARD_PADDING },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  heroBody: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingVertical: 6 },
  heroFoot: { flexDirection: "row" },
  heroNoteBox: { backgroundColor: auraPalette.scrim, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  heroNote: { color: auraPalette.text, fontSize: readableFont(12), lineHeight: 18 },
  chip: { alignSelf: "flex-start", backgroundColor: auraPalette.scrim, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  chipText: { color: auraPalette.text, fontSize: readableFont(12), fontWeight: "600" },
  note: { color: auraPalette.muted, fontSize: readableFont(12), lineHeight: 18 },
  numeralRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  unit: { color: auraPalette.muted, fontSize: readableFont(14), fontWeight: "500", paddingBottom: 2 },
  sliders: { gap: 12 },
  sliderRow: { gap: 6 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10 },
  rowLabel: { color: auraPalette.muted, fontSize: readableFont(13) },
  rowValue: { fontSize: readableFont(15), fontWeight: "500", fontVariant: ["tabular-nums"] },
  pairRow: { flexDirection: "row", gap: 28, flexWrap: "wrap" },
  pairCell: { gap: 8 },
  cellLabel: { color: auraPalette.muted, fontSize: readableFont(12) },
  studyList: { gap: 16 },
  studyRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  studyCopy: { flex: 1, gap: 2 },
  studyName: { color: auraPalette.muted, fontSize: readableFont(14), fontWeight: "500" },
  studyNameNext: { color: auraPalette.text },
  studyStatus: { color: auraPalette.muted, fontSize: readableFont(12) },
});
