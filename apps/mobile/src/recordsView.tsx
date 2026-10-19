import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { buildTodayTimeline, type TimelineEvent } from "./recordsTimelineModel";
import type { MoreDestination } from "./navigationContract";
import { RECORDS_GROUPS } from "./recordsScreenModel";
import { CalmTitle } from "./uiKit";
import { calmColors } from "./uiKitModel";
import { labelFont, readableFont } from "./designSystem";

/** "기록" — calm redesign of the More menu. Same `onOpen` contract as MoreMenuView. */
export function RecordsView({ onOpen, heartbeat = null }: Readonly<{ onOpen: (destination: MoreDestination) => void; /** Live heartbeat only (display); null when stale. */ heartbeat?: unknown }>) {
  const events = buildTodayTimeline(heartbeat, Date.now());
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="records-view">
    <CalmTitle text="기록" />
    {events.length === 0 ? null : <View style={styles.timeline} testID="records-today" accessibilityLabel={`오늘: ${events.map((e) => `${e.time} ${e.text}`).join(", ")}`}>
      <Text style={styles.groupTitle}>오늘 (한국 시간)</Text>
      <View style={styles.rail} />
      {events.map((event) => <TimelineRow key={`${event.at}-${event.text}`} event={event} />)}
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

function TimelineRow({ event }: { readonly event: TimelineEvent }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReducedMotion(v); }).catch(() => { if (mounted) setReducedMotion(false); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (reducedMotion || event.tone !== "NOW") return undefined;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, event.tone, pulse]);
  const color = event.tone === "NOW" ? calmColors.order : event.tone === "ATTENTION" ? calmColors.attention : event.tone === "MUTED" ? "#343C45" : calmColors.text;
  return <View style={styles.event}>
    <View style={styles.dotBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {event.tone === "NOW" && !reducedMotion ? <Animated.View style={[styles.halo, { backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] }]} /> : null}
      <View style={[event.tone === "NOW" ? styles.dotNow : styles.dot, { backgroundColor: color }]} />
    </View>
    <View style={styles.eventMain}>
      <Text style={[styles.eventTime, event.tone === "NOW" ? { color: calmColors.order } : null]}>{event.tone === "NOW" ? `지금 · ${event.time}` : event.time}</Text>
      <Text style={[styles.eventText, event.tone === "MUTED" ? { color: calmColors.muted } : null]}>{event.text}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  timeline: { paddingHorizontal: 20, marginTop: 14, marginBottom: 6 },
  rail: { position: "absolute", left: 26, top: 34, bottom: 10, width: 2, backgroundColor: calmColors.line },
  event: { flexDirection: "row", gap: 12, paddingVertical: 8 },
  dotBox: { width: 14, alignItems: "center", paddingTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 1 },
  dotNow: { width: 12, height: 12, borderRadius: 6 },
  halo: { position: "absolute", top: 4, width: 12, height: 12, borderRadius: 6 },
  eventMain: { flex: 1, gap: 2 },
  eventTime: { color: calmColors.muted, fontSize: readableFont(12), fontFamily: "monospace" },
  eventText: { color: calmColors.text, fontSize: readableFont(15), lineHeight: 21 },
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
