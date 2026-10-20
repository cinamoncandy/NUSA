import React, { useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { buildTodayTimeline, type TimelineEvent } from "./recordsTimelineModel";
import type { MoreDestination } from "./navigationContract";
import { RECORDS_GROUPS } from "./recordsScreenModel";
import { InstrumentHero, SectionLabel, useReducedMotion } from "./instrumentKit";
import { fieldFonts } from "./fieldFonts";
import { calmColors } from "./uiKitModel";
import { labelFont, readableFont } from "./designSystem";

/** "기록" — calm redesign of the More menu. Same `onOpen` contract as MoreMenuView. */
export function RecordsView({ onOpen, heartbeat = null }: Readonly<{ onOpen: (destination: MoreDestination) => void; /** Live heartbeat only (display); null when stale. */ heartbeat?: unknown }>) {
  const events = buildTodayTimeline(heartbeat, Date.now());
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="records-view">
    <InstrumentHero index="04 / 기록" lines={[{ text: "오늘의" }, { text: "로그" }]} />
    {events.length === 0 ? null : <View style={styles.timeline} testID="records-today" accessibilityLabel={`오늘: ${events.map((e) => `${e.time} ${e.text}`).join(", ")}`}>
      <SectionLabel left="오늘 · 한국 시간" right={`${events.length}`} />
      {events.map((event, i) => <TimelineRow key={`${event.at}-${event.text}`} event={event} last={i === events.length - 1} />)}
    </View>}
    {RECORDS_GROUPS.map((group) => <View key={group.title} style={styles.group}>
      <Text style={styles.groupTitle}>{group.title}</Text>
      {group.items.map((item) => <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.hint}`}
        key={item.destination}
        onPress={() => onOpen(item.destination)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
        testID={`more-${item.destination}`}
      >
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.hint}>{item.hint}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>)}
    </View>)}
    <Text style={styles.footer}>모의투자 전용 · 실거래 잠김 · AI는 의견만</Text>
  </ScrollView>;
}

// One log line: mono time, a tag only where the tone carries meaning, the text. The live line ends in a blinking cursor; it stops
// when the OS reduce-motion setting is on.
const TAG: Partial<Record<TimelineEvent["tone"], string>> = { NOW: "NOW", ATTENTION: "한도", MUTED: "시작" };

function TimelineRow({ event, last }: { readonly event: TimelineEvent; readonly last: boolean }) {
  const reducedMotion = useReducedMotion();
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion !== false || event.tone !== "NOW") return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0, duration: 0, delay: 500, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 0, delay: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, event.tone, blink]);
  const amber = event.tone === "ATTENTION";
  const now = event.tone === "NOW";
  const tag = TAG[event.tone];
  return <View style={[styles.event, last ? styles.eventLast : null]}>
    <Text style={[fieldFonts.mono, styles.eventTime, now ? { color: calmColors.text } : null]}>{event.time}</Text>
    <View style={styles.eventMain}>
      <View style={styles.eventLine}>
        {tag == null ? null : <Text style={[fieldFonts.mono, styles.tag, amber ? styles.tagAmber : null]}>{tag}</Text>}
        <Text style={[styles.eventText, event.tone === "MUTED" ? { color: calmColors.muted } : null]}>{event.text}</Text>
        {now ? <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.cursor, { opacity: blink }]} /> : null}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  timeline: { paddingHorizontal: 20, marginTop: 24, marginBottom: 6 },
  event: { flexDirection: "row", gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line },
  eventLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: calmColors.line },
  eventMain: { flex: 1 },
  eventLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  eventTime: { width: 48, color: calmColors.muted, fontSize: readableFont(12), paddingTop: 2 },
  eventText: { color: calmColors.text, fontSize: readableFont(14), lineHeight: 20, flexShrink: 1 },
  tag: { color: calmColors.muted, fontSize: readableFont(11), borderWidth: 1, borderColor: calmColors.line, paddingHorizontal: 5 },
  tagAmber: { color: calmColors.attention, borderColor: calmColors.attention },
  cursor: { width: 7, height: 14, backgroundColor: calmColors.attention },
  screen: { flex: 1, backgroundColor: calmColors.ground },
  content: { paddingBottom: 40, width: "100%", maxWidth: 720, alignSelf: "center" },
  group: { paddingHorizontal: 20, marginTop: 14 },
  groupTitle: { color: calmColors.muted, fontSize: labelFont(12), marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 60, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: calmColors.line, gap: 12 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: calmColors.text, fontSize: readableFont(16) },
  hint: { color: calmColors.muted, fontSize: readableFont(12) },
  chevron: { color: calmColors.muted, fontSize: 20 },
  footer: { color: calmColors.muted, fontSize: readableFont(12), paddingHorizontal: 20, marginTop: 24 },
});
