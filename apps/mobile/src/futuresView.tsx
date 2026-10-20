import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { PAPER_FUTURES_OWNER_LIMITS } from "../../../packages/contracts/src/paperFutures";
import { buildFuturesScreen } from "./futuresScreenModel";
import { futuresSafetyRows } from "./futuresSafetyRows";
import { InstrumentHero, Reveal, SectionLabel, useReducedMotion } from "./instrumentKit";
import { CalmRow } from "./uiKit";
import { calmColors } from "./uiKitModel";

/** "선물" — display-only paper futures status. `futures` is the server's futures snapshot; null/absent shows an honest "not started". */
export function FuturesView({ futures = null }: Readonly<{ futures?: unknown }>) {
  const reduced = useReducedMotion();
  const model = buildFuturesScreen(futures, {
    maxDailyLossRatio: PAPER_FUTURES_OWNER_LIMITS.maxDailyLossRatio,
    minLiquidationDistanceRatio: PAPER_FUTURES_OWNER_LIMITS.minLiquidationDistanceRatio,
    maxConsecutiveLosses: PAPER_FUTURES_OWNER_LIMITS.maxConsecutiveLosses,
  });
  const sections = [
    { title: "상태", rows: model.status },
    { title: "포지션 · 손익", rows: model.positions },
    { title: "한도 사용량", rows: model.usage },
    { title: "고정 한도", rows: futuresSafetyRows() },
  ];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="futures-view">
    <InstrumentHero index="04 / 선물" lines={[{ text: model.headline[0] }, { text: model.headline[1], amber: !model.started }]} />
    <View style={styles.sub}><SectionLabel left={model.sub} /></View>
    {sections.map((s, g) => <Reveal key={s.title} index={g} reducedMotion={reduced} style={styles.group}>
      <SectionLabel left={s.title} right={`${s.rows.length}`} />
      {s.rows.map((row, i) => <CalmRow key={`${i}-${row.label}`} label={row.label} hint={row.hint} value={row.value} tone={row.tone} />)}
    </Reveal>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  sub: { paddingHorizontal: 20, marginTop: 14 },
  group: { paddingHorizontal: 20, marginTop: 18 },
});
