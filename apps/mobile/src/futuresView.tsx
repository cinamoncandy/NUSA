import React, { useState } from "react";
import { IslandCore } from "./islandCore";
import { futuresIsland } from "./islandCoreModel";
import { IslandWidth } from "./islandWidth";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { FUTURES_SCREEN_LIMITS } from "./futuresLimits";
import { FUTURES_SAMPLE_NOW, FUTURES_SAMPLE_SNAPSHOT } from "./futuresSample";
import { buildFuturesScreen } from "./futuresScreenModel";
import { futuresSafetyRows } from "./futuresSafetyRows";
import { InstrumentHero, PressScale, Reveal, SectionLabel, useReducedMotion } from "./instrumentKit";
import { CalmRow } from "./uiKit";
import { calmColors, calmToneColor, type CalmTone } from "./uiKitModel";
import { readableFont } from "./designSystem";
import { fieldFonts } from "./fieldFonts";
import type { FuturesBar } from "./futuresScreenModel";

/** "선물" — display-only paper futures status. `futures` is the server's futures snapshot; null/absent shows an honest "not started". */
export function FuturesView({ futures = null }: Readonly<{ futures?: unknown }>) {
  const reduced = useReducedMotion();
  // The preview shows the finished layout with made-up numbers. It is off by default and always labelled.
  const [preview, setPreview] = useState(false);
  const source = preview ? FUTURES_SAMPLE_SNAPSHOT : futures;
  const model = buildFuturesScreen(source, FUTURES_SCREEN_LIMITS, preview ? FUTURES_SAMPLE_NOW : Date.now());
  const sections = [
    { title: "상태", rows: model.status },
    { title: "포지션 · 손익", rows: model.positions },
    { title: "한도 사용량", rows: model.usage, bars: true },
    { title: "고정 한도", rows: futuresSafetyRows() },
  ];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="futures-view">
    <InstrumentHero index="04 / 선물" lines={[{ text: model.headline[0] }, { text: model.headline[1], amber: !model.started }]} />
    <View style={styles.sub}><SectionLabel left={model.sub} /></View>
    <IslandWidth>{(w) => <IslandCore decisionCount={null} orderCount={null} live={false} width={w} reducedMotion={true} still={futuresIsland(model.started, model.headline)} testID="futures-island" />}</IslandWidth>
    {preview ? <View style={styles.banner} testID="futures-preview-banner" accessible accessibilityLabel="예시 데이터예요. 실제 거래가 아니에요"><Text style={[fieldFonts.mono, styles.bannerText]}>예시 데이터 · 실제 거래가 아니에요</Text></View> : null}
    {sections.map((s, g) => <Reveal key={s.title} index={g} reducedMotion={reduced} style={styles.group}>
      <SectionLabel left={s.title} right={`${s.rows.length}`} />
      {s.rows.map((row, i) => <View key={`${i}-${row.label}`}>
        <CalmRow label={row.label} hint={row.hint} value={row.value} tone={row.tone} />
        {s.bars && "bar" in row && row.bar ? <UsageBar bar={row.bar} tone={row.tone} /> : null}
      </View>)}
    </Reveal>)}
    <Reveal index={sections.length} reducedMotion={reduced} style={styles.group}>
      <SectionLabel left="왜 샀나요" right={`${model.reasons.length}`} />
      {model.reasons.length === 0
        ? <Text style={styles.none} testID="futures-reasons-empty">이유 기록이 없어요. 서버가 남긴 이유만 보여주고, 짐작해서 채우지 않아요.</Text>
        : model.reasons.map((r, i) => <View key={`${i}-${r.title}-${r.time}`} style={styles.why} testID="futures-reason" accessible accessibilityLabel={`${r.time} ${r.title}. 전략 ${r.strategy}. ${r.signal ?? ""} 통과 ${r.checks.filter((c) => c.passed).length}개${r.checks.some((c) => !c.passed) ? `, 실패: ${r.checks.filter((c) => !c.passed).map((c) => c.label).join(", ")}` : ""}`}>
          <Text style={[fieldFonts.mono, styles.whyTime]}>{r.time} · {r.title}</Text>
          <Text style={styles.whyLine}>전략 {r.strategy}{r.signal ? ` · ${r.signal}` : ""}</Text>
          <View style={styles.chips}>{r.checks.map((c, ci) => <Text key={`${ci}-${c.label}`} style={[fieldFonts.mono, styles.chip, c.passed ? styles.chipPass : styles.chipFail]}>{c.label} {c.passed ? "통과" : "실패"}</Text>)}</View>
        </View>)}
    </Reveal>
    <PressScale accessibilityRole="button" accessibilityLabel={preview ? "실제 화면으로 돌아가기" : "예시 화면 보기"} onPress={() => setPreview((v) => !v)} style={styles.previewBtn} testID="futures-preview-toggle">
      <Text style={[fieldFonts.mono, styles.previewText]}>{preview ? "실제 화면으로 돌아가기" : "예시 화면 보기"}</Text>
    </PressScale>
  </ScrollView>;
}

/** A thin track with the fill and the limit line; colour follows the row's tone (amber near the limit, red past it). */
function UsageBar({ bar, tone }: { readonly bar: FuturesBar; readonly tone: CalmTone }) {
  const color = tone === "NORMAL" ? calmColors.muted : calmToneColor(tone);
  return <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={[styles.fill, { width: `${Math.round(bar.fill * 100)}%`, backgroundColor: color }]} />
    <View style={[styles.limitLine, { left: `${Math.round(bar.marker * 100)}%` }]} />
  </View>;
}

const styles = StyleSheet.create({
  track: { height: 4, backgroundColor: calmColors.line, marginTop: -6, marginBottom: 12, position: "relative" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  limitLine: { position: "absolute", top: -3, bottom: -3, width: 1, marginLeft: -1, backgroundColor: calmColors.attention },
  banner: { marginHorizontal: 20, marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.attention, paddingVertical: 6, paddingHorizontal: 10 },
  bannerText: { color: calmColors.attention, fontSize: readableFont(12) },
  none: { color: calmColors.muted, fontSize: readableFont(13), lineHeight: 19, marginTop: 8 },
  why: { marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line, padding: 12, gap: 4 },
  whyTime: { color: calmColors.muted, fontSize: readableFont(11) },
  whyLine: { color: calmColors.text, fontSize: readableFont(14), lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { fontSize: readableFont(11), borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2 },
  chipPass: { color: calmColors.order, borderColor: calmColors.order },
  chipFail: { color: calmColors.attention, borderColor: calmColors.attention },
  previewBtn: { marginHorizontal: 20, marginTop: 24, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: calmColors.line },
  previewText: { color: calmColors.muted, fontSize: readableFont(13) },
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  sub: { paddingHorizontal: 20, marginTop: 14 },
  group: { paddingHorizontal: 20, marginTop: 18 },
});
